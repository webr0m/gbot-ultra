import { memberMutation } from "../services/sanction-journal.js";
import { tr } from "../services/bot-i18n.js";
import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { config } from "../config.js";
import { getChat, setChatActive, setChatOwner } from "../db/repositories/chats.js";
import { bumpDaily } from "../db/repositories/stats.js";
import { upsertMember } from "../db/repositories/members.js";
import { upsertUser } from "../db/repositories/users.js";
import { addBoost, removeBoost } from "../db/repositories/boosts.js";
import { logModeration } from "../db/repositories/moderation.js";
import { syncAdmins } from "../services/admins.js";
import { invalidateChat, loadChat } from "../services/chat-cache.js";
import { isPremium, activatePremium, getPlan, parseInvoicePayload } from "../services/premium.js";
import { raidJoin, beginJoinGate, scopeExemptions, runtimeAdvanced } from '../services/advanced-engine.js';
import { sendCaptcha } from "../services/captcha.js";
import { sendGoodbye, sendWelcome } from "../services/welcome.js";
import { logger } from "../logger.js";
import { formatDate } from "../utils/date.js";
import {
  invalidateAdminCache,
  isGroupChat,
  safeDelete,
} from "../utils/telegram.js";
import type { AppContext } from "./context.js";
import { query as dbQuery } from '../db/pool.js';
import { globalBan } from '../services/global-bans.js';
import { rememberJoin,finishJoin } from '../services/inbox.js';

async function sendSetupMessage(ctx: AppContext, chatId: number): Promise<void> {
  const keyboard = new InlineKeyboard();
  if (config.hasWebapp) {
    keyboard
      .url(tr("🌐 Abrir panel"), `https://t.me/${ctx.me.username}?start=panel_${chatId}`)
      .row();
  }
  keyboard.url(tr("📚 Ayuda"), `https://t.me/${ctx.me.username}?start=help`);
  try {
    await ctx.api.sendMessage(
      chatId,
      tr("✅ <b>¡Gracias por añadir GBot Ultra!</b>\n\nPara que pueda proteger el grupo, dame permisos de <b>administrador</b>:\n• Eliminar mensajes\n• Restringir miembros\n• Banear miembros\n• Fijar mensajes\n\nDespués abre el panel o usa /settings para configurar todo."),
      {
        parse_mode: "HTML",
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      },
    );
  } catch (error) {
    logger.warn({ err: error, chatId }, tr("No se pudo enviar el mensaje de bienvenida al bot"));
  }
}

export function registerEvents(bot: Bot<AppContext>): void {
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    if (!update) return;
    const chat = update.chat;
    if (!isGroupChat(chat)) return;

    const newStatus = update.new_chat_member.status;
    const oldStatus = update.old_chat_member.status;
    const added = oldStatus === "left" || oldStatus === "kicked";

    if (newStatus === "member" || newStatus === "administrator") {
      try {
        if (added) {
          await setChatActive(chat.id, true);
          invalidateChat(chat.id);
        }
        const row = await loadChat(chat);
        if (added && update.from && !update.from.is_bot) {
          await setChatOwner(row.chat_id, update.from.id);
        }
        await syncAdmins(ctx.api, chat.id);
        if (added) {
          await sendSetupMessage(ctx, chat.id);
        } else if (newStatus === "administrator" && oldStatus === "member") {
          await ctx.api
            .sendMessage(
              chat.id,
              tr("🛡️ <b>¡Ahora soy administrador!</b>\n\nYa puedo moderar, dar la bienvenida y proteger el grupo. Usa /settings para configurarlo."),
              { parse_mode: "HTML" },
            )
            .catch(() => undefined);
        }
      } catch (error) {
        logger.warn({ err: error, chatId: chat.id }, tr("Error al registrar el grupo"));
      }
      return;
    }

    if (newStatus === "left" || newStatus === "kicked") {
      await setChatActive(chat.id, false).catch(() => undefined);
      invalidateChat(chat.id);
      logger.info({ chatId: chat.id }, tr("El bot ha salido del grupo"));
    }
  });

  bot.on("chat_member", async (ctx) => {
    const update = ctx.chatMember;
    if (!update) return;
    const chat = update.chat;
    if (!isGroupChat(chat)) return;

    const user = update.new_chat_member.user;
    if (user.is_bot) return;

    const oldStatus = update.old_chat_member.status;
    const newStatus = update.new_chat_member.status;

    try {
      const canKeepPro=newStatus==='creator'||(newStatus==='administrator'&&(update.new_chat_member.can_restrict_members||update.new_chat_member.can_delete_messages));
      if(!canKeepPro){await dbQuery('UPDATE chats SET pro_license_id=NULL,pro_owner_id=NULL WHERE chat_id=$1 AND pro_owner_id=$2',[chat.id,user.id]);invalidateChat(chat.id);}
      await upsertUser({
        id: user.id,
        username: user.username ?? null,
        first_name: user.first_name ?? "",
        last_name: user.last_name ?? null,
        language_code: user.language_code ?? null,
        is_bot: user.is_bot,
      });
      await upsertMember({
        chatId: chat.id,
        userId: user.id,
        status: newStatus,
        isBot: user.is_bot,
        customTitle: (update.new_chat_member as { custom_title?: string }).custom_title ?? null,
      });
      if(['member','administrator','creator'].includes(newStatus))await finishJoin(chat.id,user.id);
      if (
        newStatus === "administrator" ||
        newStatus === "creator" ||
        oldStatus === "administrator" ||
        oldStatus === "creator" ||
        newStatus === "restricted"
      ) {
        invalidateAdminCache(chat.id);
      }
    } catch (error) {
      logger.warn({ err: error, chatId: chat.id, userId: user.id }, tr("Error actualizando miembro"));
    }
  });

  bot.on("message:new_chat_members", async (ctx) => {
    if (!ctx.chat || !isGroupChat(ctx.chat)) return;
    const chat = ctx.app.chatRow;
    if (!chat) return;
    const message = ctx.message;
    if (!message) return;
    const settings = ctx.app.settings;
    const users = message.new_chat_members ?? [];

    let memberCount: number | undefined;
      if (settings.welcome.enabled && settings.welcome.text.includes("{count}")) {
        try {
          memberCount = await ctx.api.getChatMemberCount(ctx.chat.id);
        } catch {
          memberCount = undefined;
        }
    }

    for (const user of users) {
      if (user.is_bot) continue;
      try {
        await upsertUser({
          id: user.id,
          username: user.username ?? null,
          first_name: user.first_name ?? "",
          last_name: user.last_name ?? null,
          language_code: user.language_code ?? null,
          is_bot: false,
        });
        await upsertMember({
          chatId: chat.chat_id,
          userId: user.id,
          status: "member",
          isBot: false,
          resetJoinedAt: true,
        });
        await finishJoin(chat.chat_id,user.id);
        void bumpDaily(chat.chat_id, "joins").catch(() => undefined);

        const global=await globalBan(user.id);
        if (global.banned) {
          try {
            await memberMutation(chat.chat_id,user.id,()=>ctx.api.banChatMember(chat.chat_id, user.id, { revoke_messages: true,until_date:global.source==='cas'?Math.floor(Date.now()/1000)+86400:undefined }));
            await logModeration({
              chatId: chat.chat_id,
              targetId: user.id,
              action: "ban",
              reason: global.source==='cas'?tr("CAS: registro externo de spam"):global.reason??tr("Baneo global (GBot)"),
              metadata: { automated: true, source: "join",externalSource:global.source,checkedAt:global.checkedAt },
            });
          } catch (error) {
            logger.warn({ err: error, userId: user.id }, tr("No se pudo banear globalmente al unirse"));
          }
          continue;
        }

        if(await raidJoin(ctx.api,chat,ctx.chat,user,settings,ctx.app.botId))continue;
        await sendWelcome(ctx.api, ctx.chat, user, settings, memberCount,(await runtimeAdvanced(chat)).topics.welcomeThreadId);
        if (settings.captcha.enabled && !config.ownerIds.has(user.id) && !(await scopeExemptions(chat,user.id)).includes('captcha')) {
          await sendCaptcha(ctx.api, ctx.chat, user, settings);
        }
      } catch (error) {
        logger.warn({ err: error, chatId: chat.chat_id, userId: user.id }, tr("Error procesando entrada"));
      }
    }

    if (settings.serviceMessages.deleteJoins) {
      await safeDelete(ctx.api, chat.chat_id, message.message_id);
    }
  });

  bot.on("message:left_chat_member", async (ctx) => {
    if (!ctx.chat || !isGroupChat(ctx.chat)) return;
    const chat = ctx.app.chatRow;
    const message = ctx.message;
    const user = message?.left_chat_member;
    if (!chat || !message || !user || user.is_bot) return;

    try {
      await upsertUser({
        id: user.id,
        username: user.username ?? null,
        first_name: user.first_name ?? "",
        last_name: user.last_name ?? null,
        language_code: user.language_code ?? null,
        is_bot: false,
      });
      await upsertMember({
        chatId: chat.chat_id,
        userId: user.id,
        status: "left",
        isBot: false,
      });
      void bumpDaily(chat.chat_id, "leaves").catch(() => undefined);
      await sendGoodbye(ctx.api, ctx.chat, user, ctx.app.settings);
    } catch (error) {
      logger.warn({ err: error, chatId: chat.chat_id, userId: user.id }, tr("Error procesando salida"));
    }

    if (ctx.app.settings.serviceMessages.deleteJoins) {
      await safeDelete(ctx.api, chat.chat_id, message.message_id);
    }
  });

  bot.on("chat_join_request", async (ctx) => {
    const request = ctx.chatJoinRequest;
    if (!request) return;
    const chat = request.chat;
    if (!isGroupChat(chat)) return;
    const chatRow = ctx.app.chatRow ?? (await getChat(chat.id));
    if (!chatRow) return;

    await rememberJoin(request);
    if ((await globalBan(request.from.id)).banned) {
      try{await ctx.api.declineChatJoinRequest(chat.id, request.from.id);await finishJoin(chat.id,request.from.id,'declined');}catch{/* Keep the request available for manual review. */}
      return;
    }

    const settings = ctx.app.settings;
    if(await beginJoinGate(ctx.api,chatRow,request))return;
    if (settings.joinRequests.autoApprove && isPremium(chatRow)) {
      try {
        await ctx.api.approveChatJoinRequest(chat.id, request.from.id);
        await finishJoin(chat.id,request.from.id);
        await upsertUser({
          id: request.from.id,
          username: request.from.username ?? null,
          first_name: request.from.first_name ?? "",
          last_name: request.from.last_name ?? null,
          language_code: request.from.language_code ?? null,
          is_bot: false,
        });
      } catch (error) {
        logger.warn({ err: error, chatId: chat.id }, tr("No se pudo aprobar la solicitud"));
      }
    }
  });

  bot.on("chat_boost", async (ctx) => {
    const update = ctx.chatBoost;
    if (!update) return;
    const chat = update.chat;
    if (!isGroupChat(chat)) return;
    try {
      await loadChat(chat);
      const userId =
        (update.boost.source as { user?: { id: number } }).user?.id ?? null;
      await addBoost(chat.id, update.boost.boost_id, userId);
    } catch (error) {
      logger.warn({ err: error, chatId: chat.id }, tr("No se pudo registrar el boost"));
    }
  });

  bot.on("removed_chat_boost", async (ctx) => {
    const update = ctx.removedChatBoost;
    if (!update) return;
    try {
      await removeBoost(update.chat.id, update.boost_id);
    } catch (error) {
      logger.warn({ err: error, chatId: update.chat.id }, tr("No se pudo eliminar el boost"));
    }
  });

  bot.on("pre_checkout_query", async (ctx) => {
    const query = ctx.preCheckoutQuery;
    if (!query) return;
    const parsed = parseInvoicePayload(query.invoice_payload);
    if (!parsed || query.currency!=='XTR' || query.total_amount!==getPlan(parsed.planId)?.stars || config.ownerIds.has(query.from.id)) {
      await ctx.answerPreCheckoutQuery(false, {
        error_message: tr("La factura no es válida. Vuelve a intentarlo desde /premium."),
      });
      return;
    }
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on("message:successful_payment", async (ctx) => {
    const payment = ctx.message?.successful_payment;
    if (!payment || !ctx.from) return;
    const parsed = parseInvoicePayload(payment.invoice_payload);
    if (!parsed) {
      logger.warn({ payload: payment.invoice_payload }, tr("Pago con payload desconocido"));
      return;
    }

    try {
      const result = await activatePremium(parsed.chatId, parsed.planId, {
        userId: ctx.from.id,
        chargeId: payment.telegram_payment_charge_id,
        payload: payment.invoice_payload,
        amount: payment.total_amount,
      });
      const plan = getPlan(parsed.planId);
      const until = result.status.until ? formatDate(result.status.until) : "—";
      const text =
        tr("🎉 <b>¡Pago completado!</b>\n\n") +
        tr("Plan: <b>{0}</b>\n", [plan?.label ?? parsed.planId]) +
        tr("Importe: <b>{0} ⭐</b>\n", [payment.total_amount]) +
        (plan?.kind==='license'?tr("Licencia permanente: <b>10 cupos Pro</b>. Abre /panel → Premium para asignarlos."):tr("Suscripción hasta: <b>{0}</b>", [until])) +
        (result.duplicate ? tr("\n\nℹ️ Este pago ya estaba registrado.") : "");

      await ctx.api
        .sendMessage(parsed.chatId, text, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        })
        .catch(() => undefined);

      await ctx.api
        .sendMessage(
          ctx.from.id,
          tr("🧾 <b>Gracias por tu compra</b>\n\n{0}\n\nPuedes gestionar el grupo con /panel.", [text]),
          { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
        )
        .catch(() => undefined);

      logger.info(
        {
          chatId: parsed.chatId,
          userId: ctx.from.id,
          plan: parsed.planId,
          amount: payment.total_amount,
          duplicate: result.duplicate,
        },
        tr("Pago Premium procesado"),
      );
    } catch (error) {
      logger.error({ err: error, payload: payment.invoice_payload }, tr("Error activando Premium tras el pago"));
      await ctx.api
        .sendMessage(
          ctx.from.id,
          tr("⚠️ Hemos recibido tu pago pero no pudimos activar Premium. Contacta con soporte."),
        )
        .catch(() => undefined);
      throw error; // Let Telegram retry; the charge ledger prevents a second credit.
    }
  });
}
