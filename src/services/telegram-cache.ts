import { AsyncLocalStorage } from "node:async_hooks";
import type { Transformer } from "grammy";
import { ReadCache } from "./read-cache.js";

const freshReads = new AsyncLocalStorage<boolean>();
export function withFreshTelegramReads<T>(run: () => Promise<T>): Promise<T> { return freshReads.run(true, run); }

const TTL: Record<string, number> = {
  getChat: 60_000,
  getChatAdministrators: 30_000,
  getChatMember: 5_000,
  getChatMemberCount: 30_000,
  getUserProfilePhotos: 3600_000,
  getFile: 30 * 60_000,
};
const MEMBERSHIP_WRITES = new Set([
  "banChatMember", "unbanChatMember", "restrictChatMember", "promoteChatMember",
  "setChatAdministratorCustomTitle", "approveChatJoinRequest", "declineChatJoinRequest",
  "leaveChat", "setChatPermissions", "setChatTitle", "setChatDescription", "setChatPhoto", "deleteChatPhoto",
]);

export function createTelegramApiCache(onInvalidate?: (chatId: number) => void) {
  const cache = new ReadCache();
  function invalidateChat(chatId: number | string): void {
    cache.invalidate(String(chatId));
    if (Number.isSafeInteger(Number(chatId))) onInvalidate?.(Number(chatId));
  }
  const transformer: Transformer = async (next, method, payload, signal) => {
    const fields = payload as Record<string, unknown>;
    const tag = fields.chat_id === undefined ? undefined : String(fields.chat_id);
    const ttl = TTL[method];
    if (ttl && !freshReads.getStore()) {
      const key = method + ":" + JSON.stringify(payload, Object.keys(fields).sort());
      return cache.get(key, ttl, () => next(method, payload, signal), tag, response => response.ok);
    }
    const result = await next(method, payload, signal);
    if (result.ok && tag && MEMBERSHIP_WRITES.has(method)) invalidateChat(tag);
    return result;
  };
  return { transformer, invalidateChat };
}
