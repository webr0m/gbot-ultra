import { tr } from "./bot-i18n.js";
import { GrammyError, type Api } from "grammy";
import { articleMessage, type RichArticle } from "./rich-articles.js";
import type { Chat, Message, User } from "grammy/types";
import type { GroupSettings } from "../db/types.js";
import { escapeHtml, formatNumber, mentionUser } from "../utils/format.js";
import { deleteLater } from "../utils/telegram.js";
import { logger } from "../logger.js";
import {DEFAULT_SETTINGS} from './settings.js';

export interface WelcomeVariables {
  mention: string;
  name: string;
  username: string;
  chat: string;
  id: string;
  count: string;
}

export function welcomeVariables(
  chat: Chat,
  user: User,
  memberCount?: number,
): WelcomeVariables {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return {
    mention: mentionUser(user),
    name: escapeHtml(name || user.username || tr("Usuario")),
    username: user.username ? `@${escapeHtml(user.username)}` : escapeHtml(name || tr("Usuario")),
    chat: escapeHtml(chat.title ?? tr("el grupo")),
    id: String(user.id),
    count: memberCount ? formatNumber(memberCount) : "—",
  };
}

export function renderTemplate(template: string, variables: WelcomeVariables): string {
  let output = template;
  for (const [key, value] of Object.entries(variables)) {
    output = output.replaceAll(`{${key}}`, () => value);
  }
  return output;
}

const HTML_OPTIONS = {
  parse_mode: "HTML" as const,
  link_preview_options: { is_disabled: true },
};

async function sendMedia(
  api: Api,
  chatId: number,
  media: NonNullable<GroupSettings["welcome"]["media"]>,
  caption: string | undefined,
  threadId?: number,
): Promise<Message> {
  const options = { ...HTML_OPTIONS, caption, message_thread_id:threadId||undefined };
  switch (media.type) {
    case "photo":
      return api.sendPhoto(chatId, media.fileId, options);
    case "video":
      return api.sendVideo(chatId, media.fileId, options);
    case "animation":
      return api.sendAnimation(chatId, media.fileId, options);
    case "document":
      return api.sendDocument(chatId, media.fileId, options);
  }
}

export async function sendWelcome(
  api: Api,
  chat: Chat,
  user: User,
  settings: GroupSettings,
  memberCount?: number,
  threadId?:number,
  article?:RichArticle|null,
): Promise<number[]> {
  if (!settings.welcome.enabled) return [];

  const template=settings.welcome.text===DEFAULT_SETTINGS.welcome.text?tr(DEFAULT_SETTINGS.welcome.text,[],settings.language):settings.welcome.text;
  const text = renderTemplate(template, welcomeVariables(chat, user, memberCount));
  const media = settings.welcome.media;
  const sentIds: number[] = [];

  try {
    if (article) {
      const sent = await api.sendRichMessage(chat.id, articleMessage(article.content, article.extras), { message_thread_id: threadId || undefined });
      sentIds.push(sent.message_id);
    } else if (media) {
      const caption = text.length <= 1_024 ? text : undefined;
      const sent = await sendMedia(api, chat.id, media, caption, threadId);
      sentIds.push(sent.message_id);
      if (!caption) {
        const extra = await api.sendMessage(chat.id, text, {...HTML_OPTIONS,message_thread_id:threadId||undefined});
        sentIds.push(extra.message_id);
      }
    } else {
      const sent = await api.sendMessage(chat.id, text, {...HTML_OPTIONS,message_thread_id:threadId||undefined});
      sentIds.push(sent.message_id);
    }
  } catch (error) {
    logger.warn({ err: error, chatId: chat.id, userId: user.id }, tr("No se pudo enviar la bienvenida con multimedia"));
    if (article && !(error instanceof GrammyError && error.error_code === 400)) return [];
    try {
      const sent = await api.sendMessage(chat.id, text, {...HTML_OPTIONS,message_thread_id:threadId||undefined});
      sentIds.push(sent.message_id);
    } catch (fallbackError) {
      logger.warn({ err: fallbackError, chatId: chat.id }, tr("No se pudo enviar la bienvenida"));
      return [];
    }
  }

  if (settings.welcome.deleteAfter > 0) {
    for (const messageId of sentIds) {
      deleteLater(api, chat.id, messageId, settings.welcome.deleteAfter * 1_000);
    }
  }
  return sentIds;
}

export async function sendGoodbye(
  api: Api,
  chat: Chat,
  user: User,
  settings: GroupSettings,
  memberCount?: number,
): Promise<number[]> {
  if (!settings.goodbye.enabled || !settings.goodbye.text.trim()) return [];

  const text = renderTemplate(
    settings.goodbye.text===DEFAULT_SETTINGS.goodbye.text?tr(DEFAULT_SETTINGS.goodbye.text,[],settings.language):settings.goodbye.text,
    welcomeVariables(chat, user, memberCount),
  );

  try {
    const sent = await api.sendMessage(chat.id, text, HTML_OPTIONS);
    deleteLater(api, chat.id, sent.message_id, 60_000);
    return [sent.message_id];
  } catch (error) {
    logger.warn({ err: error, chatId: chat.id }, tr("No se pudo enviar la despedida"));
    return [];
  }
}
