import { tr } from "../../services/bot-i18n.js";
import type { Bot } from "grammy";
import { getActiveChats, getChat, setChatActive, setChatOwner } from "../../db/repositories/chats.js";
import { getBotTotals } from "../../db/repositories/stats.js";
import {
  addGban,
  countGbans,
  removeGban,
} from "../../db/repositories/filters.js";
import {
  activatePremium,
  createPremiumCode,
  getPlan,
  getPremiumChatCount,
  getTotalStars,
  premiumPlanLabel,
} from "../../services/premium.js";
import { invalidateGban } from "../../services/antispam.js";
import { resolveUserFromReplyOrArgs } from "../../services/targets.js";
import { formatDate } from "../../utils/date.js";
import { escapeHtml, formatNumber } from "../../utils/format.js";
import { logger } from "../../logger.js";
import type { AppContext } from "../context.js";
import { ensureOwner, ensureDeveloper, notify, replyTemp } from "../middleware.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerOwner(bot: Bot<AppContext>): void {
  bot.command("gencode", async (ctx) => {
    if (!(await ensureOwner(ctx))) return;
    const args = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const days = Number(args[0]);
    const planId = args[1]?.toLowerCase();
    const tier=args[2]?.toLowerCase()??'premium';
    if(!['premium','pro','ultra'].includes(tier)){await replyTemp(ctx,tr("Nivel no válido: premium, pro o ultra."));return;}
    if(tier==='pro'){await replyTemp(ctx,tr("Pro se vende como licencia de cupos; no se genera con código."));return;}
    if (!Number.isFinite(days) || days < 1 || days > 3_650) {
      await replyTemp(ctx, tr("⚠️ Uso: <code>/gencode 30 [monthly|quarterly|yearly]</code>"));
      return;
    }
    if (planId && !getPlan(planId)) {
      await replyTemp(ctx, tr("⚠️ Plan no válido. Usa monthly, quarterly o yearly."));
      return;
    }
    const code = await createPremiumCode(Math.round(days), planId ?? null, ctx.from!.id,tier as 'premium'|'pro'|'ultra');
    const text =
      tr("🎟️ <b>Código Premium generado</b>\n\n") +
      `<code>${code}</code>\n\n` +
      tr("Días: <b>{0}</b>", [Math.round(days)]) +
      (planId ? tr("\nPlan: <b>{0}</b>", [premiumPlanLabel(planId)]) : "") +
      tr("\n\nCanjéalo en el grupo con <code>/redeem {0}</code>.", [code]);
    try {
      await ctx.api.sendMessage(ctx.from!.id, text, { parse_mode: "HTML" });
      if (ctx.chat?.type !== "private") {
        await replyTemp(ctx, tr("🎟️ Código generado y enviado a tu chat privado."));
      }
    } catch {
      await ctx.reply(text, { parse_mode: "HTML" });
    }
  });

  bot.command("grant", async (ctx) => {
    if (!(await ensureOwner(ctx))) return;
    const args = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const chatId = Number(args[0]);
    const planId = (args[1] ?? "").toLowerCase();
    const plan = getPlan(planId);
    const tier=args[2]?.toLowerCase()??'premium';
    if(!['premium','pro','ultra'].includes(tier)){await replyTemp(ctx,tr("Nivel no válido: premium, pro o ultra."));return;}
    if (!Number.isSafeInteger(chatId) || chatId === 0 || !plan) {
      await replyTemp(ctx, tr("⚠️ Uso: <code>/grant -1001234567890 monthly</code>"));
      return;
    }
    const chat = await getChat(chatId);
    if (!chat) {
      await replyTemp(ctx, tr("⚠️ Ese grupo no está registrado en el bot."));
      return;
    }
    const result = await activatePremium(chatId, planId, {
      userId: ctx.from!.id,
      amount: 0,
      tier:tier as 'premium'|'pro'|'ultra',
    });
    await replyTemp(
      ctx,
      tr("👑 Premium concedido a <b>{0}</b>.\n", [escapeHtml(chat.title)]) +
        tr("Plan: <b>{0}</b>\n", [plan.label]) +
        tr("Vence: <b>{0}</b>", [result.status.until ? formatDate(result.status.until) : "—"]),
    );
    try {
      await ctx.api.sendMessage(
        chatId,
        tr("👑 <b>Premium activado</b>\n\nEl propietario del bot ha activado el plan ") +
          tr("<b>{0}</b> para este grupo.\nVence: <b>{1}</b>", [plan.label,result.status.until ? formatDate(result.status.until) : "—"]),
        { parse_mode: "HTML" },
      );
    } catch {
      // Sin permisos para avisar en el grupo.
    }
  });

  bot.command("botstats", async (ctx) => {
    if (!(await ensureOwner(ctx))) return;
    const [totals, gbans, premiumChats, stars] = await Promise.all([
      getBotTotals(),
      countGbans(),
      getPremiumChatCount(),
      getTotalStars(),
    ]);
    await ctx.reply(
      tr("📊 <b>GBot Ultra · Estadísticas globales</b>\n\n") +
        tr("👥 Usuarios: <b>{0}</b>\n", [formatNumber(totals.users)]) +
        tr("💬 Grupos activos: <b>{0}</b>\n", [formatNumber(totals.chats)]) +
        tr("👑 Grupos Premium: <b>{0}</b>\n", [formatNumber(premiumChats)]) +
        tr("💬 Mensajes registrados: <b>{0}</b>\n", [formatNumber(totals.messages)]) +
        tr("🛡️ Acciones: <b>{0}</b>\n", [formatNumber(totals.actions)]) +
        tr("⭐ Stars recaudadas: <b>{0}</b>\n", [formatNumber(stars)]) +
        tr("🚫 Baneos globales: <b>{0}</b>\n", [formatNumber(gbans)]) +
        tr("🕒 Versión: <b>1.0.0</b>"),
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
  });

  bot.command("broadcast", async (ctx) => {
    if (!(await ensureOwner(ctx))) return;
    const reply = ctx.msg?.reply_to_message;
    const text = (reply?.text ?? reply?.caption ?? ctx.match ?? "").trim();
    if (!text) {
      await replyTemp(
        ctx,
        tr("📣 <b>Difusión</b>\n\nUso: <code>/broadcast mensaje</code> o responde a un mensaje."),
      );
      return;
    }

    const chats = await getActiveChats();
    const target = chats.slice(0, 1_000);
    let sent = 0;
    let failed = 0;

    await replyTemp(
      ctx,
      tr("📣 Enviando a <b>{0}</b> grupo(s)… Te avisaré al terminar.", [target.length]),
      { seconds: 0 },
    );

    for (const chat of target) {
      try {
        await ctx.api.sendMessage(chat.chat_id, text, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
        sent += 1;
      } catch (error) {
        try {
          await ctx.api.sendMessage(chat.chat_id, text);
          sent += 1;
        } catch (fallbackError) {
          failed += 1;
          logger.warn(
            { err: fallbackError, chatId: chat.chat_id },
            tr("No se pudo enviar la difusión"),
          );
        }
      }
      await sleep(45);
    }

    await replyTemp(
      ctx,
      tr("📣 <b>Difusión completada</b>\n\n✅ Enviados: <b>{0}</b>\n❌ Fallidos: <b>{1}</b>", [sent,failed]),
      { seconds: 60 },
    );
  });

  bot.command("gban", async (ctx) => {
    if (!(await ensureDeveloper(ctx))) return;
    if (!ctx.from) return;
    const resolved = await resolveUserFromReplyOrArgs(
      ctx.api,
      ctx.chat?.id ?? ctx.from.id,
      ctx.msg!,
      ctx.match ?? "",
    );
    if (!resolved.ok || !resolved.userId) {
      await replyTemp(ctx, `⚠️ ${escapeHtml(resolved.error ?? tr("Usuario no válido."))}`);
      return;
    }
    await addGban(resolved.userId, resolved.rest || null, ctx.from.id);
    invalidateGban(resolved.userId);
    if (ctx.chat && ctx.chat.type !== "private") {
      try {
        await ctx.api.banChatMember(ctx.chat.id, resolved.userId, { revoke_messages: true });
      } catch {
        // Puede no ser miembro del grupo actual.
      }
    }
    await replyTemp(
      ctx,
      tr("🚫 <b>Baneo global añadido</b>\nID: <code>{0}</code>", [resolved.userId]) +
        (resolved.rest ? tr("\n📝 Motivo: {0}", [escapeHtml(resolved.rest)]) : ""),
    );
  });

  bot.command("ungban", async (ctx) => {
    if (!(await ensureDeveloper(ctx))) return;
    if (!ctx.from) return;
    const resolved = await resolveUserFromReplyOrArgs(
      ctx.api,
      ctx.chat?.id ?? ctx.from.id,
      ctx.msg!,
      ctx.match ?? "",
    );
    if (!resolved.ok || !resolved.userId) {
      await replyTemp(ctx, `⚠️ ${escapeHtml(resolved.error ?? tr("Usuario no válido."))}`);
      return;
    }
    const removed = await removeGban(resolved.userId,ctx.from.id);
    invalidateGban(resolved.userId);
    await replyTemp(
      ctx,
      removed
        ? tr("✅ Baneo global eliminado para <code>{0}</code>.", [resolved.userId])
        : tr("ℹ️ Ese usuario no tiene baneo global."),
    );
  });

  bot.command("chats", async (ctx) => {
    if (!(await ensureOwner(ctx))) return;
    const chats = await getActiveChats();
    if (chats.length === 0) {
      await replyTemp(ctx, tr("📭 No hay grupos activos."));
      return;
    }
    const lines = [tr("💬 <b>Grupos activos ({0})</b>", [chats.length]), ""];
    for (const chat of chats.slice(0, 40)) {
      const premium =
        chat.premium_until && chat.premium_until.getTime() > Date.now()
          ? ` · 👑 ${premiumPlanLabel(chat.premium_plan)}`
          : "";
      lines.push(
        `• <b>${escapeHtml(chat.title)}</b> — <code>${chat.chat_id}</code>${premium}`,
      );
    }
    if (chats.length > 40) lines.push(tr("… y {0} más.", [chats.length - 40]));
    await replyTemp(ctx, lines.join("\n"), { seconds: 60 });
  });

  bot.command("leave", async (ctx) => {
    if (!(await ensureOwner(ctx))) return;
    const chatId = Number((ctx.match ?? "").trim().split(/\s+/)[0]);
    if (!Number.isSafeInteger(chatId) || chatId === 0) {
      await replyTemp(ctx, tr("⚠️ Uso: <code>/leave -1001234567890</code>"));
      return;
    }
    try {
      await ctx.api.leaveChat(chatId);
      await setChatActive(chatId, false);
      await replyTemp(ctx, tr("👋 He salido del chat <code>{0}</code>.", [chatId]));
    } catch (error) {
      await replyTemp(
        ctx,
        tr("⚠️ No pude salir del chat: {0}", [escapeHtml(
          error instanceof Error ? error.message : tr("error desconocido"),
        )]),
      );
    }
  });

  bot.command("setowner", async (ctx) => {
    if (!(await ensureOwner(ctx))) return;
    const args = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const chatId = Number(args[0]);
    const userId = Number(args[1]);
    if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(userId)) {
      await replyTemp(ctx, tr("⚠️ Uso: <code>/setowner -1001234567890 123456789</code>"));
      return;
    }
    const chat = await getChat(chatId);
    if (!chat) {
      await replyTemp(ctx, tr("⚠️ Ese grupo no está registrado."));
      return;
    }
    await setChatOwner(chatId, userId);
    await replyTemp(ctx, tr("✅ Propietario de <b>{0}</b> establecido en <code>{1}</code>.", [escapeHtml(chat.title),userId]));
  });

  bot.command("ownerhelp", async (ctx) => {
    if (!(await ensureOwner(ctx))) return;
    await notify(
      ctx,
      tr("👑 <b>Comandos de propietario</b>\n\n/gencode días [plan] — Genera un código Premium\n/grant chatId plan — Activa Premium directamente\n/broadcast texto — Envía un mensaje a todos los grupos\n/botstats — Estadísticas globales\n/chats — Lista de grupos activos\n/gban /ungban — Baneos globales\n/leave chatId — Salir de un grupo\n/setowner chatId userId — Cambiar propietario"),
    );
  });
}
