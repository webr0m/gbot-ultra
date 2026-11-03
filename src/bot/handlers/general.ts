import { InlineKeyboard } from "grammy";
import { tr } from "../../services/bot-i18n.js";
import type { Bot } from "grammy";
import { config, webappUrlForChat } from "../../config.js";
import { getBotRightsMap, messageLink, safeDelete, RIGHT_LABELS } from "../../utils/telegram.js";
import { displayName, escapeHtml, formatNumber, mentionUser } from "../../utils/format.js";
import { showLanguageSelector } from "./settings.js";
import {
  getChartData,
  getGroupStats,
  getTopMembers,
} from "../../services/stats.js";
import { patchChatSettings } from "../../services/chat-cache.js";
import { getActiveChats, getAdminChatsForUser, getChat } from "../../db/repositories/chats.js";
import type { AppContext } from "../context.js";
import { chatSelectionKeyboard, helpKeyboard, mainMenuKeyboard } from "../keyboards.js";
import {
  ensureGroupAdmin,
  notify,
  replyTemp,
} from "../middleware.js";
import {
  helpText,
  rulesText,
  startGroup,
  startPrivate,
} from "../texts.js";
import { showPremiumForChat } from "./premium.js";
import { showPanel } from "../panel.js";
import { rememberReport } from '../../services/inbox.js';
import { globalRole, globalRoleLabel } from "../../services/roles.js";

const reportCooldowns = new Map<string, number>();

function sparkline(values: number[]): string {
  const chars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const max = Math.max(...values, 1);
  return values
    .map((value) => chars[Math.min(chars.length - 1, Math.round((value / max) * (chars.length - 1)))])
    .join("");
}

function settingsSummary(ctx: AppContext): string {
  const settings = ctx.app.settings;
  const on = (value: boolean) => (value ? "✅" : "❌");
  return (
    tr("👋 Bienvenida: {0} · ", [on(settings.welcome.enabled)]) +
    tr("🚪 Despedida: {0}\n", [on(settings.goodbye.enabled)]) +
    tr("🤖 Captcha: {0} ({1}) · ", [on(settings.captcha.enabled),settings.captcha.mode]) +
    tr("🔗 Antienlaces: {0} ({1})\n", [on(settings.antilink.enabled),settings.antilink.action]) +
    tr("🌊 Antiflood: {0} ", [on(settings.antiflood.enabled)]) +
    tr("({0}/{1}s) · ", [settings.antiflood.limit,settings.antiflood.windowSeconds]) +
    tr("🚫 Lista negra: {0}\n", [on(settings.blacklist.enabled)]) +
    tr("⚠️ Warns: {0} ", [on(settings.warnings.enabled)]) +
    `(${settings.warnings.limit} → ${settings.warnings.action}) · ` +
    tr("📋 Logs: {0}", [on(settings.logs.enabled)])
  );
}

export function registerGeneral(bot: Bot<AppContext>): void {
  bot.command("start", async (ctx) => {
    const payload = (ctx.match ?? "").trim();
    const isPrivate = ctx.chat?.type === "private";

    if (!isPrivate) {
      await ctx.reply(startGroup(), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
      return;
    }

    if(payload==='broadcast'){
      const {assertDeveloper}=await import('../../services/roles.js');assertDeveloper(ctx.from!.id);
      const url=new URL(config.webappUrl);url.searchParams.set('tool','broadcast');url.searchParams.set('tab','settings');
      await ctx.reply(tr("Prepara y revisa la difusión desde el panel antes de enviarla."),{reply_markup:new InlineKeyboard().webApp(tr("Abrir herramienta"),url.href)});return;
    }
    if (payload.startsWith("premium_")) {
      const chatId = Number(payload.slice("premium_".length));
      if (Number.isSafeInteger(chatId) && chatId !== 0) {
        await showPremiumForChat(ctx, chatId);
        return;
      }
    }
    if(payload==='premium'){await ctx.reply(tr("👑 Premium: 50 ⭐ / 30 días por grupo.\n🚀 Pro: 135 ⭐ una vez para 10 grupos.\n👑 Ultra: 135 ⭐ / 30 días por grupo.\n\nAbre /premium para elegir el grupo y consultar los planes."));return;}

    if (/^(panel|settings)_/.test(payload)) {
      const chatId = Number(payload.replace(/^(panel|settings)_/, ""));
      if (Number.isSafeInteger(chatId) && chatId !== 0) {
        await showPanel(ctx, chatId, payload.startsWith("settings_") ? "settings" : "home");
        return;
      }
    }

    if (payload.startsWith("language_")) {
      const chatId = Number(payload.slice("language_".length));
      if (Number.isSafeInteger(chatId) && chatId !== 0) {
        await showLanguageSelector(ctx, chatId);
        return;
      }
    }

    const webappUrl = config.hasWebapp ? config.webappUrl : "";
    const sponsored =
      !ctx.app.isOwner && config.adSponsoredEnabled
        ? `\n\n📢 <a href="${escapeHtml(config.adSponsoredUrl)}">${escapeHtml(config.adSponsoredText)}</a>`
        : "";
    const rank = globalRoleLabel(globalRole(ctx.from!.id, config.ownerIds));
    await ctx.reply(startPrivate(escapeHtml(displayName(ctx.from!)), config.hasWebapp) + sponsored, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: mainMenuKeyboard(ctx.me.username, webappUrl || null, config.supportUrl,ctx.from!.id),
    });
  });

  bot.command("help", async (ctx) => {
    const sponsored =
      !ctx.app.isOwner && !ctx.app.premium && config.adSponsoredEnabled
        ? `\n\n📢 <a href="${escapeHtml(config.adSponsoredUrl)}">${escapeHtml(config.adSponsoredText)}</a>`
        : "";
    await ctx.reply(helpText("main") + sponsored, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: helpKeyboard(),
    });
  });

  bot.command("id", async (ctx) => {
    const lines = [
      tr("🆔 <b>Identificadores</b>"),
      "",
      tr("👤 Tu ID: <code>{0}</code>", [ctx.from?.id ?? "—"]),
    ];
    if (ctx.chat) {
      lines.push(tr("💬 Chat: <code>{0}</code> · {1}", [ctx.chat.id,escapeHtml(ctx.chat.title ?? ctx.chat.first_name ?? "")]));
    }
    if (ctx.msg) lines.push(tr("📨 Mensaje: <code>{0}</code>", [ctx.msg.message_id]));
    if(ctx.msg?.message_thread_id)lines.push(tr("🧵 Tema: <code>{0}</code>", [ctx.msg.message_thread_id]));
    const reply = ctx.msg?.reply_to_message?.from;
    if (reply) {
      lines.push(tr("↩️ Usuario respondido: <code>{0}</code> · {1}", [reply.id,escapeHtml(displayName(reply))]));
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });

  bot.command(["panel", "config", "ajustes"], async (ctx) => {
    if (!ctx.chat) return;
    if (ctx.chat.type !== "private") {
      if (!(await ensureGroupAdmin(ctx))) return;
      await ctx.reply(
        tr("🌐 <b>Panel de control</b>\n\nAbre la Mini App desde el chat privado del bot. Telegram solo permite botones Web App en chats privados."),
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: tr("🌐 Abrir panel"),
                  url: `https://t.me/${ctx.me.username}?start=panel_${ctx.chat.id}`,
                },
              ],
            ],
          },
        },
      );
      return;
    }

    await showPanel(ctx, undefined, ctx.message?.text?.startsWith("/panel") ? "home" : "settings");
  });

  bot.command(["status", "estado"], async (ctx) => {
    if (ctx.chat?.type === "private") { await showPanel(ctx); return; }
    if (!(await ensureGroupAdmin(ctx))) return;
    const rights = await getBotRightsMap(ctx.api, ctx.chat!.id, ctx.app.botId);
    const check = (value: boolean) => value ? "✅" : "⚠️";
    await ctx.reply(tr("🩺 <b>Estado de {0}</b>\n\n", [escapeHtml(ctx.chat!.title ?? tr("tu grupo"))]) +
      tr("{0} Bot administrador\n{1} Eliminar mensajes\n", [check(rights.isAdmin),check(rights.can_delete_messages)]) +
      tr("{0} Restringir miembros\n{1} Fijar mensajes\n\n", [check(rights.can_restrict_members),check(rights.can_pin_messages)]) +
      tr("🛡️ Antienlaces: {0}\n", [ctx.app.settings.antilink.enabled ? tr("activo") : tr("desactivado")]) +
      tr("🌊 Antiflood: {0}\n", [ctx.app.settings.antiflood.enabled ? tr("activo") : tr("desactivado")]) +
      tr("🤖 Captcha: {0}\n\n", [ctx.app.settings.captcha.enabled ? tr("activo") : tr("desactivado")]) +
      tr("Revisa los avisos y los ajustes desde el panel. /config abre la configuración; /help muestra los comandos."), {
        parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: tr("📱 Revisar panel"), url: `https://t.me/${ctx.me.username}?start=panel_${ctx.chat!.id}` }]] },
      });
  });

  bot.command("info", async (ctx) => {
    if (!ctx.chat) return;

    if (ctx.chat.type === "private") {
      const user = ctx.from!;
      await ctx.reply(
        tr("ℹ️ <b>Tu información</b>\n\n") +
          tr("👤 Nombre: <b>{0}</b>\n", [escapeHtml(displayName(user))]) +
          tr("🆔 ID: <code>{0}</code>\n", [user.id]) +
          (user.username ? tr("🔗 Usuario: @{0}\n", [escapeHtml(user.username)]) : "") +
          tr("🌐 Idioma: {0}", [escapeHtml(user.language_code ?? "—")]) +
          "",
        { parse_mode: "HTML" },
      );
      return;
    }

    const stats = await getGroupStats(ctx.api, ctx.chat.id);
    const rights = await getBotRightsMap(ctx.api, ctx.chat.id, ctx.app.botId);
    const missing = Object.entries(rights)
      .filter(([key, value]) => key !== "isAdmin" && value !== true)
      .map(([key]) => RIGHT_LABELS[key] || key.replace("can_", "").replaceAll("_", " "));

    const lines = [
      `ℹ️ <b>${escapeHtml(ctx.chat.title ?? tr("Grupo"))}</b>`,
      "",
      tr("🆔 ID: <code>{0}</code>", [ctx.chat.id]),
      ctx.chat.username ? `🔗 @${escapeHtml(ctx.chat.username)}` : "",
      tr("👥 Miembros: <b>{0}</b> · ", [formatNumber(stats.memberCount)]) +
        tr("🛡️ Admins: <b>{0}</b> · ", [formatNumber(stats.adminCount)]) +
        tr("🤖 Bots: <b>{0}</b>", [formatNumber(stats.botCount)]),
      tr("📊 Mensajes hoy: <b>{0}</b> · ", [formatNumber(stats.messagesToday)]) +
        tr("7 días: <b>{0}</b>", [formatNumber(stats.messages7d)]),
      tr("🚪 Entradas hoy: <b>{0}</b> · ", [formatNumber(stats.joinsToday)]) +
        tr("Salidas: <b>{0}</b>", [formatNumber(stats.leavesToday)]),
      tr("⚠️ Warns: <b>{0}</b> · ", [formatNumber(stats.warnings)]) +
        tr("🛡️ Acciones hoy: <b>{0}</b>", [formatNumber(stats.actionsToday)]),
      "",
      stats.premium
        ? tr("👑 <b>Premium activo</b> · {0} día(s)", [stats.premiumDaysLeft])
        : tr("👑 Plan gratuito · <b>{0} acciones/día</b>", [config.freeActionLimit]),
      "",
      `<b>Ajustes</b>`,
      settingsSummary(ctx),
    ].filter(Boolean);

    if (!rights.isAdmin) {
      lines.push("", tr("⚠️ <b>No soy administrador</b>. Añádeme como admin para moderar."));
    } else if (missing.length > 0) {
      lines.push("", tr("⚠️ Permisos que me faltan: {0}", [escapeHtml(missing.join(", "))]));
    }

    const reply = ctx.msg?.reply_to_message?.from;
    if (reply) {
      lines.push(
        "",
        tr("👤 <b>Usuario respondido</b>"),
        tr("Nombre: {0}", [mentionUser(reply)]),
        tr("ID: <code>{0}</code>", [reply.id]),
        reply.username ? tr("Usuario: @{0}", [escapeHtml(reply.username)]) : "",
      );
    }

    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("rules", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") {
      await notify(ctx, tr("⚠️ Este comando solo funciona en grupos."));
      return;
    }
    const chat = ctx.app.chatRow;
    if (!chat) return;
    await ctx.reply(rulesText(escapeHtml(chat.title), ctx.app.settings.rules.text), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("setrules", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const chat = ctx.app.chatRow!;
    const reply = ctx.msg?.reply_to_message;
    const text = (reply?.text ?? reply?.caption ?? ctx.match ?? "").trim();
    if (!text) {
      await replyTemp(
        ctx,
        tr("📜 <b>Configurar normas</b>\n\nUso: <code>/setrules texto de las normas</code>\nTambién puedes responder a un mensaje con <code>/setrules</code>."),
      );
      return;
    }
    const saved = await patchChatSettings(chat.chat_id, { rules: { enabled: true, text } }, ctx.app.premium);
    if (!saved.settings) { await notify(ctx, saved.error || tr("No se pudieron guardar las normas.")); return; }
    ctx.app.settings = saved.settings;
    await replyTemp(ctx, tr("✅ Normas actualizadas. Los miembros pueden verlas con /rules."));
  });

  bot.command("admins", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") {
      await notify(ctx, tr("⚠️ Este comando solo funciona en grupos."));
      return;
    }
    try {
      const admins = await ctx.api.getChatAdministrators(ctx.chat.id);
      const lines = [tr("🛡️ <b>Administradores de {0}</b>", [escapeHtml(ctx.chat.title ?? tr("el grupo"))]), ""];
      for (const admin of admins.slice(0, 40)) {
        const role = admin.status === "creator" ? tr("👑 Creador") : tr("🛡️ Admin");
        const title = (admin as { custom_title?: string }).custom_title;
        lines.push(
          `${role} · ${mentionUser(admin.user)}` +
            (admin.user.username ? ` (@${escapeHtml(admin.user.username)})` : "") +
            (title ? ` — <i>${escapeHtml(title)}</i>` : ""),
        );
      }
      await ctx.reply(lines.join("\n"), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch {
      await notify(ctx, tr("⚠️ No he podido obtener la lista de administradores."));
    }
  });

  bot.command("report", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") {
      await notify(ctx, tr("⚠️ Este comando solo funciona en grupos."));
      return;
    }

    const raw = (ctx.match ?? "").trim().toLowerCase();
    if (raw === "on" || raw === "off") {
      if (!(await ensureGroupAdmin(ctx))) return;
      const chat = ctx.app.chatRow!;
      const saved = await patchChatSettings(chat.chat_id, { reports: { enabled: raw === "on" } }, ctx.app.premium);
      if (!saved.settings) { await notify(ctx, saved.error || tr("No se pudo guardar el ajuste.")); return; }
      ctx.app.settings = saved.settings;
      await replyTemp(ctx, tr("🚨 Reportes {0}.", [raw === "on" ? tr("activados") : tr("desactivados")]));
      return;
    }

    if (!ctx.app.settings.reports.enabled) {
      await notify(ctx, tr("🚨 Los reportes están desactivados en este grupo."));
      return;
    }
    const message = ctx.msg;
    const replied = message?.reply_to_message;
    if (!message || !replied || !ctx.from) {
      await replyTemp(ctx, tr("🚨 Responde al mensaje que quieres reportar con <code>/report</code>."));
      return;
    }

    const cooldownKey = `${ctx.chat.id}:${ctx.from.id}`;
    const now = Date.now();
    const last = reportCooldowns.get(cooldownKey) ?? 0;
    if (now - last < 60_000) {
      await replyTemp(ctx, tr("⏳ Ya has enviado un reporte hace menos de un minuto."));
      return;
    }
    reportCooldowns.set(cooldownKey, now);

    try {
      await rememberReport(ctx.chat.id,ctx.from.id,replied.message_id,replied.from?.id,replied.text??replied.caption);
      const admins = await ctx.api.getChatAdministrators(ctx.chat.id);
      const mentions = admins
        .filter((admin) => !admin.user.is_bot)
        .slice(0, 8)
        .map((admin) => mentionUser(admin.user))
        .join(" ");
      const link = messageLink(ctx.chat, replied.message_id);
      const lines = [
        tr("🚨 <b>Reporte de un miembro</b>"),
        "",
        tr("👤 Reportado por: {0}", [mentionUser(ctx.from)]),
        tr("🎯 Mensaje de: {0}", [replied.from ? mentionUser(replied.from) : tr("desconocido")]),
        replied.text ? `📝 <i>${escapeHtml(replied.text.slice(0, 300))}</i>` : "",
        "",
        mentions || tr("No hay administradores disponibles."),
      ].filter(Boolean);

      const keyboard = link
        ? {
            inline_keyboard: [[{ text: tr("🔗 Ir al mensaje"), url: link }]],
          }
        : undefined;

      await ctx.reply(lines.join("\n"), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard,
      });
      await safeDelete(ctx.api, ctx.chat.id, message.message_id);
    } catch {
      await notify(ctx, tr("⚠️ No he podido enviar el reporte."));
    }
  });

  bot.command("stats", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") {
      await notify(ctx, tr("⚠️ Este comando solo funciona en grupos."));
      return;
    }
    const chat = ctx.app.chatRow;
    if (!chat) return;
    const days = ctx.app.premium ? 30 : 7;
    const [stats, chart, top] = await Promise.all([
      getGroupStats(ctx.api, chat.chat_id),
      getChartData(chat.chat_id, days),
      getTopMembers(chat.chat_id, "week", 5),
    ]);

    const values = chart.map((point) => point.messages);
    const lines = [
      tr("📊 <b>Estadísticas · {0}</b>", [escapeHtml(chat.title)]),
      "",
      tr("👥 Miembros: <b>{0}</b> · ", [formatNumber(stats.memberCount)]) +
        tr("🛡️ Admins: <b>{0}</b>", [formatNumber(stats.adminCount)]),
      tr("💬 Hoy: <b>{0}</b> · ", [formatNumber(stats.messagesToday)]) +
        tr("{0} días: <b>{1}</b> · ", [days,formatNumber(days === 7 ? stats.messages7d : stats.messages30d)]) +
        tr("Total: <b>{0}</b>", [formatNumber(stats.messagesTotal)]),
      tr("🚪 Entradas: <b>{0}</b> (7d) · ", [formatNumber(stats.joins7d)]) +
        tr("⚠️ Warns: <b>{0}</b> · ", [formatNumber(stats.warnings)]) +
        tr("🛡️ Acciones hoy: <b>{0}</b>", [formatNumber(stats.actionsToday)]),
      "",
      tr("<b>Actividad ({0} días)</b>", [days]),
      `<code>${sparkline(values)}</code>`,
      tr("Máx: {0} mensajes/día", [formatNumber(Math.max(...values, 0))]),
      "",
      tr("<b>🏆 Top de la semana</b>"),
      ...top.map(
        (member, index) =>
          tr("{0}. {1} — <b>{2}</b> mensajes", [index + 1,escapeHtml(member.first_name),formatNumber(member.messages)]),
      ),
      "",
      stats.premium
        ? tr("👑 Premium activo · {0} día(s)", [stats.premiumDaysLeft])
        : tr("👑 Plan gratuito · {0} acciones/día", [config.freeActionLimit]),
    ];

    if (!ctx.app.premium) {
      lines.push("", tr("💡 Con Premium verás 30 días de actividad y podrás exportar los datos."));
    }

    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("top", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") {
      await notify(ctx, tr("⚠️ Este comando solo funciona en grupos."));
      return;
    }
    const chat = ctx.app.chatRow;
    if (!chat) return;
    const raw = (ctx.match ?? "").trim().toLowerCase();
    const period = (["today", "week", "month", "all"].includes(raw) ? raw : "week") as
      | "today"
      | "week"
      | "month"
      | "all";
    const labels: Record<string, string> = {
      today: tr("hoy"),
      week: tr("esta semana"),
      month: tr("este mes"),
      all: tr("de todos los tiempos"),
    };
    const members = await getTopMembers(chat.chat_id, period, 10);
    if (members.length === 0) {
      await ctx.reply(tr("📭 Aún no hay actividad registrada."));
      return;
    }
    const medals = ["🥇", "🥈", "🥉"];
    const lines = [
      tr("🏆 <b>Top {0}</b>", [labels[period]]),
      "",
      ...members.map(
        (member, index) =>
          `${medals[index] ?? `${index + 1}.`} ${escapeHtml(member.first_name)} — ` +
          tr("<b>{0}</b> mensajes", [formatNumber(member.messages)]),
      ),
      "",
      tr("💡 Usa <code>/top today</code>, <code>/top week</code>, <code>/top month</code> o <code>/top all</code>."),
    ];
    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("premium", async (ctx) => {
    if (!ctx.from) return;
    if (ctx.chat && ctx.chat.type !== "private") {
      await showPremiumForChat(ctx, ctx.chat.id);
      return;
    }

    const payload = (ctx.match ?? "").trim();
    if (/^-?\d+$/.test(payload)) {
      await showPremiumForChat(ctx, Number(payload));
      return;
    }

    const chats = ctx.app.isOwner ? await getActiveChats() : await getAdminChatsForUser(ctx.from.id);
    chats.sort((a, b) => a.title.localeCompare(b.title, "es"));
    if (chats.length === 0) {
      await notify(
        ctx,
        tr("👑 <b>Premium</b>\n\nNo veo grupos donde seas administrador.\n\nAñádeme a un grupo, dame permisos de administrador y vuelve a intentarlo. También puedes abrir este enlace desde el grupo con /premium."),
      );
      return;
    }

    if (chats.length === 1) {
      await showPremiumForChat(ctx, chats[0]!.chat_id);
      return;
    }

    await ctx.reply(
      tr("👑 <b>Premium</b>\n\nElige el grupo que quieres mejorar:"),
      { parse_mode: "HTML", reply_markup: chatSelectionKeyboard(chats) },
    );
  });
}
