import { many, one } from "../pool.js";
import type { CaptchaPendingRow } from "../types.js";

export async function setPending(
  chatId: number,
  userId: number,
  messageId: number | null,
  answer: string | null,
  restrictionUntil: number | null = null,
): Promise<CaptchaPendingRow> {
  const row = await one<CaptchaPendingRow>(
    `INSERT INTO captcha_pending (chat_id, user_id, message_id, answer, attempts, restriction_until)
     VALUES ($1, $2, $3, $4, 0, $5)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET
       message_id = EXCLUDED.message_id,
       answer = EXCLUDED.answer,
       restriction_until = EXCLUDED.restriction_until,
       attempts = 0,
       created_at = now()
     RETURNING *`,
    [chatId, userId, messageId, answer, restrictionUntil],
  );
  return row!;
}

export async function getPending(
  chatId: number,
  userId: number,
): Promise<CaptchaPendingRow | null> {
  return one<CaptchaPendingRow>(
    "SELECT * FROM captcha_pending WHERE chat_id = $1 AND user_id = $2",
    [chatId, userId],
  );
}

export async function deletePending(chatId: number, userId: number): Promise<void> {
  await one(
    "DELETE FROM captcha_pending WHERE chat_id = $1 AND user_id = $2 RETURNING user_id",
    [chatId, userId],
  );
}

export async function incrementAttempts(
  chatId: number,
  userId: number,
): Promise<number> {
  const row = await one<{ attempts: number }>(
    `UPDATE captcha_pending
        SET attempts = attempts + 1
      WHERE chat_id = $1 AND user_id = $2
      RETURNING attempts`,
    [chatId, userId],
  );
  return row?.attempts ?? 0;
}

export async function getStalePending(olderThanSeconds: number): Promise<CaptchaPendingRow[]> {
  return many<CaptchaPendingRow>(
    `SELECT * FROM captcha_pending
      WHERE created_at < now() - make_interval(secs => $1)
      ORDER BY created_at ASC
      LIMIT 100`,
    [olderThanSeconds],
  );
}

export async function clearStalePending(olderThanSeconds: number): Promise<number> {
  const row = await one<{ total: number }>(
    `WITH deleted AS (
       DELETE FROM captcha_pending
        WHERE created_at < now() - make_interval(secs => $1)
        RETURNING 1
     )
     SELECT COUNT(*)::int AS total FROM deleted`,
    [olderThanSeconds],
  );
  return row?.total ?? 0;
}
