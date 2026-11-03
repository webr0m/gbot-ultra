import { tr } from "../services/bot-i18n.js";
import { InlineKeyboard } from "grammy";
import { config, webappUrlForChat } from "../config.js";
import { getChat } from "../db/repositories/chats.js";
import { getChatMemberSafe, isAdminStatus } from "../utils/telegram.js";
import { escapeHtml } from "../utils/format.js";
import type { AppContext } from "./context.js";

export async function showPanel(ctx: AppContext, chatId?: number, tab: "home" | "settings" | "premium" = "home"): Promise<void> {
  if (!config.hasWebapp) {
    await ctx.reply(tr("El panel no está disponible en este momento. Inténtalo más tarde."));
    return;
  }
  let title = tr("tus grupos");
  if (chatId) {
    const chat = await getChat(chatId);
    const member = ctx.app.isOwner ? null : await getChatMemberSafe(ctx.api, chatId, ctx.from!.id);
    if (!chat?.active || (!ctx.app.isOwner && (!member || !isAdminStatus(member.status)))) {
      await ctx.reply(tr("No tienes acceso a ese grupo o el bot ya no está en él. Usa /panel para elegir uno de tus grupos."));
      return;
    }
    title = chat.title;
  }
  const targetUrl = new URL(chatId ? webappUrlForChat(chatId, tab) : config.webappUrl);
  if (tab !== "home") targetUrl.searchParams.set("tab", tab);
  const url = targetUrl.toString();
  await ctx.reply(tr("⚙️ <b>Administrar {0}</b>\n\nMiembros, moderación, ajustes y estadísticas en un solo panel.\nLos cambios se aplican también en Telegram. Solo acceden los administradores actuales.", [escapeHtml(title)]), {
    parse_mode: "HTML", link_preview_options: { is_disabled: true },
    reply_markup: new InlineKeyboard().webApp(tr("📱 Abrir panel"), url),
  });
}
