import { many, one, query } from "../pool.js";
import type { MemberRow, MemberWithUser } from "../types.js";
import { dateOffset, todayInTimeZone } from "../../utils/date.js";
import type { MemberFilter } from '../../services/member-filters.js';

export interface LiveMemberAdmin {
  user_id: number; status: string; first_name: string; last_name: string | null;
  username: string | null; is_bot: boolean; custom_title: string | null;
}

/** The database filters and counts the entire tracked roster; only one page leaves SQL. */
export async function memberPage(chatId: number, search: string, filter: MemberFilter, offset: number, limit: number, admins: LiveMemberAdmin[]) {
  const result = await one<{
    members: (MemberWithUser & { live_admin: boolean })[];
    counts: Record<MemberFilter, number>; tracked: number;
  }>(`WITH live AS (
    SELECT * FROM jsonb_to_recordset($2::jsonb) AS a(user_id bigint,status text,first_name text,last_name text,username text,is_bot boolean,custom_title text)
  ), tracked AS (SELECT * FROM chat_members WHERE chat_id=$1), roster AS (
    SELECT $1::bigint AS chat_id, COALESCE(a.user_id,m.user_id) AS user_id,
      COALESCE(a.status,m.status) AS status,
      CASE WHEN a.user_id IS NOT NULL THEN a.custom_title ELSE m.custom_title END AS custom_title,
      COALESCE(a.is_bot,m.is_bot,false) AS is_bot,m.joined_at,m.last_seen_at,m.last_message_at,
      COALESCE(m.message_count,0) AS message_count,
      COALESCE(a.first_name,u.first_name,'Usuario') AS first_name,
      CASE WHEN a.user_id IS NOT NULL THEN a.last_name ELSE u.last_name END AS last_name,
      CASE WHEN a.user_id IS NOT NULL THEN a.username ELSE u.username END AS username,
      a.user_id IS NOT NULL AS live_admin,COALESCE(w.total,0) AS warn_count
    FROM tracked m FULL JOIN live a ON a.user_id=m.user_id
    LEFT JOIN users u ON u.user_id=COALESCE(a.user_id,m.user_id)
    LEFT JOIN (SELECT user_id,COUNT(*)::int AS total FROM warnings WHERE chat_id=$1 AND resolved_at IS NULL
      AND (expires_at IS NULL OR expires_at>now()) GROUP BY user_id) w ON w.user_id=COALESCE(a.user_id,m.user_id)
  ), searched AS (
    SELECT * FROM roster WHERE $3='' OR strpos(lower(concat_ws(' ',first_name,last_name,username,user_id::text)),lower($3))>0
  ), counts AS (
    SELECT jsonb_build_object(
      'all',count(*) FILTER(WHERE status NOT IN ('left','kicked')),
      'admins',count(*) FILTER(WHERE status IN ('creator','administrator')),
      'restricted',count(*) FILTER(WHERE status='restricted'),
      'warned',count(*) FILTER(WHERE status NOT IN ('left','kicked') AND warn_count>0),
      'kicked',count(*) FILTER(WHERE status IN ('left','kicked'))) AS value FROM searched
  ), page AS (
    SELECT * FROM searched WHERE
      ($4='all' AND status NOT IN ('left','kicked')) OR
      ($4='admins' AND status IN ('creator','administrator')) OR
      ($4='restricted' AND status='restricted') OR
      ($4='warned' AND status NOT IN ('left','kicked') AND warn_count>0) OR
      ($4='kicked' AND status IN ('left','kicked'))
    ORDER BY (status IN ('creator','administrator')) DESC,last_message_at DESC NULLS LAST,joined_at DESC NULLS LAST,user_id
    LIMIT $5 OFFSET $6
  ) SELECT COALESCE((SELECT jsonb_agg(p ORDER BY (p.status IN ('creator','administrator')) DESC,p.last_message_at DESC NULLS LAST,p.joined_at DESC NULLS LAST,p.user_id) FROM page p),'[]'::jsonb) AS members,
    (SELECT value FROM counts) AS counts,
    (SELECT count(*)::int FROM tracked WHERE status NOT IN ('left','kicked')) AS tracked`,
    [chatId, JSON.stringify(admins), search, filter, limit, offset]);
  if (!result) throw new Error('No member page result');
  const total = result.counts[filter];
  return { ...result, total, hasMore: offset + result.members.length < total };
}

export interface MemberUpsertInput {
  chatId: number;
  userId: number;
  status: string;
  isBot?: boolean;
  customTitle?: string | null;
  resetJoinedAt?: boolean;
}

export async function upsertMember(input: MemberUpsertInput): Promise<MemberRow> {
  const row = await one<MemberRow>(
    `INSERT INTO chat_members (chat_id, user_id, status, custom_title, is_bot, joined_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     ON CONFLICT (chat_id, user_id) DO UPDATE SET
       status = EXCLUDED.status,
       custom_title = COALESCE(EXCLUDED.custom_title, chat_members.custom_title),
       is_bot = EXCLUDED.is_bot,
       last_seen_at = now(),
       joined_at = CASE WHEN $6 THEN now() ELSE chat_members.joined_at END
     RETURNING *`,
    [
      input.chatId,
      input.userId,
      input.status,
      input.customTitle ?? null,
      input.isBot ?? false,
      input.resetJoinedAt ?? false,
    ],
  );
  return row!;
}

export async function setMemberStatus(
  chatId: number,
  userId: number,
  status: string,
  customTitle?: string | null,
): Promise<void> {
  await one(
    `UPDATE chat_members
        SET status = $3,
            custom_title = COALESCE($4, custom_title),
            last_seen_at = now()
      WHERE chat_id = $1 AND user_id = $2
      RETURNING chat_id`,
    [chatId, userId, status, customTitle ?? null],
  );
}

export async function touchMember(chatId: number, userId: number): Promise<void> {
  await one(
    `UPDATE chat_members
        SET last_seen_at = now(),
            last_message_at = now(),
            message_count = message_count + 1
      WHERE chat_id = $1 AND user_id = $2
      RETURNING chat_id`,
    [chatId, userId],
  );
}

/**
 * Registra un mensaje en una sola consulta: miembro, estadística diaria del
 * grupo y estadística diaria del miembro. No altera el estado del miembro.
 */
export async function recordMessageActivity(
  chatId: number,
  userId: number,
  isBot: boolean,
): Promise<void> {
  const date = todayInTimeZone();
  await query(
    `WITH member AS (
       INSERT INTO chat_members
         (chat_id, user_id, status, is_bot, joined_at, last_seen_at, last_message_at, message_count)
       VALUES ($1, $2, 'member', $3, now(), now(), now(), 1)
       ON CONFLICT (chat_id, user_id) DO UPDATE SET
         last_seen_at = now(),
         last_message_at = now(),
         message_count = chat_members.message_count + 1
       RETURNING 1
     ), daily AS (
       INSERT INTO daily_stats (chat_id, date, messages)
       VALUES ($1, $4::date, 1)
       ON CONFLICT (chat_id, date) DO UPDATE
         SET messages = daily_stats.messages + 1
       RETURNING 1
     ), member_day AS (
       INSERT INTO member_daily (chat_id, user_id, date, messages)
       VALUES ($1, $2, $4::date, 1)
       ON CONFLICT (chat_id, user_id, date) DO UPDATE
         SET messages = member_daily.messages + 1
       RETURNING 1
     )
     SELECT 1`,
    [chatId, userId, isBot, date],
  );
}

export async function getMember(chatId: number, userId: number): Promise<MemberRow | null> {
  return one<MemberRow>(
    "SELECT * FROM chat_members WHERE chat_id = $1 AND user_id = $2",
    [chatId, userId],
  );
}

export async function listMembers(
  chatId: number,
  limit = 200,
  query = "",
): Promise<MemberWithUser[]> {
  return many<MemberWithUser>(
    `SELECT m.*, u.username, u.first_name, u.last_name
       FROM chat_members m
       JOIN users u ON u.user_id = m.user_id
      WHERE m.chat_id = $1
        AND m.status NOT IN ('left', 'kicked')
        AND ($3 = '' OR u.first_name ILIKE '%' || $3 || '%' OR u.username ILIKE '%' || $3 || '%')
      ORDER BY (m.status IN ('creator', 'administrator')) DESC,
               m.last_message_at DESC NULLS LAST,
               m.joined_at DESC
      LIMIT $2`,
    [chatId, limit, query],
  );
}

export async function countTrackedMembers(chatId: number): Promise<number> {
  const row = await one<{ total: number }>(
    `SELECT COUNT(*)::int AS total
       FROM chat_members
      WHERE chat_id = $1 AND status NOT IN ('left', 'kicked')`,
    [chatId],
  );
  return row?.total ?? 0;
}

export interface TopMember {
  user_id: number;
  first_name: string;
  username: string | null;
  messages: number;
}

export async function topMembers(
  chatId: number,
  period: "today" | "week" | "month" | "all" = "all",
  limit = 10,
): Promise<TopMember[]> {
  if (period === "all") {
    return many<TopMember>(
      `SELECT m.user_id, u.first_name, u.username, m.message_count AS messages
         FROM chat_members m
         JOIN users u ON u.user_id = m.user_id
        WHERE m.chat_id = $1 AND m.message_count > 0
        ORDER BY m.message_count DESC
        LIMIT $2`,
      [chatId, limit],
    );
  }

  const days = period === "today" ? 0 : period === "week" ? 6 : 29;
  const fromDate = days === 0 ? todayInTimeZone() : dateOffset(-days);
  return many<TopMember>(
    `SELECT md.user_id, u.first_name, u.username, SUM(md.messages)::bigint AS messages
       FROM member_daily md
       JOIN users u ON u.user_id = md.user_id
      WHERE md.chat_id = $1 AND md.date >= $2::date
      GROUP BY md.user_id, u.first_name, u.username
      ORDER BY messages DESC
      LIMIT $3`,
    [chatId, fromDate, limit],
  );
}

export async function countBots(chatId: number): Promise<number> {
  const row = await one<{ total: number }>(
    `SELECT COUNT(*)::int AS total
       FROM chat_members
      WHERE chat_id = $1 AND is_bot = TRUE AND status NOT IN ('left', 'kicked')`,
    [chatId],
  );
  return row?.total ?? 0;
}

export async function getWarnCounts(chatId: number): Promise<Map<number, number>> {
  const rows = await many<{ user_id: number; total: number }>(
    `SELECT user_id, COUNT(*)::int AS total
       FROM warnings
      WHERE chat_id = $1 AND resolved_at IS NULL AND (expires_at IS NULL OR expires_at>now())
      GROUP BY user_id`,
    [chatId],
  );
  return new Map(rows.map((row) => [row.user_id, row.total]));
}
