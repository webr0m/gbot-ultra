import { many, one } from "../pool.js";
import type { BlacklistRow, GbanRow } from "../types.js";
import { assertDeveloper, DEVELOPER_ID } from '../../services/roles.js';

// ------------------------------------------------------------
//  Lista negra por grupo
// ------------------------------------------------------------

export async function listBlacklist(chatId: number): Promise<BlacklistRow[]> {
  return many<BlacklistRow>(
    "SELECT * FROM blacklist WHERE chat_id = $1 ORDER BY pattern ASC",
    [chatId],
  );
}

export async function addBlacklist(
  chatId: number,
  pattern: string,
  isRegex: boolean,
  createdBy: number | null,
): Promise<BlacklistRow> {
  const row = await one<BlacklistRow>(
    `INSERT INTO blacklist (chat_id, pattern, is_regex, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (chat_id, pattern) DO UPDATE SET is_regex = EXCLUDED.is_regex
     RETURNING *`,
    [chatId, pattern, isRegex, createdBy],
  );
  return row!;
}

export async function removeBlacklist(chatId: number, pattern: string): Promise<boolean> {
  const row = await one<{ pattern: string }>(
    "DELETE FROM blacklist WHERE chat_id = $1 AND pattern = $2 RETURNING pattern",
    [chatId, pattern],
  );
  return Boolean(row);
}

export async function countBlacklist(chatId: number): Promise<number> {
  const row = await one<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM blacklist WHERE chat_id = $1",
    [chatId],
  );
  return row?.total ?? 0;
}

// ------------------------------------------------------------
//  Baneos globales manuales (exclusivamente el Desarrollador)
// ------------------------------------------------------------

export async function isGbanned(userId: number): Promise<GbanRow | null> {
  return one<GbanRow>("SELECT * FROM gbans WHERE user_id = $1", [userId]);
}

export async function addGban(
  userId: number,
  reason: string | null,
  bannedBy: number | null,
): Promise<GbanRow> {
  assertDeveloper(bannedBy);
  if(userId===DEVELOPER_ID)throw new Error('La cuenta Desarrollador está protegida permanentemente.');
  const row = await one<GbanRow>(
    `INSERT INTO gbans (user_id, reason, banned_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by
     RETURNING *`,
    [userId, reason, bannedBy],
  );
  return row!;
}

export async function removeGban(userId: number,actorId:number): Promise<boolean> {
  assertDeveloper(actorId);
  const row = await one<{ user_id: number }>(
    "DELETE FROM gbans WHERE user_id = $1 RETURNING user_id",
    [userId],
  );
  return Boolean(row);
}

export async function listGbans(limit = 50): Promise<GbanRow[]> {
  return many<GbanRow>(
    "SELECT * FROM gbans ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
}

export async function countGbans(): Promise<number> {
  const row = await one<{ total: number }>("SELECT COUNT(*)::int AS total FROM gbans");
  return row?.total ?? 0;
}
