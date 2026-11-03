import { tr } from "../services/bot-i18n.js";
import type { NextFunction } from "grammy";
import { config } from "../config.js";
import { bumpDaily } from "../db/repositories/stats.js";
import { recordMessageActivity } from "../db/repositories/members.js";
import { upsertUser } from "../db/repositories/users.js";
import { logger } from "../logger.js";
import { displayName } from "../utils/format.js";
import { deleteLater, getChatMemberSafe, isGroupChat, isUserAdmin } from "../utils/telegram.js";
import { consumeAction, limitMessage } from "../services/actions.js";
import { loadChat, settingsOf } from "../services/chat-cache.js";
import { isPremium } from "../services/premium.js";
import { rememberMessage } from "../services/recent.js";
import { mergeSettings } from "../services/settings.js";
import type { AppContext } from "./context.js";
import type { InlineKeyboard } from "grammy";
import { DEVELOPER_ID } from '../services/roles.js';
import {withBotLanguage} from '../services/bot-i18n.js';
import {contextLanguage} from '../services/language-preferences.js';

function isServiceMessage(ctx: AppContext): boolean {
  const message = ctx.message;
  if (!message) return true;
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
      message.forum_topic_reopened,
  );
}

function isCommandText(text: string | undefined): boolean {
  return Boolean(text && /^[/!][a-zA-Z0-9_]{1,64}/.test(text));
}

export async function attachContext(
  ctx: AppContext,
  next: NextFunction,
): Promise<void> {
  const from = ctx.from;
  let chatRow = null;
  let settings = mergeSettings(null);
  let isAdmin = false;

  if (from && !from.is_bot) {
    if (ctx.chat && isGroupChat(ctx.chat)) {
      await upsertUser({
        id: from.id,
        username: from.username ?? null,
        first_name: from.first_name ?? "",
        last_name: from.last_name ?? null,
        language_code: from.language_code ?? null,
        is_bot: false,
      }).catch((error) => logger.warn({ err: error }, tr("No se pudo guardar el usuario")));
    } else {
      void upsertUser({
        id: from.id,
        username: from.username ?? null,
        first_name: from.first_name ?? "",
        last_name: from.last_name ?? null,
        language_code: from.language_code ?? null,
        is_bot: false,
      }).catch((error) => logger.warn({ err: error }, tr("No se pudo guardar el usuario")));
    }
  }

  if (ctx.chat && isGroupChat(ctx.chat)) {
    try {
      chatRow = await loadChat(ctx.chat);
      settings = settingsOf(chatRow);
    } catch (error) {
      logger.error({ err: error, chatId: ctx.chat.id }, tr("No se pudo cargar el grupo"));
    }

    if (from && !from.is_bot) {
      isAdmin = await isUserAdmin(ctx.api, ctx.chat.id, from.id).catch(() => false);
      if (!isServiceMessage(ctx)) {
        void recordMessageActivity(ctx.chat.id, from.id, false).catch((error) =>
          logger.warn({ err: error }, tr("No se pudo registrar la actividad del mensaje")),
        );
        if (isCommandText(ctx.message?.text)) {
          void bumpDaily(ctx.chat.id, "commands").catch(() => undefined);
        }
        if (ctx.message?.message_id) {
          rememberMessage(ctx.chat.id, ctx.message.message_id);
        }
      }
    }
  }

  ctx.app = {
    botId: ctx.me.id,
    chatRow,
    settings,
    premium: Boolean(from && config.ownerIds.has(from.id)) || isPremium(chatRow),
    isAdmin,
    isOwner: Boolean(from && config.ownerIds.has(from.id)),
    actorName: from ? displayName(from) : tr("Usuario"),
  };

  ctx.app.language=await contextLanguage(ctx);
  await withBotLanguage(ctx.app.language,next);
}

function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function notify(ctx: AppContext, text: string): Promise<void> {
  text=tr(text);
  if (ctx.callbackQuery) {
    await ctx
      .answerCallbackQuery({ text: plainText(text).slice(0, 190), show_alert: true })
      .catch(() => undefined);
    return;
  }
  await ctx.reply(text, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

export async function ensureGroupAdmin(ctx: AppContext): Promise<boolean> {
  if (!ctx.chat || !isGroupChat(ctx.chat)) {
    await notify(ctx, tr("⚠️ Este comando solo funciona en grupos."));
    return false;
  }
  if (!ctx.app.chatRow) {
    await notify(ctx, tr("⚠️ No he podido cargar la configuración del grupo. Inténtalo de nuevo."));
    return false;
  }
  if (!ctx.app.isAdmin && !ctx.app.isOwner) {
    await notify(
      ctx,
      tr("🛡️ <b>Solo administradores</b>\n\nNecesitas ser administrador del grupo para usar este comando."),
    );
    return false;
  }
  const command = ctx.message?.text?.match(/^\/(\w+)/)?.[1]?.toLowerCase();
  const rights: Record<string, string> = {
    ban: "can_restrict_members", unban: "can_restrict_members", kick: "can_restrict_members",
    mute: "can_restrict_members", unmute: "can_restrict_members", warn: "can_restrict_members",
    unwarn: "can_restrict_members", resetwarns: "can_restrict_members", lock: "can_restrict_members", unlock: "can_restrict_members",
    promote: "can_promote_members", demote: "can_promote_members", purge: "can_delete_messages", del: "can_delete_messages",
    pin: "can_pin_messages", unpin: "can_pin_messages", unpinall: "can_pin_messages",
  };
  if (command && rights[command] && !ctx.app.isOwner) {
    const member = await getChatMemberSafe(ctx.api, ctx.chat.id, ctx.from!.id);
    if (!member || (member.status !== "creator" && (member.status !== "administrator" || !(member as unknown as Record<string, unknown>)[rights[command]!]))) {
      await notify(ctx, tr("No tienes el permiso de Telegram necesario para esta acción. Pide al creador que revise tus permisos de administrador."));
      return false;
    }
  }
  return true;
}

export async function ensureOwner(ctx: AppContext): Promise<boolean> {
  if (!ctx.app.isOwner) {
    await notify(ctx, tr("⛔ Este comando es exclusivo del propietario del bot."));
    return false;
  }
  return true;
}
export async function ensureDeveloper(ctx:AppContext):Promise<boolean>{
 if(ctx.from?.id===DEVELOPER_ID)return true;
 await notify(ctx,tr("⛔ No tienes permisos para realizar esta operación."));return false;
}

export async function guardAction(ctx: AppContext): Promise<boolean> {
  if (ctx.app.isOwner) return true;
  const chat = ctx.app.chatRow;
  if (!chat) return false;
  const gate = await consumeAction(chat);
  if (gate.allowed) return true;
  await notify(ctx, limitMessage(gate));
  return false;
}

export interface TempReplyOptions {
  reply_markup?: InlineKeyboard;
  seconds?: number;
}

export async function replyTemp(
  ctx: AppContext,
  text: string,
  options: TempReplyOptions = {},
): Promise<void> {
  text=tr(text);
  const seconds = options.seconds ?? 30;
  try {
    const sent = await ctx.reply(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: options.reply_markup,
    });
    const chatId = ctx.chat?.id;
    if (chatId && seconds > 0) {
      deleteLater(ctx.api, chatId, sent.message_id, seconds * 1_000);
    }
  } catch (error) {
    logger.warn({ err: error, chatId: ctx.chat?.id }, tr("No se pudo responder"));
  }
}

const CONFIG_COMMANDS = new Set([
  "settings", "config", "ajustes",
]);

export async function redirectGroupConfig(ctx: AppContext, next: NextFunction): Promise<void> {
  if (!ctx.chat || !isGroupChat(ctx.chat)) return next();
  const text = (ctx.message?.text ?? ctx.message?.caption ?? "").trim();
  const match = text.match(/^\/([a-z]+)(?:@([a-z0-9_]+))?\s*$/i);
  if (!match || (match[2] && match[2].toLowerCase() !== ctx.me.username.toLowerCase())) return next();
  const command = match[1]?.toLowerCase();
  if (!command || !CONFIG_COMMANDS.has(command)) return next();
  if (!ctx.from || !ctx.me?.username) return next();
  if (!(await ensureGroupAdmin(ctx))) return;

  const deepLink = `https://t.me/${ctx.me.username}?start=settings_${ctx.chat.id}`;
  await ctx.reply(
    tr("⚙️ <b>Ajustes del grupo</b>\n\nAbre los ajustes de este grupo en el panel privado. Los comandos con parámetros siguen disponibles aquí, por ejemplo /captcha on."),
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: tr("Abrir configuración"), url: deepLink }]],
      },
    },
  );
}
