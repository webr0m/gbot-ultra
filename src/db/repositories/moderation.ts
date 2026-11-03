import { many, one } from "../pool.js";
import type { ModerationLogRow } from "../types.js";
import { todayInTimeZone } from "../../utils/date.js";

export interface ModerationLogInput {
  chatId: number;
  actorId?: number | null;
  targetId?: number | null;
  action: string;
  reason?: string | null;
  durationSeconds?: number | null;
  metadata?: Record<string, unknown>;
}

export async function logModeration(input: ModerationLogInput): Promise<ModerationLogRow> {
  const row = await one<ModerationLogRow>(
    `INSERT INTO moderation_log
       (chat_id, actor_id, target_id, action, reason, duration_seconds, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    [
      input.chatId,
      input.actorId ?? null,
      input.targetId ?? null,
      input.action,
      input.reason ?? null,
      input.durationSeconds ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return row!;
}

export async function listModerationLog(
  chatId: number,
  limit = 50,
  offset = 0,
  action?: string,
): Promise<ModerationLogRow[]> {
  return many<ModerationLogRow>(
    `SELECT l.*,
            au.first_name AS actor_name,
            au.username AS actor_username,
            tu.first_name AS target_name,
            tu.username AS target_username
       FROM moderation_log l
       LEFT JOIN users au ON au.user_id = l.actor_id
       LEFT JOIN users tu ON tu.user_id = l.target_id
      WHERE l.chat_id = $1
        AND ($4 = '' OR l.action = $4)
      ORDER BY l.created_at DESC
      LIMIT $2 OFFSET $3`,
    [chatId, limit, offset, action ?? ""],
  );
}

export async function countModerationLog(
  chatId: number,
  action = "",
): Promise<number> {
  const row = await one<{ total: number }>(
    `SELECT COUNT(*)::int AS total
       FROM moderation_log
      WHERE chat_id = $1 AND ($2 = '' OR action = $2)`,
    [chatId, action],
  );
  return row?.total ?? 0;
}

export async function countModerationToday(chatId: number): Promise<number> {
  const row = await one<{ total: number }>(
    `SELECT COUNT(*)::int AS total
       FROM moderation_log
      WHERE chat_id = $1 AND created_at::date = $2::date`,
    [chatId, todayInTimeZone()],
  );
  return row?.total ?? 0;
}

export async function countModerationTotal(chatId: number): Promise<number> {
  const row = await one<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM moderation_log WHERE chat_id = $1",
    [chatId],
  );
  return row?.total ?? 0;
}
