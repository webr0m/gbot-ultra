import { many, one, query } from "../pool.js";
import type { DailyStatRow } from "../types.js";
import { dateOffset, todayInTimeZone } from "../../utils/date.js";

export type DailyField = "messages" | "joins" | "leaves" | "commands";

const FIELD_MAP: Record<DailyField, string> = {
  messages: "messages",
  joins: "joins",
  leaves: "leaves",
  commands: "commands",
};

export async function bumpDaily(
  chatId: number,
  field: DailyField,
  amount = 1,
): Promise<void> {
  const column = FIELD_MAP[field];
  const date = todayInTimeZone();
  await query(
    `INSERT INTO daily_stats (chat_id, date, ${column})
     VALUES ($1, $2::date, $3)
     ON CONFLICT (chat_id, date) DO UPDATE
       SET ${column} = daily_stats.${column} + EXCLUDED.${column}`,
    [chatId, date, amount],
  );
}

export async function bumpMemberDaily(
  chatId: number,
  userId: number,
  amount = 1,
): Promise<void> {
  const date = todayInTimeZone();
  await query(
    `INSERT INTO member_daily (chat_id, user_id, date, messages)
     VALUES ($1, $2, $3::date, $4)
     ON CONFLICT (chat_id, user_id, date) DO UPDATE
       SET messages = member_daily.messages + EXCLUDED.messages`,
    [chatId, userId, date, amount],
  );
}

export async function getDailyStats(chatId: number, days: number): Promise<DailyStatRow[]> {
  const from = dateOffset(-(days - 1));
  return many<DailyStatRow>(
    `SELECT * FROM daily_stats
      WHERE chat_id = $1 AND date >= $2::date
      ORDER BY date ASC`,
    [chatId, from],
  );
}

export interface StatTotals {
  messages: number;
  joins: number;
  leaves: number;
  commands: number;
}

export async function getTotals(chatId: number): Promise<StatTotals> {
  const row = await one<StatTotals>(
    `SELECT COALESCE(SUM(messages), 0)::bigint AS messages,
            COALESCE(SUM(joins), 0)::bigint AS joins,
            COALESCE(SUM(leaves), 0)::bigint AS leaves,
            COALESCE(SUM(commands), 0)::bigint AS commands
       FROM daily_stats
      WHERE chat_id = $1`,
    [chatId],
  );
  return row ?? { messages: 0, joins: 0, leaves: 0, commands: 0 };
}

export async function getRangeTotals(chatId: number, fromDate: string): Promise<StatTotals> {
  const row = await one<StatTotals>(
    `SELECT COALESCE(SUM(messages), 0)::bigint AS messages,
            COALESCE(SUM(joins), 0)::bigint AS joins,
            COALESCE(SUM(leaves), 0)::bigint AS leaves,
            COALESCE(SUM(commands), 0)::bigint AS commands
       FROM daily_stats
      WHERE chat_id = $1 AND date >= $2::date`,
    [chatId, fromDate],
  );
  return row ?? { messages: 0, joins: 0, leaves: 0, commands: 0 };
}

export async function incrementActionCounter(chatId: number): Promise<number> {
  const row = await one<{ actions: number }>(
    `INSERT INTO action_counters (chat_id, date, actions)
     VALUES ($1, $2::date, 1)
     ON CONFLICT (chat_id, date) DO UPDATE
       SET actions = action_counters.actions + 1
     RETURNING actions`,
    [chatId, todayInTimeZone()],
  );
  return row?.actions ?? 1;
}

export async function getActionCount(chatId: number): Promise<number> {
  const row = await one<{ actions: number }>(
    "SELECT actions FROM action_counters WHERE chat_id = $1 AND date = $2::date",
    [chatId, todayInTimeZone()],
  );
  return row?.actions ?? 0;
}

export interface BotTotals {
  users: number;
  chats: number;
  premiumChats: number;
  messages: number;
  actions: number;
  stars: number;
}

export async function getBotTotals(): Promise<BotTotals> {
  const row = await one<BotTotals>(
    `SELECT
       (SELECT COUNT(*)::int FROM users) AS users,
       (SELECT COUNT(*)::int FROM chats WHERE active) AS chats,
       (SELECT COUNT(*)::int FROM chats WHERE active AND premium_until > now()) AS "premiumChats",
       (SELECT COALESCE(SUM(messages), 0)::bigint FROM daily_stats) AS messages,
       (SELECT COALESCE(SUM(actions), 0)::bigint FROM action_counters) AS actions,
       (SELECT COALESCE(SUM(amount), 0)::bigint FROM payments WHERE currency = 'XTR') AS stars`,
  );
  return row ?? { users: 0, chats: 0, premiumChats: 0, messages: 0, actions: 0, stars: 0 };
}
