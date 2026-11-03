import { tr } from "../services/bot-i18n.js";
import { InlineKeyboard } from "grammy";
import type { ChatRow, GroupSettings, PremiumPlan } from "../db/types.js";
import { TOGGLE_DEFINITIONS, getToggle } from "../services/settings.js";

export function mainMenuKeyboard(
  username: string,
  webappUrl: string | null,
  supportUrl: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (webappUrl) keyboard.webApp(tr("🌐 Abrir panel"), webappUrl).row();
  keyboard
    .text(tr("👑 Premium"), "premium:start")
    .text(tr("📚 Ayuda"), "help:main")
    .row()
    .url(tr("➕ Añadir a un grupo"), `https://t.me/${username}?startgroup=true`);
  if (supportUrl) keyboard.row().url(tr("🛟 Soporte"), supportUrl);
  return keyboard;
}

export function groupPanelKeyboard(username: string, chatId: number): InlineKeyboard {
  return new InlineKeyboard().url(
    tr("🌐 Abrir panel"),
    `https://t.me/${username}?start=panel_${chatId}`,
  );
}

export function settingsKeyboard(
  settings: GroupSettings,
  premium: boolean,
  options: {
    webappUrl: string | null;
    privateChat: boolean;
    username: string;
    chatId: number;
  },
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  let column = 0;
  for (const toggle of TOGGLE_DEFINITIONS) {
    const enabled = getToggle(settings, toggle.key);
    const locked = toggle.premium && !premium;
    keyboard.text(
      `${enabled ? "✅" : "❌"} ${toggle.emoji} ${tr(toggle.label)}${locked ? " 🔒" : ""}`,
      `tgl:${toggle.key}`,
    );
    column += 1;
    if (column % 2 === 0) keyboard.row();
  }
  if (column % 2 !== 0) keyboard.row();
  if (options.privateChat && options.webappUrl) {
    keyboard.webApp(tr("🌐 Panel completo"), options.webappUrl).row();
  } else if (options.username) {
    keyboard
      .url(
        tr("🌐 Abrir panel"),
        `https://t.me/${options.username}?start=panel_${options.chatId}`,
      )
      .row();
  }
  keyboard.text(tr("👑 Premium"), "premium:start");
  keyboard.text(tr("🔄 Actualizar"), "settings:refresh");
  return keyboard;
}

export function premiumPlansKeyboard(
  plans: PremiumPlan[],
  chatId: number,
  options: { privateChat: boolean; username: string },
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const plan of plans) {
    const label = `${plan.emoji} ${tr(plan.label)} · ${plan.stars} ⭐${plan.popular ? tr(" · ⭐ Popular") : ""}`;
    if (options.privateChat) {
      keyboard.text(label, `premium:buy:${plan.id}:${chatId}`).row();
    } else {
      keyboard
        .url(label, `https://t.me/${options.username}?start=premium_${chatId}`)
        .row();
    }
  }
  keyboard.text(tr("📋 Ver ventajas"), "help:premium");
  if (!options.privateChat) {
    keyboard.text(tr("ℹ️ Estado"), `premium:status:${chatId}`);
  }
  return keyboard;
}

export function chatSelectionKeyboard(chats: ChatRow[], page = 0): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const size = 6;
  const pages = Math.max(1, Math.ceil(chats.length / size));
  page = Math.max(0, Math.min(pages - 1, page));
  for (const chat of chats.slice(page * size, (page + 1) * size)) {
    const premium = Boolean(chat.premium_until && chat.premium_until.getTime() > Date.now());
    keyboard
      .text(`${premium ? "👑" : "💬"} ${chat.title.slice(0, 40)}`, `premium:chat:${chat.chat_id}`)
      .row();
  }
  if (pages > 1) {
    if (page > 0) keyboard.text(tr("⬅️ Anterior"), `premium:page:${page - 1}`);
    keyboard.text(`${page + 1}/${pages}`, `premium:page:${page}`);
    if (page < pages - 1) keyboard.text(tr("Siguiente ➡️"), `premium:page:${page + 1}`);
  }
  return keyboard;
}

export function helpKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(tr("🛡️ Moderación"), "help:mod")
    .text(tr("⚙️ Ajustes"), "help:settings")
    .row()
    .text(tr("📝 Contenido"), "help:content")
    .text(tr("👑 Premium"), "help:premium")
    .row()
    .text(tr("🌐 Panel"), "help:panel")
    .text(tr("⬅️ Volver"), "help:main");
}

export function backToHelpKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(tr("⬅️ Volver a la ayuda"), "help:main");
}

export function premiumStartKeyboard(username: string): InlineKeyboard {
  return new InlineKeyboard().url(
    tr("👑 Elegir grupo"),
    `https://t.me/${username}?start=premium_0`,
  );
}
