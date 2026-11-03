import { tr } from "../../services/bot-i18n.js";
import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { config } from "../../config.js";
import { patchChatSettings, settingsOf } from "../../services/chat-cache.js";
import { getChat } from "../../db/repositories/chats.js";
import {
  PREMIUM_PERKS,
  PREMIUM_PLANS,
} from "../../services/premium.js";
import {
  TOGGLE_DEFINITIONS,
  getToggle,
  setToggle,
} from "../../services/settings.js";
import { verifyCaptcha } from "../../services/captcha.js";
import { getChatMemberSafe, isAdminStatus } from "../../utils/telegram.js";
import { SUPPORTED_LANGUAGES, t, isSupportedLanguage } from "../../i18n/index.js";
import { deleteLater } from "../../utils/telegram.js";
import { mentionUser } from "../../utils/format.js";
import type { AppContext } from "../context.js";
import { backToHelpKeyboard, helpKeyboard } from "../keyboards.js";
import { ensureGroupAdmin } from "../middleware.js";
import { helpText } from "../texts.js";
import { settingsViewKeyboard, settingsViewText } from "../views.js";

export function registerCallbacks(bot: Bot<AppContext>): void {
  bot.callbackQuery(/^tgl:(.+)$/, async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const chat = ctx.app.chatRow!;
    const key = ctx.match[1] ?? "";
    const definition = TOGGLE_DEFINITIONS.find((item) => item.key === key);
    if (!definition) {
      await ctx.answerCallbackQuery({ text: tr("Ajuste desconocido."), show_alert: true });
      return;
    }

    if (definition.premium && !ctx.app.premium) {
      await ctx.answerCallbackQuery({
        text: tr("🔒 Esta función requiere GBot Ultra Premium. Usa /premium."),
        show_alert: true,
      });
      return;
    }

    const current = getToggle(ctx.app.settings, key);
    if (key === "logs" && !current && !ctx.app.settings.logs.chatId) {
      await ctx.answerCallbackQuery({
        text: tr("Configura primero el canal con /logs set -100..."),
        show_alert: true,
      });
      return;
    }

    const result = await patchChatSettings(chat.chat_id, latest => {
      const [section, property] = definition.path;
      return { [section]: { [property]: !getToggle(latest, key) } };
    }, ctx.app.premium);
    if (!result.ok || !result.settings) {
      await ctx.answerCallbackQuery({ text: result.error || tr("No se pudo guardar el ajuste."), show_alert: true });
      return;
    }
    const next = result.settings;
    ctx.app.settings = next;

    try {
      await ctx.editMessageText(settingsViewText(chat, next), {
        parse_mode: "HTML",
        reply_markup: settingsViewKeyboard(ctx, chat),
      });
    } catch {
      // El mensaje puede haber caducado; enviamos uno nuevo.
      await ctx.reply(settingsViewText(chat, next), {
        parse_mode: "HTML",
        reply_markup: settingsViewKeyboard(ctx, chat),
      });
    }

    await ctx.answerCallbackQuery({
      text: `${tr(definition.label)}: ${getToggle(next, key) ? tr("activado ✅") : tr("desactivado ❌")}`,
    });
  });

  bot.callbackQuery("settings:refresh", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const chat = ctx.app.chatRow!;
    try {
      await ctx.editMessageText(settingsViewText(chat, ctx.app.settings), {
        parse_mode: "HTML",
        reply_markup: settingsViewKeyboard(ctx, chat),
      });
    } catch {
      // Sin cambios.
    }
    await ctx.answerCallbackQuery({ text: tr("Ajustes actualizados.") });
  });

  bot.callbackQuery(/^lang:(-?\d+):([a-z]{2})$/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    const code = ctx.match[2] ?? "";
    if (!isSupportedLanguage(code)) {
      await ctx.answerCallbackQuery({ text: tr("Idioma no válido."), show_alert: true });
      return;
    }
    const chat = await getChat(chatId);
    if (!chat || !chat.active) {
      await ctx.answerCallbackQuery({ text: tr("Grupo no encontrado."), show_alert: true });
      return;
    }
    if (!ctx.app.isOwner) {
      const member = await getChatMemberSafe(ctx.api, chatId, ctx.from!.id).catch(() => null);
      if (!member || !isAdminStatus(member.status)) {
        await ctx.answerCallbackQuery({ text: tr("Solo administradores."), show_alert: true });
        return;
      }
    }

    const result = await patchChatSettings(chatId, { language: code }, ctx.app.premium);
    if (!result.ok) {
      await ctx.answerCallbackQuery({ text: result.error || tr("No se pudo guardar el idioma."), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: t("languageChanged", code) });
    try {
      await ctx.editMessageText(`${t("languageChanged", code)}: ${code}`, {
        reply_markup: new InlineKeyboard().text(tr("⬅️ Volver"), "help:main"),
      });
    } catch {
      await ctx.reply(`${t("languageChanged", code)}: ${code}`);
    }
  });

  bot.callbackQuery(/^help:(main|mod|settings|content|premium|panel)$/, async (ctx) => {
    const section = ctx.match[1] as "main" | "mod" | "settings" | "content" | "premium" | "panel";
    await ctx.answerCallbackQuery().catch(() => undefined);

    if (section === "panel") {
      const chatId = ctx.chat && ctx.chat.type !== "private" ? ctx.chat.id : 0;
      const url = chatId
        ? `https://t.me/${ctx.me.username}?start=panel_${chatId}`
        : config.hasWebapp
          ? config.webappUrl
          : "";
      const text =
        tr("🌐 <b>Panel de control</b>\n\nLa Mini App permite gestionar miembros, moderación, ajustes, estadísticas y Premium desde una interfaz táctil.\n\n") +
        (url
          ? tr("Pulsa el botón para abrirla.")
          : tr("⚠️ Configura <code>WEBAPP_URL</code> con una URL HTTPS para activarla."));
      let keyboard: InlineKeyboard | undefined;
      if (url) {
        keyboard = new InlineKeyboard();
        if (chatId) keyboard.url(tr("🌐 Abrir panel"), url);
        else keyboard.webApp(tr("🌐 Abrir panel"), url);
      }
      try {
        await ctx.editMessageText(text, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: keyboard,
        });
      } catch {
        await ctx.reply(text, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: keyboard,
        });
      }
      return;
    }

    if (section === "premium") {
      const text =
        tr("👑 <b>Ventajas de GBot Ultra Premium</b>\n\n") +
        PREMIUM_PERKS.map((perk) => `${perk.emoji} <b>${tr(perk.title)}</b>\n${tr(perk.description)}`).join("\n\n") +
        tr("\n\nPrecio desde <b>{0} ⭐</b> al mes.\n", [PREMIUM_PLANS.find(plan=>plan.id==='monthly')!.stars]) +
        tr("Usa /premium para elegir plan.");
      try {
        await ctx.editMessageText(text, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: backToHelpKeyboard(),
        });
      } catch {
        await ctx.reply(text, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: backToHelpKeyboard(),
        });
      }
      return;
    }

    const text = helpText(section);
    const keyboard = section === "main" ? helpKeyboard() : backToHelpKeyboard();
    try {
      await ctx.editMessageText(text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard,
      });
    } catch {
      await ctx.reply(text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard,
      });
    }
  });

  bot.callbackQuery(/^cap:([a-z0-9]+):(-?\d+)$/, async (ctx) => {
    const value = ctx.match[1] ?? "";
    const targetId = Number(ctx.match[2]);
    const from = ctx.from;
    if (!ctx.chat || !from) return;

    if (from.id !== targetId) {
      await ctx.answerCallbackQuery({
        text: tr("Esta verificación no es tuya."),
        show_alert: true,
      });
      return;
    }

    const verdict = await verifyCaptcha(ctx.api, ctx.chat.id, from.id, value);

    if (verdict.status === "ok") {
      await ctx.answerCallbackQuery({ text: tr("✅ Verificado. ¡Bienvenido/a!") });
      try {
        const message = await ctx.api.sendMessage(
          ctx.chat.id,
          tr("✅ {0} ha superado la verificación.", [mentionUser(from)]),
          { parse_mode: "HTML" },
        );
        deleteLater(ctx.api, ctx.chat.id, message.message_id, 15_000);
      } catch {
        // Sin permisos para el mensaje de confirmación.
      }
      return;
    }

    if (verdict.status === "wrong") {
      const left = Math.max(0, 3 - verdict.attempts);
      await ctx.answerCallbackQuery({
        text: tr("❌ Respuesta incorrecta. Te quedan {0} intento(s).", [left]),
        show_alert: true,
      });
      return;
    }

    if (verdict.status === "kicked") {
      await ctx.answerCallbackQuery({
        text: tr("❌ Demasiados intentos. Has sido expulsado del grupo."),
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({ text: tr("Ya estás verificado.") });
    try {
      await ctx.deleteMessage();
    } catch {
      // Mensaje ya eliminado.
    }
  });

  bot.callbackQuery("premium:required", async (ctx) => {
    await ctx.answerCallbackQuery({
      text: tr("🔒 GBot Ultra Premium. Usa /premium para ver los planes."),
      show_alert: true,
    });
  });
}
