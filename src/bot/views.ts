import { tr } from "../services/bot-i18n.js";
import { config, webappUrlForChat } from "../config.js";
import type { ChatRow, GroupSettings } from "../db/types.js";
import { escapeHtml } from "../utils/format.js";
import type { AppContext } from "./context.js";
import { settingsKeyboard } from "./keyboards.js";

export function settingsViewText(chat: ChatRow, settings: GroupSettings): string {
  return (
    tr("⚙️ <b>Ajustes de {0}</b>\n\n", [escapeHtml(chat.title)]) +
    tr("Pulsa un interruptor para activar o desactivar una función.\n") +
    tr("Las funciones con 🔒 requieren <b>Premium</b>.\n\n") +
    tr("👋 Bienvenida: {0} · ", [settings.welcome.enabled ? "✅" : "❌"]) +
    tr("🤖 Captcha: {0} ({1})\n", [settings.captcha.enabled ? "✅" : "❌",settings.captcha.mode]) +
    tr("🔗 Antienlaces: {0} ({1}) · ", [settings.antilink.enabled ? "✅" : "❌",settings.antilink.action]) +
    tr("🌊 Antiflood: {0}\n", [settings.antiflood.enabled ? "✅" : "❌"]) +
    tr("⚠️ Warns: {0} ({1} → {2}) · ", [settings.warnings.enabled ? "✅" : "❌",settings.warnings.limit,settings.warnings.action]) +
    tr("📋 Logs: {0}\n\n", [settings.logs.enabled ? "✅" : "❌"]) +
    (config.hasWebapp
      ? tr("🌐 También puedes usar la Mini App para ajustes avanzados.")
      : tr("💡 Configura WEBAPP_URL para activar la Mini App."))
  );
}

export function settingsViewKeyboard(ctx: AppContext, chat: ChatRow) {
  const privateChat = ctx.chat?.type === "private";
  const webappUrl =
    privateChat && config.hasWebapp ? webappUrlForChat(chat.chat_id) : null;
  return settingsKeyboard(ctx.app.settings, ctx.app.premium, {
    webappUrl,
    privateChat,
    username: ctx.me.username,
    chatId: chat.chat_id,
  });
}
