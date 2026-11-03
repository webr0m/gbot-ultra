import { tr } from "./bot-i18n.js";
import type { Chat } from "grammy/types";
import type { ChatRow, GroupSettings } from "../db/types.js";
import { getChat, updateChatSettings, upsertChat } from "../db/repositories/chats.js";
import { applySettingsPatch, mergeSettings, settingsPatchSchema, type SettingsPatch, type SettingsApplyResult } from "./settings.js";
import { withTransaction } from "../db/pool.js";

interface CacheEntry {
  row: ChatRow;
  expiresAt: number;
}

const TTL_MS = 30_000;
const cache = new Map<number, CacheEntry>();

function chatDescription(chat: Chat): string | null {
  return (chat as { description?: string }).description ?? null;
}

export async function loadChat(chat: Chat): Promise<ChatRow> {
  const cached = cache.get(chat.id);
  if (cached && cached.expiresAt > Date.now()) return cached.row;

  const existing = await getChat(chat.id);
  let row: ChatRow;

  if (existing) {
    const titleChanged = existing.title !== chat.title;
    const usernameChanged = existing.username !== (chat.username ?? null);
    row = titleChanged || usernameChanged
      ? await upsertChat({
          id: chat.id,
          title: chat.title ?? tr("Grupo"),
          username: chat.username ?? null,
          type: chat.type,
          description: chatDescription(chat),
        })
      : existing;
  } else {
    row = await upsertChat({
      id: chat.id,
      title: chat.title ?? tr("Grupo"),
      username: chat.username ?? null,
      type: chat.type,
      description: chatDescription(chat),
    });
  }

  cache.set(chat.id, { row, expiresAt: Date.now() + TTL_MS });
  return row;
}

export function getCachedChat(chatId: number): ChatRow | null {
  const cached = cache.get(chatId);
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached.row;
}

export function invalidateChat(chatId: number): void {
  cache.delete(chatId);
}

export function primeChat(row: ChatRow): void {
  cache.set(row.chat_id, { row, expiresAt: Date.now() + TTL_MS });
}

export function settingsOf(row: ChatRow | null): GroupSettings {
  return mergeSettings(row?.settings);
}

export async function saveChatSettings(
  chatId: number,
  settings: GroupSettings,
): Promise<ChatRow | null> {
  const row = await updateChatSettings(chatId, settings as unknown as Record<string, unknown>);
  if (row) primeChat(row);
  else cache.delete(chatId);
  return row;
}

/** Merge against the latest database state, shared by Telegram and Mini App writes. */
export async function patchChatSettings(chatId: number, patch: SettingsPatch | ((current: GroupSettings) => SettingsPatch), premium: boolean): Promise<SettingsApplyResult> {
  let saved: ChatRow | undefined;
  const result = await withTransaction(async client => {
    const current = (await client.query<ChatRow>("SELECT * FROM chats WHERE chat_id=$1 FOR UPDATE", [chatId])).rows[0];
    if (!current?.active) return { ok: false, error: tr("El grupo no está disponible.") };
    const settings = settingsOf(current);
    const parsed = settingsPatchSchema.safeParse(typeof patch === "function" ? patch(settings) : patch);
    if (!parsed.success) return { ok: false, error: tr("Ajuste no válido. Comprueba el texto y los valores.") };
    const applied = applySettingsPatch(settings, parsed.data, premium);
    if (!applied.ok || !applied.settings) return applied;
    saved = (await client.query<ChatRow>("UPDATE chats SET settings=$2::jsonb, updated_at=now() WHERE chat_id=$1 RETURNING *", [chatId, JSON.stringify(applied.settings)])).rows[0];
    return applied;
  });
  if (saved) primeChat(saved);
  return result;
}
