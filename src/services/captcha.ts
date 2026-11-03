import { memberMutation } from "./sanction-journal.js";
import { tr } from "./bot-i18n.js";
import { randomInt } from "node:crypto";
import { InlineKeyboard, type Api } from "grammy";
import type { Chat, User } from "grammy/types";
import type { GroupSettings } from "../db/types.js";
import { config } from "../config.js";
import {
  deletePending,
  getPending,
  getStalePending,
  incrementAttempts,
  setPending,
} from "../db/repositories/captcha.js";
import { getChat } from "../db/repositories/chats.js";
import { logModeration } from "../db/repositories/moderation.js";
import { logger } from "../logger.js";
import { untilDateFromSeconds } from "../utils/duration.js";
import { escapeHtml, mentionUser } from "../utils/format.js";
import { MUTED_PERMISSIONS, UNMUTED_PERMISSIONS } from "./moderation.js";
import { getCachedChat, settingsOf } from "./chat-cache.js";

const pendingUsers = new Set<string>();

function key(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

export function isCaptchaPending(chatId: number, userId: number): boolean {
  return pendingUsers.has(key(chatId, userId));
}

function randomMath(): { answer: number; question: string; options: number[] } {
  const left = randomInt(2, 10);
  const right = randomInt(2, 10);
  const answer = left + right;
  const options = new Set<number>([answer]);
  while (options.size < 4) {
    const candidate = answer + randomInt(-5, 6);
    if (candidate >= 0 && candidate !== answer) options.add(candidate);
  }
  return {
    answer,
    question: `${left} + ${right}`,
    options: [...options].sort(() => Math.random() - 0.5),
  };
}

async function restrict(
  api: Api,
  chatId: number,
  userId: number,
  seconds: number,
): Promise<void> {
  try {
    await memberMutation(chatId,userId,()=>api.restrictChatMember(chatId, userId, MUTED_PERMISSIONS, {
      until_date: untilDateFromSeconds(seconds),
      use_independent_chat_permissions: true,
    }));
  } catch (error) {
    logger.warn({ err: error, chatId, userId }, tr("No se pudo restringir para el captcha"));
  }
}

async function unrestrict(api: Api, chatId: number, userId: number): Promise<void> {
  try {
    await memberMutation(chatId,userId,()=>api.restrictChatMember(chatId, userId, UNMUTED_PERMISSIONS, {
      use_independent_chat_permissions: true,
    }));
  } catch (error) {
    logger.warn({ err: error, chatId, userId }, tr("No se pudo quitar la restricción del captcha"));
  }
}

async function removeMessage(api: Api, chatId: number, messageId: number | null): Promise<void> {
  if (!messageId) return;
  try {
    await api.deleteMessage(chatId, messageId);
  } catch {
    // Mensaje ya eliminado.
  }
}

export async function sendCaptcha(
  api: Api,
  chat: Chat,
  user: User,
  settings: GroupSettings,
): Promise<boolean> {
  if (!settings.captcha.enabled || config.ownerIds.has(user.id)) return false;

  const timeout = settings.captcha.timeoutSeconds;
  const mention = mentionUser(user);
  const keyboard = new InlineKeyboard();
  let answer: string;
  let text: string;

  if (settings.captcha.mode === "math") {
    const math = randomMath();
    answer = String(math.answer);
    text =
      tr("🧮 <b>Verificación</b>\n\n") +
      tr("Hola {0}, para poder escribir en <b>{1}</b> ", [mention,escapeHtml(chat.title ?? tr("el grupo"))]) +
      tr("resuelve esta operación:\n\n") +
      `<b>${math.question} = ?</b>\n\n` +
      tr("⏳ Tienes {0} minuto(s).", [Math.round(timeout / 60)]);
    for (const option of math.options) {
      keyboard.text(String(option), `cap:${option}:${user.id}`);
    }
  } else {
    answer = "ok";
    text =
      tr("🔐 <b>Verificación</b>\n\n") +
      tr("Hola {0}, pulsa el botón para confirmar que eres humano y poder escribir en ", [mention]) +
      `<b>${escapeHtml(chat.title ?? tr("el grupo"))}</b>.\n\n` +
      tr("⏳ Tienes {0} minuto(s).", [Math.round(timeout / 60)]);
    keyboard.text(tr("✅ Soy humano"), `cap:ok:${user.id}`);
  }

  await restrict(api, chat.id, user.id, timeout);

  try {
    const message = await api.sendMessage(chat.id, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
    await setPending(chat.id, user.id, message.message_id, answer);
    pendingUsers.add(key(chat.id, user.id));
    return true;
  } catch (error) {
    logger.warn({ err: error, chatId: chat.id, userId: user.id }, tr("No se pudo enviar el captcha"));
    await unrestrict(api, chat.id, user.id);
    return false;
  }
}

export type CaptchaVerdict =
  | { status: "ok" }
  | { status: "missing" }
  | { status: "wrong"; attempts: number }
  | { status: "kicked" };

export async function verifyCaptcha(
  api: Api,
  chatId: number,
  userId: number,
  value: string,
): Promise<CaptchaVerdict> {
  if (config.ownerIds.has(userId)) {
    await deletePending(chatId, userId);
    pendingUsers.delete(key(chatId, userId));
    return { status: "ok" };
  }
  const pending = await getPending(chatId, userId);
  if (!pending) {
    pendingUsers.delete(key(chatId, userId));
    return { status: "missing" };
  }

  if (pending.answer !== value) {
    const attempts = await incrementAttempts(chatId, userId);
    if (attempts >= 3) {
      await kickUnverified(api, chatId, userId, tr("Captcha fallado 3 veces"));
      await deletePending(chatId, userId);
      pendingUsers.delete(key(chatId, userId));
      await removeMessage(api, chatId, pending.message_id);
      return { status: "kicked" };
    }
    return { status: "wrong", attempts };
  }

  await deletePending(chatId, userId);
  pendingUsers.delete(key(chatId, userId));
  await unrestrict(api, chatId, userId);
  await removeMessage(api, chatId, pending.message_id);
  return { status: "ok" };
}

async function kickUnverified(
  api: Api,
  chatId: number,
  userId: number,
  reason: string,
): Promise<void> {
  try {
    await memberMutation(chatId,userId,async()=>{
      await api.banChatMember(chatId, userId, { revoke_messages: false });
      await api.unbanChatMember(chatId, userId, { only_if_banned: true });
    });
    await logModeration({
      chatId,
      actorId: null,
      targetId: userId,
      action: "kick",
      reason,
      metadata: { automated: true, source: "captcha" },
    });
  } catch (error) {
    logger.warn({ err: error, chatId, userId }, tr("No se pudo expulsar al usuario sin verificar"));
  }
}

export async function expireCaptchas(fallbackApi: Api): Promise<number> {
  const pending = await getStalePending(120);
  let expired = 0;

  for (const entry of pending) {
    const {runtimeForChat}=await import('./branded-bots.js');
    const api=(await runtimeForChat(entry.chat_id))?.bot.api??fallbackApi;
    if (config.ownerIds.has(entry.user_id)) {
      await deletePending(entry.chat_id, entry.user_id);
      pendingUsers.delete(key(entry.chat_id, entry.user_id));
      continue;
    }
    const cached = getCachedChat(entry.chat_id);
    const chat = cached ?? (await getChat(entry.chat_id));
    if (!chat) {
      await deletePending(entry.chat_id, entry.user_id);
      continue;
    }
    const settings = settingsOf(chat);
    const timeoutMs = settings.captcha.timeoutSeconds * 1_000;
    if (Date.now() - entry.created_at.getTime() < timeoutMs) continue;

    await kickUnverified(api, entry.chat_id, entry.user_id, tr("Captcha no completado a tiempo"));
    await deletePending(entry.chat_id, entry.user_id);
    pendingUsers.delete(key(entry.chat_id, entry.user_id));
    await removeMessage(api, entry.chat_id, entry.message_id);
    expired += 1;
  }

  return expired;
}

export function clearPendingCache(): void {
  pendingUsers.clear();
}
