import { tr } from "../../services/bot-i18n.js";
import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import safeRegex from "safe-regex2";
import type { WelcomeMedia } from "../../db/types.js";
import {
  addBlacklist,
  listBlacklist,
  removeBlacklist,
} from "../../db/repositories/filters.js";
import { invalidateBlacklist } from "../../services/antispam.js";
import { patchChatSettings, settingsOf } from "../../services/chat-cache.js";
import { sendWelcome } from "../../services/welcome.js";
import {
  DEFAULT_SETTINGS,
  applySettingsPatch,
  type SettingsPatch,
} from "../../services/settings.js";
import { formatDuration, parseDuration } from "../../utils/duration.js";
import { escapeHtml, truncate } from "../../utils/format.js";
import { getChatMemberSafe, isAdminStatus } from "../../utils/telegram.js";
import { getChat } from "../../db/repositories/chats.js";
import type { AppContext } from "../context.js";
import { ensureGroupAdmin, notify, replyTemp } from "../middleware.js";
import { settingsViewKeyboard, settingsViewText } from "../views.js";
import { SUPPORTED_LANGUAGES, t, isSupportedLanguage } from "../../i18n/index.js";
import { showPanel } from "../panel.js";

async function patchSettings(ctx: AppContext, patch: SettingsPatch): Promise<boolean> {
  const chat = ctx.app.chatRow;
  if (!chat) return false;
  const result = await patchChatSettings(chat.chat_id, patch, ctx.app.premium);
  if (!result.ok || !result.settings) {
    const extra = result.premiumFeature
      ? tr("\n\n🔒 Función Premium: <b>{0}</b>\nUsa /premium para desbloquearla.", [escapeHtml(result.premiumFeature)])
      : "";
    await replyTemp(ctx, `⚠️ ${escapeHtml(result.error ?? tr("Ajuste no válido."))}${extra}`);
    return false;
  }
  ctx.app.settings = result.settings;
  return true;
}

function boolArg(raw: string): boolean | null {
  if (["on", "si", tr("sí"), "true", "1", "activar"].includes(raw)) return true;
  if (["off", "no", "false", "0", "desactivar"].includes(raw)) return false;
  return null;
}

function detectMedia(ctx: AppContext): WelcomeMedia | null {
  const reply = ctx.msg?.reply_to_message;
  if (!reply) return null;
  if (reply.photo?.length) {
    return { type: "photo", fileId: reply.photo[reply.photo.length - 1]!.file_id };
  }
  if (reply.video) return { type: "video", fileId: reply.video.file_id };
  if (reply.animation) return { type: "animation", fileId: reply.animation.file_id };
  if (reply.document) return { type: "document", fileId: reply.document.file_id };
  return null;
}

function mediaLabel(media: WelcomeMedia | null): string {
  if (!media) return tr("solo texto");
  const labels: Record<WelcomeMedia["type"], string> = {
    photo: "foto",
    video: tr("vídeo"),
    animation: "GIF",
    document: "documento",
  };
  return labels[media.type];
}

export function registerSettings(bot: Bot<AppContext>): void {
  bot.command("settings", async (ctx) => {
    if (ctx.chat?.type === "private") { await showPanel(ctx, undefined, "settings"); return; }
    if (!(await ensureGroupAdmin(ctx))) return;
    const chat = ctx.app.chatRow!;
    await ctx.reply(settingsViewText(chat, ctx.app.settings), {
      parse_mode: "HTML",
      reply_markup: settingsViewKeyboard(ctx, chat),
    });
  });

  // ----------------------------------------------------------
  //  Bienvenida y despedida
  // ----------------------------------------------------------
  bot.command("welcome", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const raw = (ctx.match ?? "").trim().toLowerCase();
    if (!raw) {
      const settings = ctx.app.settings;
      await replyTemp(
        ctx,
        tr("👋 <b>Bienvenida</b>\n\n") +
          tr("Estado: {0}\n", [settings.welcome.enabled ? tr("✅ activada") : tr("❌ desactivada")]) +
          tr("Multimedia: <b>{0}</b>\n", [mediaLabel(settings.welcome.media)]) +
          tr("Autoeliminar: <b>{0}</b>\n\n", [settings.welcome.deleteAfter > 0 ? `${settings.welcome.deleteAfter}s` : "no"]) +
          tr("<b>Texto actual</b>\n{0}\n\n", [truncate(settings.welcome.text, 700)]) +
          tr("⚙️ <code>/welcome on|off</code> · <code>/setwelcome texto</code> · <code>/testwelcome</code>"),
      );
      return;
    }
    const value = boolArg(raw);
    if (value === null) {
      await replyTemp(ctx, tr("⚠️ Uso: <code>/welcome on</code> o <code>/welcome off</code>"));
      return;
    }
    if (await patchSettings(ctx, { welcome: { enabled: value } })) {
      await replyTemp(ctx, tr("👋 Bienvenida {0}.", [value ? tr("activada") : tr("desactivada")]));
    }
  });

  bot.command("setwelcome", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const reply = ctx.msg?.reply_to_message;
    const media = detectMedia(ctx);
    const text = (reply?.text ?? reply?.caption ?? ctx.match ?? "").trim();
    if (!text && !media) {
      await replyTemp(
        ctx,
        tr("👋 <b>Configurar bienvenida</b>\n\nUso: <code>/setwelcome ¡Hola {mention}, bienvenido a {chat}!</code>\nTambién puedes responder a una foto, vídeo, GIF o documento con <code>/setwelcome</code>.\n\nVariables: <code>{mention}</code>, <code>{name}</code>, <code>{username}</code>, <code>{chat}</code>, <code>{count}</code>"),
      );
      return;
    }
    const patch: SettingsPatch = {
      welcome: {
        enabled: true,
        text: text || ctx.app.settings.welcome.text || DEFAULT_SETTINGS.welcome.text,
        media,
      },
    };
    if (await patchSettings(ctx, patch)) {
      await replyTemp(
        ctx,
        tr("✅ Bienvenida actualizada ({0}). ", [media ? mediaLabel(media) : tr("solo texto")]) +
          tr("Puedes previsualizarla con /testwelcome."),
      );
    }
  });

  bot.command("resetwelcome", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (await patchSettings(ctx, { welcome: { ...DEFAULT_SETTINGS.welcome } })) {
      await replyTemp(ctx, tr("✅ Bienvenida restablecida al texto predeterminado."));
    }
  });

  bot.command("testwelcome", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (!ctx.chat || !ctx.from) return;
    await sendWelcome(ctx.api, ctx.chat, ctx.from, ctx.app.settings);
    await replyTemp(ctx, tr("👋 Bienvenida de prueba enviada."), { seconds: 10 });
  });

  bot.command("goodbye", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const raw = (ctx.match ?? "").trim().toLowerCase();
    if (!raw) {
      const settings = ctx.app.settings;
      await replyTemp(
        ctx,
        tr("🚪 <b>Despedida</b>\n\nEstado: {0}\n\n", [settings.goodbye.enabled ? tr("✅ activada") : tr("❌ desactivada")]) +
          tr("<b>Texto actual</b>\n{0}\n\n", [truncate(settings.goodbye.text, 500)]) +
          tr("⚙️ <code>/goodbye on|off</code> · <code>/setgoodbye texto</code>"),
      );
      return;
    }
    const value = boolArg(raw);
    if (value === null) {
      await replyTemp(ctx, tr("⚠️ Uso: <code>/goodbye on</code> o <code>/goodbye off</code>"));
      return;
    }
    if (await patchSettings(ctx, { goodbye: { enabled: value } })) {
      await replyTemp(ctx, tr("🚪 Despedida {0}.", [value ? tr("activada") : tr("desactivada")]));
    }
  });

  bot.command("setgoodbye", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const reply = ctx.msg?.reply_to_message;
    const text = (reply?.text ?? reply?.caption ?? ctx.match ?? "").trim();
    if (!text) {
      await replyTemp(
        ctx,
        tr("🚪 Uso: <code>/setgoodbye Hasta pronto, {name}</code>\nVariables: <code>{mention}</code>, <code>{name}</code>, <code>{username}</code>, <code>{chat}</code>"),
      );
      return;
    }
    if (await patchSettings(ctx, { goodbye: { enabled: true, text } })) {
      await replyTemp(ctx, tr("✅ Despedida actualizada."));
    }
  });

  // ----------------------------------------------------------
  //  Captcha
  // ----------------------------------------------------------
  bot.command("captcha", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const args = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const first = (args[0] ?? "").toLowerCase();
    const settings = ctx.app.settings;

    if (!first) {
      await replyTemp(
        ctx,
        tr("🤖 <b>Captcha</b>\n\n") +
          tr("Estado: {0}\n", [settings.captcha.enabled ? tr("✅ activado") : tr("❌ desactivado")]) +
          tr("Modo: <b>{0}</b>\n", [settings.captcha.mode === "math" ? tr("matemático 🔒") : tr("botón")]) +
          tr("Tiempo: <b>{0}s</b>\n\n", [settings.captcha.timeoutSeconds]) +
          tr("⚙️ <code>/captcha on|off</code>\n") +
          tr("<code>/captcha mode button|math</code>\n") +
          tr("<code>/captcha timeout 300</code>"),
      );
      return;
    }

    if (first === "on" || first === "off") {
      const value = first === "on";
      if (await patchSettings(ctx, { captcha: { enabled: value } })) {
        await replyTemp(
          ctx,
          tr("🤖 Captcha {0}.", [value ? tr("activado") : tr("desactivado")]) +
            (value ? tr(" Los nuevos miembros deberán verificarse.") : ""),
        );
      }
      return;
    }

    if (first === "mode") {
      const mode = (args[1] ?? "").toLowerCase();
      if (mode !== "button" && mode !== "math") {
        await replyTemp(ctx, tr("⚠️ Uso: <code>/captcha mode button</code> o <code>/captcha mode math</code>"));
        return;
      }
      if (await patchSettings(ctx, { captcha: { enabled: true, mode } })) {
        await replyTemp(ctx, tr("🤖 Modo de captcha: <b>{0}</b>.", [mode === "math" ? tr("matemático") : tr("botón")]));
      }
      return;
    }

    if (first === "timeout") {
      const seconds = Number(args[1]);
      if (!Number.isFinite(seconds) || seconds < 30 || seconds > 3_600) {
        await replyTemp(ctx, tr("⚠️ El tiempo debe estar entre 30 y 3600 segundos."));
        return;
      }
      if (await patchSettings(ctx, { captcha: { timeoutSeconds: Math.round(seconds) } })) {
        await replyTemp(ctx, tr("⏳ Tiempo de captcha: <b>{0}s</b>.", [Math.round(seconds)]));
      }
      return;
    }

    await replyTemp(ctx, tr("⚠️ Uso: <code>/captcha on|off|mode|timeout</code>"));
  });

  // ----------------------------------------------------------
  //  Antienlaces y lista blanca
  // ----------------------------------------------------------
  bot.command("antilink", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const args = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const first = (args[0] ?? "").toLowerCase();
    const settings = ctx.app.settings;

    if (!first) {
      await replyTemp(
        ctx,
        tr("🔗 <b>Antienlaces</b>\n\n") +
          tr("Estado: {0}\n", [settings.antilink.enabled ? tr("✅ activado") : tr("❌ desactivado")]) +
          tr("Acción: <b>{0}</b>\n", [settings.antilink.action]) +
          tr("Silencio: <b>{0}</b>\n", [formatDuration(settings.antilink.muteSeconds)]) +
          tr("Lista blanca: <b>{0}</b> dominio(s)\n\n", [settings.antilink.whitelist.length]) +
          tr("⚙️ <code>/antilink on|off</code>\n") +
          tr("<code>/antilink delete|mute|ban</code>\n") +
          tr("<code>/antilink time 10m</code>\n") +
          tr("<code>/whitelist add|remove|list</code>"),
      );
      return;
    }

    if (first === "on" || first === "off") {
      const value = first === "on";
      if (await patchSettings(ctx, { antilink: { enabled: value } })) {
        await replyTemp(ctx, tr("🔗 Antienlaces {0}.", [value ? tr("activado") : tr("desactivado")]));
      }
      return;
    }

    if (["delete", "mute", "ban"].includes(first)) {
      if (
        await patchSettings(ctx, {
          antilink: { enabled: true, action: first as "delete" | "mute" | "ban" },
        })
      ) {
        await replyTemp(ctx, tr("🔗 Acción antienlaces: <b>{0}</b>.", [first]));
      }
      return;
    }

    if (first === "time") {
      const seconds = parseDuration(args[1] ?? "", "m");
      if (!seconds || seconds < 60) {
        await replyTemp(ctx, tr("⚠️ Indica una duración válida, por ejemplo <code>/antilink time 10m</code>."));
        return;
      }
      if (await patchSettings(ctx, { antilink: { muteSeconds: seconds } })) {
        await replyTemp(ctx, tr("⏱️ Silencio antienlaces: <b>{0}</b>.", [formatDuration(seconds)]));
      }
      return;
    }

    await replyTemp(ctx, tr("⚠️ Uso: <code>/antilink on|off|delete|mute|ban|time</code>"));
  });

  bot.command("whitelist", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const args = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const action = (args[0] ?? "").toLowerCase();
    const current = ctx.app.settings.antilink.whitelist;

    if (action === "list" || !action) {
      if (current.length === 0) {
        await replyTemp(
          ctx,
          tr("🔗 <b>Lista blanca</b>\n\nNo hay dominios permitidos.\n\nAñade uno con <code>/whitelist add ejemplo.com</code> (Premium)."),
        );
        return;
      }
      await replyTemp(
        ctx,
        tr("🔗 <b>Lista blanca ({0})</b>\n\n", [current.length]) +
          current.map((domain) => `• <code>${escapeHtml(domain)}</code>`).join("\n") +
          tr("\n\n⚙️ <code>/whitelist add|remove dominio</code>"),
      );
      return;
    }

    const domainRaw = (args[1] ?? "").trim().toLowerCase();
    const domain = domainRaw
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]!
      .trim();

    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      await replyTemp(ctx, tr("⚠️ Indica un dominio válido, por ejemplo <code>ejemplo.com</code>."));
      return;
    }

    if (action === "add") {
      if (current.includes(domain)) {
        await replyTemp(ctx, tr("ℹ️ Ese dominio ya está en la lista blanca."));
        return;
      }
      if (current.length >= 50) {
        await replyTemp(ctx, tr("⚠️ La lista blanca admite como máximo 50 dominios."));
        return;
      }
      if (await patchSettings(ctx, { antilink: { whitelist: [...current, domain] } })) {
        await replyTemp(ctx, tr("✅ <code>{0}</code> añadido a la lista blanca.", [escapeHtml(domain)]));
      }
      return;
    }

    if (action === "remove") {
      if (!current.includes(domain)) {
        await replyTemp(ctx, tr("ℹ️ Ese dominio no está en la lista blanca."));
        return;
      }
      if (
        await patchSettings(ctx, {
          antilink: { whitelist: current.filter((item) => item !== domain) },
        })
      ) {
        await replyTemp(ctx, tr("✅ <code>{0}</code> eliminado de la lista blanca.", [escapeHtml(domain)]));
      }
      return;
    }

    await replyTemp(ctx, tr("⚠️ Uso: <code>/whitelist add|remove|list dominio</code>"));
  });

  // ----------------------------------------------------------
  //  Antiflood
  // ----------------------------------------------------------
  bot.command("antiflood", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const args = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const first = (args[0] ?? "").toLowerCase();
    const settings = ctx.app.settings;

    if (!first) {
      await replyTemp(
        ctx,
        tr("🌊 <b>Antiflood</b>\n\n") +
          tr("Estado: {0}\n", [settings.antiflood.enabled ? tr("✅ activado") : tr("❌ desactivado")]) +
          tr("Límite: <b>{0} mensajes / {1}s</b>\n", [settings.antiflood.limit,settings.antiflood.windowSeconds]) +
          tr("Silencio: <b>{0}</b>\n\n", [formatDuration(settings.antiflood.muteSeconds)]) +
          tr("⚙️ <code>/antiflood on|off</code>\n") +
          tr("<code>/antiflood limit 8</code>\n") +
          tr("<code>/antiflood window 10</code>\n") +
          tr("<code>/antiflood mute 10m</code>"),
      );
      return;
    }

    if (first === "on" || first === "off") {
      const value = first === "on";
      if (await patchSettings(ctx, { antiflood: { enabled: value } })) {
        await replyTemp(ctx, tr("🌊 Antiflood {0}.", [value ? tr("activado") : tr("desactivado")]));
      }
      return;
    }

    if (first === "limit") {
      const limit = Number(args[1]);
      if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
        await replyTemp(ctx, tr("⚠️ El límite debe estar entre 1 y 100."));
        return;
      }
      if (await patchSettings(ctx, { antiflood: { limit: Math.round(limit) } })) {
        await replyTemp(ctx, tr("🌊 Límite: <b>{0} mensajes</b>.", [Math.round(limit)]));
      }
      return;
    }

    if (first === "window") {
      const windowSeconds = Number(args[1]);
      if (!Number.isFinite(windowSeconds) || windowSeconds < 1 || windowSeconds > 300) {
        await replyTemp(ctx, tr("⚠️ La ventana debe estar entre 1 y 300 segundos."));
        return;
      }
      if (await patchSettings(ctx, { antiflood: { windowSeconds: Math.round(windowSeconds) } })) {
        await replyTemp(ctx, tr("🌊 Ventana: <b>{0}s</b>.", [Math.round(windowSeconds)]));
      }
      return;
    }

    if (first === "mute") {
      const seconds = parseDuration(args[1] ?? "", "m");
      if (!seconds || seconds < 60) {
        await replyTemp(ctx, tr("⚠️ Indica una duración válida, por ejemplo <code>/antiflood mute 10m</code>."));
        return;
      }
      if (await patchSettings(ctx, { antiflood: { muteSeconds: seconds } })) {
        await replyTemp(ctx, tr("⏱️ Silencio antiflood: <b>{0}</b>.", [formatDuration(seconds)]));
      }
      return;
    }

    await replyTemp(ctx, tr("⚠️ Uso: <code>/antiflood on|off|limit|window|mute</code>"));
  });

  // ----------------------------------------------------------
  //  Lista negra
  // ----------------------------------------------------------
  bot.command("blacklist", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const chat = ctx.app.chatRow!;
    const args = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const action = (args[0] ?? "").toLowerCase();

    if (!action || action === "list") {
      const rows = await listBlacklist(chat.chat_id);
      if (rows.length === 0) {
        await replyTemp(
          ctx,
          tr("🚫 <b>Lista negra</b>\n\nNo hay palabras prohibidas.\n\nAñade una con <code>/blacklist add palabra</code> o una regex con <code>/blacklist add /patrón/i</code>."),
        );
        return;
      }
      await replyTemp(
        ctx,
        tr("🚫 <b>Lista negra ({0})</b>\n\n", [rows.length]) +
          rows
            .map(
              (row) =>
                `• ${row.is_regex ? "🧩" : "🔤"} <code>${escapeHtml(row.pattern)}</code>`,
            )
            .join("\n") +
          tr("\n\n⚙️ <code>/blacklist add|remove palabra</code>"),
      );
      return;
    }

    if (action === "on" || action === "off") {
      const value = action === "on";
      if (await patchSettings(ctx, { blacklist: { enabled: value } })) {
        await replyTemp(ctx, tr("🚫 Lista negra {0}.", [value ? tr("activada") : tr("desactivada")]));
      }
      return;
    }

    const rawPattern = args.slice(1).join(" ").trim();
    if (!rawPattern) {
      await replyTemp(ctx, tr("⚠️ Uso: <code>/blacklist add|remove palabra</code>"));
      return;
    }

    if (action === "add") {
      const isRegex = rawPattern.startsWith("/") && rawPattern.endsWith("/") && rawPattern.length > 2;
      const pattern = isRegex ? rawPattern.slice(1, -1) : rawPattern.toLowerCase();
      if (isRegex && !safeRegex(pattern, { limit: 250 })) {
        await replyTemp(ctx, tr("⚠️ Esa expresión regular es demasiado compleja o insegura."));
        return;
      }
      if (isRegex) {
        try {
          new RegExp(pattern, "iu");
        } catch {
          await replyTemp(ctx, tr("⚠️ La expresión regular no es válida."));
          return;
        }
      }
      await addBlacklist(chat.chat_id, pattern, isRegex, ctx.from?.id ?? null);
      invalidateBlacklist(chat.chat_id);
      await replyTemp(
        ctx,
        tr("✅ Añadido a la lista negra: {0} <code>{1}</code>", [isRegex ? "🧩" : "🔤",escapeHtml(pattern)]),
      );
      return;
    }

    if (action === "remove") {
      const isRegex = rawPattern.startsWith("/") && rawPattern.endsWith("/") && rawPattern.length > 2;
      const pattern = isRegex ? rawPattern.slice(1, -1) : rawPattern.toLowerCase();
      const removed = await removeBlacklist(chat.chat_id, pattern);
      invalidateBlacklist(chat.chat_id);
      await replyTemp(
        ctx,
        removed
          ? tr("✅ Eliminado de la lista negra: <code>{0}</code>", [escapeHtml(pattern)])
          : tr("ℹ️ No encontré ese patrón en la lista negra."),
      );
      return;
    }

    await replyTemp(ctx, tr("⚠️ Uso: <code>/blacklist add|remove|list|on|off</code>"));
  });

  // ----------------------------------------------------------
  //  Advertencias
  // ----------------------------------------------------------
  bot.command("setwarns", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const args = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const first = (args[0] ?? "").toLowerCase();
    const settings = ctx.app.settings;

    if (!first) {
      await replyTemp(
        ctx,
        tr("⚠️ <b>Advertencias</b>\n\n") +
          tr("Estado: {0}\n", [settings.warnings.enabled ? tr("✅ activadas") : tr("❌ desactivadas")]) +
          tr("Límite: <b>{0}</b>\n", [settings.warnings.limit]) +
          tr("Acción: <b>{0}</b>\n", [settings.warnings.action]) +
          tr("Silencio: <b>{0}</b>\n\n", [formatDuration(settings.warnings.muteSeconds)]) +
          tr("⚙️ <code>/setwarns on|off</code>\n") +
          tr("<code>/setwarns limit 3</code>\n") +
          tr("<code>/setwarns action mute|kick|ban</code>\n") +
          tr("<code>/setwarns mute 1h</code>"),
      );
      return;
    }

    if (first === "on" || first === "off") {
      const value = first === "on";
      if (await patchSettings(ctx, { warnings: { enabled: value } })) {
        await replyTemp(ctx, tr("⚠️ Advertencias {0}.", [value ? "activadas" : "desactivadas"]));
      }
      return;
    }

    if (first === "limit") {
      const limit = Number(args[1]);
      if (!Number.isFinite(limit) || limit < 1 || limit > 20) {
        await replyTemp(ctx, tr("⚠️ El límite debe estar entre 1 y 20."));
        return;
      }
      if (await patchSettings(ctx, { warnings: { limit: Math.round(limit) } })) {
        await replyTemp(ctx, tr("⚠️ Límite de advertencias: <b>{0}</b>.", [Math.round(limit)]));
      }
      return;
    }

    if (first === "action") {
      const action = (args[1] ?? "").toLowerCase();
      if (!["mute", "kick", "ban"].includes(action)) {
        await replyTemp(ctx, tr("⚠️ Uso: <code>/setwarns action mute|kick|ban</code>"));
        return;
      }
      if (
        await patchSettings(ctx, {
          warnings: { action: action as "mute" | "kick" | "ban" },
        })
      ) {
        await replyTemp(ctx, tr("⚠️ Acción al límite: <b>{0}</b>.", [action]));
      }
      return;
    }

    if (first === "mute") {
      const seconds = parseDuration(args[1] ?? "", "m");
      if (!seconds || seconds < 60) {
        await replyTemp(ctx, tr("⚠️ Indica una duración válida, por ejemplo <code>/setwarns mute 1h</code>."));
        return;
      }
      if (await patchSettings(ctx, { warnings: { muteSeconds: seconds } })) {
        await replyTemp(ctx, tr("⏱️ Silencio por warns: <b>{0}</b>.", [formatDuration(seconds)]));
      }
      return;
    }

    await replyTemp(ctx, tr("⚠️ Uso: <code>/setwarns on|off|limit|action|mute</code>"));
  });

  // ----------------------------------------------------------
  //  Logs, reportes, limpieza y solicitudes
  // ----------------------------------------------------------
  bot.command("logs", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const args = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    const first = (args[0] ?? "").toLowerCase();
    const settings = ctx.app.settings;

    if (!first) {
      await replyTemp(
        ctx,
        tr("📋 <b>Canal de registros</b> {0}\n\n", [ctx.app.premium ? "" : "🔒"]) +
          tr("Estado: {0}\n", [settings.logs.enabled ? tr("✅ activado") : tr("❌ desactivado")]) +
          tr("Canal: <code>{0}</code>\n\n", [settings.logs.chatId ?? tr("no configurado")]) +
          tr("⚙️ <code>/logs on|off</code>\n") +
          tr("<code>/logs set -1001234567890</code>\n\n") +
          tr("Añade el bot al canal como administrador antes de configurarlo."),
      );
      return;
    }

    if (first === "on" || first === "off") {
      const value = first === "on";
      if (value && !settings.logs.chatId) {
        await replyTemp(
          ctx,
          tr("⚠️ Primero configura el canal con <code>/logs set -100...</code>."),
        );
        return;
      }
      if (await patchSettings(ctx, { logs: { enabled: value } })) {
        await replyTemp(ctx, tr("📋 Canal de registros {0}.", [value ? tr("activado") : tr("desactivado")]));
      }
      return;
    }

    if (first === "set") {
      const chatId = Number(args[1]);
      if (!Number.isSafeInteger(chatId) || chatId === 0) {
        await replyTemp(ctx, tr("⚠️ Indica un ID de canal válido, por ejemplo <code>/logs set -1001234567890</code>."));
        return;
      }
      const member = await getChatMemberSafe(ctx.api, chatId, ctx.app.botId);
      if (!member || member.status !== "administrator") {
        await replyTemp(
          ctx,
          tr("⚠️ No soy administrador de ese canal. Añádeme al canal y dame permiso para publicar."),
        );
        return;
      }
      try {
        await ctx.api.sendMessage(chatId, tr("✅ GBot Ultra ha conectado este canal como registro del grupo."));
      } catch {
        await replyTemp(ctx, tr("⚠️ No puedo escribir en ese canal. Comprueba mis permisos."));
        return;
      }
      if (await patchSettings(ctx, { logs: { enabled: true, chatId } })) {
        await replyTemp(ctx, tr("📋 Canal de registros configurado: <code>{0}</code>.", [chatId]));
      }
      return;
    }

    await replyTemp(ctx, tr("⚠️ Uso: <code>/logs on|off|set</code>"));
  });

  bot.command("clean", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const raw = (ctx.match ?? "").trim().toLowerCase();
    if (raw !== "on" && raw !== "off") {
      await replyTemp(
        ctx,
        tr("🧹 Uso: <code>/clean on|off</code>\nBorra automáticamente los mensajes de unión y salida."),
      );
      return;
    }
    if (await patchSettings(ctx, { serviceMessages: { deleteJoins: raw === "on" } })) {
      await replyTemp(ctx, tr("🧹 Limpieza de mensajes de servicio {0}.", [raw === "on" ? tr("activada") : tr("desactivada")]));
    }
  });

  bot.command("autoapprove", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const raw = (ctx.match ?? "").trim().toLowerCase();
    if (raw !== "on" && raw !== "off") {
      await replyTemp(
        ctx,
        tr("✅ Uso: <code>/autoapprove on|off</code> 🔒\nAprueba automáticamente las solicitudes de entrada."),
      );
      return;
    }
    if (
      await patchSettings(ctx, {
        joinRequests: { autoApprove: raw === "on" },
      })
    ) {
      await replyTemp(
        ctx,
        tr("✅ Aprobación automática {0}.", [raw === "on" ? tr("activada") : tr("desactivada")]) +
          (raw === "on" ? tr(" Las nuevas solicitudes se aceptarán al instante.") : ""),
      );
    }
  });

  bot.command("language", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await notify(ctx, tr("Usa /language dentro del grupo para elegir el idioma. El bot te enviará un enlace al chat privado."));
  });
}

export async function showLanguageSelector(ctx: AppContext, chatId: number): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat || !chat.active) {
    await notify(ctx, tr("⚠️ Grupo no encontrado o el bot ya no está en él."));
    return;
  }
  if (!ctx.app.isOwner) {
    const member = await getChatMemberSafe(ctx.api, chatId, ctx.from!.id).catch(() => null);
    if (!member || !isAdminStatus(member.status)) {
      await notify(ctx, tr("🛡️ Solo los administradores del grupo pueden cambiar el idioma."));
      return;
    }
  }

  const keyboard = new InlineKeyboard();
  for (const lang of SUPPORTED_LANGUAGES) {
    keyboard.text(`${lang.flag} ${lang.name}`, `lang:${chatId}:${lang.code}`).row();
  }
  await ctx.reply(t("chooseLanguage", settingsOf(chat).language ?? "es"), {
    reply_markup: keyboard,
  });
}
