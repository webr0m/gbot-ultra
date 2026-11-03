import { tr } from "../../services/bot-i18n.js";
import type { Bot } from "grammy";
import { config } from "../../config.js";
import { getChat, getAdminChatsForUser, getActiveChats } from "../../db/repositories/chats.js";
import { showPanel } from "../panel.js";
import { logger } from "../../logger.js";
import { formatDate } from "../../utils/date.js";
import { escapeHtml, formatNumber } from "../../utils/format.js";
import { getChatMemberSafe } from "../../utils/telegram.js";
import {
  PREMIUM_PERKS,
  PREMIUM_PLANS,
  createInvoicePayload,
  getPaymentHistory,
  getPlan,
  getPremiumStatus,
  premiumPlanLabel,
  redeemPremiumCode,
} from "../../services/premium.js";
import type { AppContext } from "../context.js";
import { chatSelectionKeyboard, premiumPlansKeyboard } from "../keyboards.js";
import { ensureGroupAdmin, notify, replyTemp } from "../middleware.js";
import { premiumStatusText } from "../texts.js";

async function canManageChat(ctx: AppContext, chatId: number): Promise<boolean> {
  if (ctx.app.isOwner) return true;
  if (ctx.chat?.id === chatId && ctx.app.isAdmin) return true;
  if (!ctx.from) return false;
  const member = await getChatMemberSafe(ctx.api, chatId, ctx.from.id);
  return member?.status === "creator" || member?.status === "administrator";
}

export async function showPremiumForChat(ctx: AppContext, chatId: number): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) {
    await notify(
      ctx,
      tr("⚠️ Ese grupo no está registrado en el bot. Añádeme al grupo y vuelve a intentarlo."),
    );
    return;
  }
  if (!(await canManageChat(ctx, chatId))) {
    await notify(ctx, tr("🛡️ Solo los administradores del grupo pueden gestionar Premium."));
    return;
  }

  const status = getPremiumStatus(chat);
  if(ctx.app.isOwner){await ctx.reply(tr("⚙️ Consulta la configuración de tu cuenta desde /panel."),{parse_mode:'HTML'});return;}
  const privateChat = ctx.chat?.type === "private";
  const history = await getPaymentHistory(chatId, 3);

  const lines = [
    premiumStatusText(
      escapeHtml(chat.title),
      status.active,
      premiumPlanLabel(status.plan),
      status.until ? formatDate(status.until) : "—",
      status.daysLeft,
    ),
  ];

  if (history.length > 0) {
    lines.push("", tr("🧾 <b>Últimos pagos</b>"));
    for (const payment of history) {
      lines.push(
        `• ${formatDate(payment.created_at)} — ${formatNumber(payment.amount)} ⭐` +
          (payment.plan ? ` (${premiumPlanLabel(payment.plan)})` : ""),
      );
    }
  }

  await ctx.reply(lines.join("\n"), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: premiumPlansKeyboard(PREMIUM_PLANS, chatId, {
      privateChat,
      username: ctx.me.username,
    }),
  });
}

async function premiumStart(ctx: AppContext, page = 0): Promise<void> {
  if (ctx.chat && ctx.chat.type !== "private") {
    await showPremiumForChat(ctx, ctx.chat.id);
    return;
  }
  if (!ctx.from) return;
  const chats = ctx.app.isOwner ? await getActiveChats() : await getAdminChatsForUser(ctx.from.id);
  chats.sort((a, b) => a.title.localeCompare(b.title, "es"));
  if (chats.length === 0) {
    await notify(
      ctx,
      tr("👑 <b>Premium</b>\n\nNo veo grupos donde seas administrador.\n\nAñádeme a un grupo y dame permisos de administrador para empezar."),
    );
    return;
  }
  if (chats.length === 1) {
    await showPremiumForChat(ctx, chats[0]!.chat_id);
    return;
  }
  const send = ctx.callbackQuery ? ctx.editMessageText.bind(ctx) : ctx.reply.bind(ctx);
  await send(
    tr("👑 <b>Premium</b>\n\nElige el grupo que quieres mejorar:"),
    { parse_mode: "HTML", reply_markup: chatSelectionKeyboard(chats, page) },
  );
}

export function registerPremium(bot: Bot<AppContext>): void {
  bot.command("redeem", async (ctx) => {
    if (ctx.chat?.type === "private") { await showPanel(ctx, undefined, "premium"); return; }
    if (!(await ensureGroupAdmin(ctx))) return;
    const chat = ctx.app.chatRow!;
    const code = (ctx.match ?? "").trim();
    if (!code) {
      await replyTemp(
        ctx,
        tr("🎟️ <b>Canjear código Premium</b>\n\nUso: <code>/redeem GBOT-XXXX-XXXX</code>"),
      );
      return;
    }
    try {
      const result = await redeemPremiumCode(code, chat.chat_id, ctx.from!.id);
      await ctx.reply(
        tr("🎉 <b>¡Premium activado!</b>\n\n") +
          tr("Se han añadido <b>{0} día(s)</b> a <b>{1}</b>.\n", [result.days,escapeHtml(chat.title)]) +
          tr("Vence: <b>{0}</b>", [result.status.until ? formatDate(result.status.until) : "—"]),
        { parse_mode: "HTML" },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("No se pudo canjear el código.");
      await replyTemp(ctx, `⚠️ ${escapeHtml(message)}`);
    }
  });

  bot.callbackQuery("premium:start", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined);
    await premiumStart(ctx);
  });

  bot.callbackQuery(/^premium:page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined);
    await premiumStart(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(/^premium:chat:(-?\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined);
    const chatId = Number(ctx.match[1]);
    if (Number.isSafeInteger(chatId)) await showPremiumForChat(ctx, chatId);
  });

  bot.callbackQuery(/^premium:status:(-?\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined);
    const chatId = Number(ctx.match[1]);
    if (Number.isSafeInteger(chatId)) await showPremiumForChat(ctx, chatId);
  });

  bot.callbackQuery(/^premium:buy:([a-z]+):(-?\d+)$/, async (ctx) => {
    const planId = ctx.match[1] ?? "";
    const chatId = Number(ctx.match[2]);
    const plan = getPlan(planId);
    const from = ctx.from;

    if (!plan || !Number.isSafeInteger(chatId) || !from) {
      await ctx.answerCallbackQuery({ text: tr("Plan no válido."), show_alert: true });
      return;
    }
    if(config.ownerIds.has(from.id)){await ctx.answerCallbackQuery({text:tr("Tu acceso es permanente. No necesitas comprar."),show_alert:true});return;}

    if (!(await canManageChat(ctx, chatId))) {
      await ctx.answerCallbackQuery({
        text: tr("Solo los administradores pueden comprar Premium."),
        show_alert: true,
      });
      return;
    }

    const chat = await getChat(chatId);
    if (!chat) {
      await ctx.answerCallbackQuery({ text: tr("Grupo no encontrado."), show_alert: true });
      return;
    }

    try {
      const payload = createInvoicePayload(chatId, planId);
      const description = (plan.kind==='license'?tr("Pro permanente para hasta 10 grupos que administres. Asigna los cupos en el panel."):tr("{0} para {1}. Sin renovación automática.", [plan.label,chat.title])).slice(0,255);
      const prices = [{ label: tr(plan.label), amount: plan.stars }];
      const link = await ctx.api.createInvoiceLink(
        tr(plan.label),
        description,
        payload,
        "",
        "XTR",
        prices,
      );

      try {
        await ctx.api.sendInvoice(
          from.id,
          tr(plan.label),
          description,
          payload,
          "XTR",
          prices,
          { provider_token: "" },
        );
        await ctx.answerCallbackQuery({
          text: tr("🧾 Factura enviada a tu chat privado."),
          show_alert: true,
        });
      } catch (error) {
        logger.warn({ err: error, userId: from.id }, tr("No se pudo enviar la factura por privado"));
        await ctx.answerCallbackQuery({
          text: tr("Abre la factura para completar el pago."),
          url: link,
        });
      }
    } catch (error) {
      logger.error({ err: error, chatId, planId }, tr("No se pudo crear la factura de Premium"));
      await ctx.answerCallbackQuery({
        text: tr("No se pudo crear la factura. Inténtalo de nuevo."),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery("premium:perks", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined);
    const lines = [
      tr("👑 <b>Ventajas de GBot Ultra Premium</b>"),
      "",
      ...PREMIUM_PERKS.map((perk) => `${perk.emoji} <b>${tr(perk.title)}</b>\n${tr(perk.description)}`),
      "",
      tr("Premium desde <b>50 ⭐</b> por 30 días. Pro: <b>135 ⭐ una vez / 10 grupos</b>. Ultra: <b>135 ⭐ / 30 días / grupo</b>."),
    ];
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // Mantener config accesible para textos de precio en futuras versiones.
  void config;
}
