import { many, one } from "../pool.js";
import type { ChatRow } from "../types.js";

export interface ChatUpsertInput {
  id: number;
  title: string;
  username?: string | null;
  type: string;
  description?: string | null;
  ownerId?: number | null;
}

export async function upsertChat(input: ChatUpsertInput): Promise<ChatRow> {
  const row = await one<ChatRow>(
    `INSERT INTO chats (chat_id, title, username, type, description, owner_id, active)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)
     ON CONFLICT (chat_id) DO UPDATE SET
       title = EXCLUDED.title,
       username = EXCLUDED.username,
       type = EXCLUDED.type,
       description = EXCLUDED.description,
       owner_id = COALESCE(chats.owner_id, EXCLUDED.owner_id),
       active = TRUE,
       updated_at = now()
     RETURNING *`,
    [
      input.id,
      input.title,
      input.username ?? null,
      input.type,
      input.description ?? null,
      input.ownerId ?? null,
    ],
  );
  return row!;
}

export async function getChat(chatId: number): Promise<ChatRow | null> {
  return one<ChatRow>("SELECT * FROM chats WHERE chat_id = $1", [chatId]);
}

export async function updateChatSettings(
  chatId: number,
  settings: Record<string, unknown>,
): Promise<ChatRow | null> {
  return one<ChatRow>(
    `UPDATE chats
        SET settings = $2::jsonb,
            updated_at = now()
      WHERE chat_id = $1
      RETURNING *`,
    [chatId, JSON.stringify(settings)],
  );
}

export async function setChatActive(chatId: number, active: boolean): Promise<void> {
  await one(
    "UPDATE chats SET active = $2, updated_at = now() WHERE chat_id = $1 RETURNING chat_id",
    [chatId, active],
  );
}

export async function getActiveChats(): Promise<ChatRow[]> {
  return many<ChatRow>("SELECT * FROM chats WHERE active ORDER BY chat_id");
}

export async function countChats(): Promise<number> {
  const row = await one<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM chats WHERE active",
  );
  return row?.total ?? 0;
}

export async function getAdminChatsForUser(userId: number): Promise<ChatRow[]> {
  return many<ChatRow>(
    `SELECT c.*
       FROM chats c
       JOIN chat_members m ON m.chat_id = c.chat_id
      WHERE m.user_id = $1
        AND m.status IN ('creator', 'administrator')
        AND c.active
      ORDER BY c.title ASC`,
    [userId],
  );
}

export async function getChatsOwnedBy(userId: number): Promise<ChatRow[]> {
  return many<ChatRow>(
    "SELECT * FROM chats WHERE owner_id = $1 AND active ORDER BY title ASC",
    [userId],
  );
}

export async function setBoosts(chatId: number, boosts: number): Promise<void> {
  await one(
    "UPDATE chats SET boosts = $2, updated_at = now() WHERE chat_id = $1 RETURNING chat_id",
    [chatId, Math.max(0, boosts)],
  );
}

export async function setChatOwner(chatId: number, ownerId: number): Promise<void> {
  await one(
    "UPDATE chats SET owner_id = $2, updated_at = now() WHERE chat_id = $1 RETURNING chat_id",
    [chatId, ownerId],
  );
}

export async function setChatDescription(
  chatId: number,
  description: string | null,
): Promise<void> {
  await one(
    "UPDATE chats SET description = $2, updated_at = now() WHERE chat_id = $1 RETURNING chat_id",
    [chatId, description],
  );
}
