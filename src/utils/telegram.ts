import { tr } from "../services/bot-i18n.js";
import type { Api, Context } from "grammy";
import type {
  Chat,
  ChatMember,
  ChatMemberAdministrator,
  ChatMemberOwner,
  User,
} from "grammy/types";

const ADMIN_CACHE_TTL_MS = 30_000;
const BOT_MEMBER_CACHE_TTL_MS = 10_000;

interface AdminCacheEntry {
  ids: Set<number>;
  expiresAt: number;
}

const adminCache = new Map<number, AdminCacheEntry>();
const botMemberCache = new Map<string, { member: ChatMember; expiresAt: number }>();

export function isAdminStatus(status: string): boolean {
  return status === "creator" || status === "administrator";
}

export function isAdminMember(member: ChatMember | null | undefined): boolean {
  return Boolean(member && isAdminStatus(member.status));
}

export function isOwnerMember(member: ChatMember | null | undefined): member is ChatMemberOwner {
  return Boolean(member && member.status === "creator");
}

export function isAdministratorMember(
  member: ChatMember | null | undefined,
): member is ChatMemberAdministrator {
  return Boolean(member && member.status === "administrator");
}

export function invalidateAdminCache(chatId: number): void {
  adminCache.delete(chatId);
  for(const key of botMemberCache.keys())if(key.endsWith(':'+chatId))botMemberCache.delete(key);
}

export async function getAdminIds(
  api: Api,
  chatId: number,
  force = false,
): Promise<Set<number>> {
  const cached = adminCache.get(chatId);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.ids;

  try {
    const admins = await api.getChatAdministrators(chatId);
    const ids = new Set(admins.map((member) => member.user.id));
    adminCache.set(chatId, { ids, expiresAt: Date.now() + ADMIN_CACHE_TTL_MS });
    return ids;
  } catch {
    return cached && cached.expiresAt > Date.now() ? cached.ids : new Set();
  }
}

export async function isUserAdmin(
  api: Api,
  chatId: number,
  userId: number,
  force = false,
): Promise<boolean> {
  const ids = await getAdminIds(api, chatId, force);
  return ids.has(userId);
}

export async function getChatMemberSafe(
  api: Api,
  chatId: number,
  userId: number,
): Promise<ChatMember | null> {
  try {
    return await api.getChatMember(chatId, userId);
  } catch {
    return null;
  }
}

export async function getBotMember(
  api: Api,
  chatId: number,
  botId: number,
): Promise<ChatMember | null> {
  const identity=botId+':'+chatId;
  const cached = botMemberCache.get(identity);
  if (cached && cached.expiresAt > Date.now()) return cached.member;
  const member = await getChatMemberSafe(api, chatId, botId);
  if (member) {
    botMemberCache.set(identity, { member, expiresAt: Date.now() + BOT_MEMBER_CACHE_TTL_MS });
  }
  return member;
}

export const RIGHT_LABELS: Record<string, string> = {
  administrator: tr("Ser administrador"),
  can_delete_messages: tr("Eliminar mensajes"),
  can_restrict_members: tr("Restringir miembros"),
  can_pin_messages: tr("Fijar mensajes"),
  can_promote_members: tr("Promover miembros"),
  can_change_info: tr("Cambiar la información"),
  can_invite_users: tr("Invitar usuarios"),
  can_manage_video_chats: tr("Gestionar videollamadas"),
  can_manage_topics: tr("Gestionar temas"),
  can_manage_chat: tr("Gestionar el chat"),
};

export interface BotRightsResult {
  ok: boolean;
  missing: string[];
  isAdmin: boolean;
}

export async function checkBotRights(
  api: Api,
  chatId: number,
  botId: number,
  required: string[] = [],
): Promise<BotRightsResult> {
  const member = await getBotMember(api, chatId, botId);
  if (!member || member.status !== "administrator") {
    return { ok: false, missing: ["administrator", ...required], isAdmin: false };
  }
  const missing = required.filter((right) => {
    const value = (member as unknown as Record<string, unknown>)[right];
    return value !== true;
  });
  return { ok: missing.length === 0, missing, isAdmin: true };
}

export interface BotRightsMap {
  isAdmin: boolean;
  can_manage_chat: boolean;
  can_delete_messages: boolean;
  can_restrict_members: boolean;
  can_promote_members: boolean;
  can_change_info: boolean;
  can_invite_users: boolean;
  can_pin_messages: boolean;
  can_manage_video_chats: boolean;
  can_manage_topics: boolean;
}

export async function getBotRightsMap(
  api: Api,
  chatId: number,
  botId: number,
): Promise<BotRightsMap> {
  const member = await getBotMember(api, chatId, botId);
  if (!member || member.status !== "administrator") {
    return {
      isAdmin: false,
      can_manage_chat: false,
      can_delete_messages: false,
      can_restrict_members: false,
      can_promote_members: false,
      can_change_info: false,
      can_invite_users: false,
      can_pin_messages: false,
      can_manage_video_chats: false,
      can_manage_topics: false,
    };
  }
  const raw = member as unknown as Record<string, unknown>;
  return {
    isAdmin: true,
    can_manage_chat: raw.can_manage_chat === true,
    can_delete_messages: raw.can_delete_messages === true,
    can_restrict_members: raw.can_restrict_members === true,
    can_promote_members: raw.can_promote_members === true,
    can_change_info: raw.can_change_info === true,
    can_invite_users: raw.can_invite_users === true,
    can_pin_messages: raw.can_pin_messages === true,
    can_manage_video_chats: raw.can_manage_video_chats === true,
    can_manage_topics: raw.can_manage_topics === true,
  };
}

export function isAnonymousAdmin(ctx: Context): boolean {
  const message = ctx.msg;
  return Boolean(
    message?.sender_chat &&
      ctx.chat &&
      message.sender_chat.id === ctx.chat.id &&
      !message.from,
  );
}

export function isGroupChat(chat: Chat | undefined | null): boolean {
  return chat?.type === "group" || chat?.type === "supergroup";
}

export function messageLink(chat: Chat, messageId: number): string | null {
  if (chat.username) return `https://t.me/${chat.username}/${messageId}`;
  if (chat.type === "supergroup" && String(chat.id).startsWith("-100")) {
    return `https://t.me/c/${String(chat.id).slice(4)}/${messageId}`;
  }
  return null;
}

export function memberStatusLabel(status: string): string {
  switch (status) {
    case "creator":
      return tr("Creador");
    case "administrator":
      return tr("Administrador");
    case "restricted":
      return tr("Restringido");
    case "left":
      return tr("Salió");
    case "kicked":
      return tr("Expulsado");
    default:
      return tr("Miembro");
  }
}

export function displayUserFromMember(member: ChatMember): User {
  return member.user;
}

export async function safeDelete(
  api: Api,
  chatId: number,
  messageId: number,
): Promise<void> {
  try {
    await api.deleteMessage(chatId, messageId);
  } catch {
    // El mensaje ya no existe o el bot no tiene permisos.
  }
}

export function deleteLater(
  api: Api,
  chatId: number,
  messageId: number,
  delayMs: number,
): void {
  const timer = setTimeout(() => {
    void safeDelete(api, chatId, messageId);
  }, delayMs);
  timer.unref?.();
}

export function isTelegramEntityLink(text: string): boolean {
  return /\b(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/)/i.test(text);
}
