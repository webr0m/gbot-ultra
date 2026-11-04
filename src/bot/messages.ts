import {isGuestMessage,moderationUser} from '../services/message-content.js';
import { tr } from "../services/bot-i18n.js";
import type { Bot } from "grammy";
import type { Message } from "grammy/types";
import {
  getCustomCommand,
  getNote,
  incrementCustomCommandUses,
  incrementNoteUses,
} from "../db/repositories/commands.js";
import { logger } from "../logger.js";
import { enforceAntispam } from "../services/antispam.js";
import { advancedMessage, autoRespond, getRichNote, deliverRichNote, scopeExemptions } from '../services/advanced-engine.js';
import { InlineKeyboard } from 'grammy';
import { isCaptchaPending } from "../services/captcha.js";
import { displayName, escapeHtml, mentionUser } from "../utils/format.js";
import { isGroupChat, safeDelete } from "../utils/telegram.js";
import type { AppContext } from "./context.js";
import { enqueueVisual,runVisualJobs } from '../services/visual-moderation.js';

function isServiceMessage(message: Message): boolean {
  return Boolean(
    message.new_chat_members ||
      message.left_chat_member ||
      message.new_chat_title ||
      message.new_chat_photo ||
      message.delete_chat_photo ||
      message.group_chat_created ||
      message.supergroup_chat_created ||
      message.channel_chat_created ||
      message.migrate_to_chat_id ||
      message.migrate_from_chat_id ||
      message.pinned_message ||
      message.forum_topic_created ||
      message.forum_topic_closed ||
      message.forum_topic_reopened ||
      message.video_chat_started ||
      message.video_chat_ended ||
      message.video_chat_participants_invited,
  );
}

function renderTemplate(content: string, ctx: AppContext): string {
  const from = ctx.from!;
  const chat = ctx.chat!;
  return content
    .replaceAll("{name}", escapeHtml(displayName(from)))
    .replaceAll(
      "{username}",
      from.username ? `@${escapeHtml(from.username)}` : escapeHtml(displayName(from)),
    )
    .replaceAll("{id}", String(from.id))
    .replaceAll("{chat}", escapeHtml(chat.title ?? tr("el grupo")))
    .replaceAll("{mention}", mentionUser(from))
    .replaceAll("{rules}", escapeHtml(ctx.app.settings.rules.text || tr("Sin normas configuradas.")));
}

async function replyContent(ctx: AppContext, content: string): Promise<void> {
  const rendered = renderTemplate(content, ctx);
  const message = ctx.message;
  try {
    await ctx.reply(rendered, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_parameters: message
        ? { message_id: message.message_id, allow_sending_without_reply: true }
        : undefined,
    });
  } catch (error) {
    logger.warn({ err: error, chatId: ctx.chat?.id }, tr("Contenido HTML inválido; se envía en texto plano"));
    await ctx
      .reply(rendered.replace(/<[^>]+>/g, ""), {
        link_preview_options: { is_disabled: true },
        reply_parameters: message
          ? { message_id: message.message_id, allow_sending_without_reply: true }
          : undefined,
      })
      .catch(() => undefined);
  }
}

function commandName(text: string, botUsername: string): string | null {
  const match = /^[/!]([a-zA-Z0-9_]{1,64})(?:@([a-zA-Z0-9_]+))?/.exec(text);
  if (!match) return null;
  const suffix = match[2];
  if (suffix && suffix.toLowerCase() !== botUsername.toLowerCase()) return null;
  return (match[1] ?? "").toLowerCase();
}

function noteName(text: string): string | null {
  const match = /^#([a-zA-Z0-9_]{1,32})(?:\s|$)/.exec(text);
  return match ? (match[1] ?? "").toLowerCase() : null;
}

/**
 * Middleware de mensajes de grupo: captcha pendiente, automoderación y
 * comandos personalizados / notas dinámicas.
 */
export function registerMessages(bot: Bot<AppContext>,guestsOnly=false): void {
  bot.use(async (ctx, next) => {
    const message = ctx.message??ctx.editedMessage;
    const guest=Boolean(message&&isGuestMessage(message));
    if(guestsOnly&&!guest)return next();if(!guestsOnly&&guest)return;
    const from = (message&&moderationUser(message))??ctx.from;
    if (!message || !from || (from.is_bot && !message.sender_chat&&!guest)) return next();
    if (!ctx.chat || !isGroupChat(ctx.chat)) {if(guest)return;return next();}

    const chat = ctx.app.chatRow;
    if (!chat) {if(guest)return;return next();}
    if(message.sender_chat?.id===chat.chat_id){if(guest)return;return next();} // Anonymous administrators speak as the group.

    // Mientras el captcha está pendiente, el usuario no puede escribir.
    if (!ctx.app.isOwner && isCaptchaPending(chat.chat_id, from.id) && !(await scopeExemptions(chat,from.id)).includes('captcha')) {
      await safeDelete(ctx.api, chat.chat_id, message.message_id);
      return;
    }

    if (!isServiceMessage(message) && !ctx.app.isAdmin && !ctx.app.isOwner) {
      const global=await enforceAntispam(ctx.api,chat,ctx.app.settings,message,from,ctx.app.botId,{global:'only'});
      if(global.handled)return;
      const advanced=await advancedMessage(ctx.api,chat,ctx.app.settings,message,from,ctx.app.botId);
      if(advanced.handled)return;
      const result = await enforceAntispam(
        ctx.api,
        chat,
        advanced.settings,
        message,
        from,
        ctx.app.botId,
        {observe:advanced.observe,global:'skip',countFlood:!ctx.editedMessage},
      );
      if (result.handled) return;
      if(await enqueueVisual(chat,message,from))void runVisualJobs(ctx.api,ctx.app.botId).catch(()=>logger.warn({chatId:chat.chat_id},tr("Filtro visual pendiente del próximo cron")));
    }

    // A guest response is content, never an instruction to execute commands on behalf of its caller.
    if(guest||ctx.editedMessage)return;
    const text = (message.text ?? message.caption ?? "").trim();
    if (!text) return next();

    const note = noteName(text);
    if (note) {
      const rich=await getRichNote(chat,note);
      if(rich){
        if(rich.private_delivery)await ctx.reply(tr("📩 Abre la nota en privado."),{reply_markup:new InlineKeyboard().url(tr("Abrir nota"),`https://t.me/${ctx.me.username}?start=note_${chat.chat_id}_${note}`)});
        else await deliverRichNote(ctx.api,rich,chat.chat_id,message.message_thread_id);
        return;
      }
      const row = await getNote(chat.chat_id, note);
      if (row) {
        void incrementNoteUses(chat.chat_id, note).catch((error) =>
          logger.warn({ err: error, chatId: chat.chat_id, note }, tr("No se pudo contar la nota")),
        );
        await replyContent(ctx, row.content);
        return;
      }
      return next();
    }

    const name = commandName(text, ctx.me.username);
    if (!name) { if(!isServiceMessage(message)&&await autoRespond(ctx.api,chat,message))return; return next(); }

    const command = await getCustomCommand(chat.chat_id, name);
    if (!command) return next();

    void incrementCustomCommandUses(chat.chat_id, name).catch((error) =>
      logger.warn({ err: error, chatId: chat.chat_id, name }, tr("No se pudo contar el comando")),
    );
    await replyContent(ctx, command.content);
  });
}
