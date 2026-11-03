import { many, one } from "../pool.js";
import type { WarningRow } from "../types.js";

export async function addWarning(
  chatId: number,
  userId: number,
  adminId: number | null,
  reason: string | null,
  expiryDays = 0,
): Promise<WarningRow> {
  const row = await one<WarningRow>(
    `INSERT INTO warnings (chat_id, user_id, admin_id, reason, expires_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $5>0 THEN now()+make_interval(days=>$5) ELSE NULL END)
     RETURNING *`,
    [chatId, userId, adminId, reason, expiryDays],
  );
  return row!;
}

export async function countWarnings(chatId: number, userId: number): Promise<number> {
  const row = await one<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM warnings WHERE chat_id = $1 AND user_id = $2 AND resolved_at IS NULL AND (expires_at IS NULL OR expires_at>now())",
    [chatId, userId],
  );
  return row?.total ?? 0;
}

export async function listWarnings(
  chatId: number,
  userId: number,
  limit = 10,
  includeHistory = false,
): Promise<WarningRow[]> {
  return many<WarningRow>(
    `SELECT * FROM warnings
      WHERE chat_id = $1 AND user_id = $2
        AND ($4 OR (resolved_at IS NULL AND (expires_at IS NULL OR expires_at>now())))
      ORDER BY created_at DESC
      LIMIT $3`,
    [chatId, userId, limit, includeHistory],
  );
}

export async function removeLastWarning(
  chatId: number,
  userId: number,
): Promise<WarningRow | null> {
  return one<WarningRow>(
    `UPDATE warnings SET resolved_at=now()
      WHERE id = (
        SELECT id FROM warnings
         WHERE chat_id = $1 AND user_id = $2 AND resolved_at IS NULL AND (expires_at IS NULL OR expires_at>now())
         ORDER BY created_at DESC
         LIMIT 1
      )
      RETURNING *`,
    [chatId, userId],
  );
}

export async function clearWarnings(chatId: number, userId: number): Promise<number> {
  const row = await one<{ total: number }>(
    `WITH deleted AS (
       UPDATE warnings SET resolved_at=now() WHERE chat_id = $1 AND user_id = $2 AND resolved_at IS NULL AND (expires_at IS NULL OR expires_at>now()) RETURNING 1
     )
     SELECT COUNT(*)::int AS total FROM deleted`,
    [chatId, userId],
  );
  return row?.total ?? 0;
}

export async function countChatWarnings(chatId: number): Promise<number> {
  const row = await one<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM warnings WHERE chat_id = $1 AND resolved_at IS NULL AND (expires_at IS NULL OR expires_at>now())",
    [chatId],
  );
  return row?.total ?? 0;
}
