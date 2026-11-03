import type { Api } from "grammy";
import type { ChatRow, DailyStatRow, GroupStats } from "../db/types.js";
import { getChat } from "../db/repositories/chats.js";
import {
  countBots,
  countTrackedMembers,
  topMembers,
  type TopMember,
} from "../db/repositories/members.js";
import {
  countChatWarnings,
} from "../db/repositories/warnings.js";
import {
  getActionCount,
  getDailyStats,
  getTotals,
} from "../db/repositories/stats.js";
import {
  countModerationToday,
  countModerationTotal,
} from "../db/repositories/moderation.js";
import { getAdminIds } from "../utils/telegram.js";
import { dateOffset, todayInTimeZone } from "../utils/date.js";

export interface ExtendedGroupStats extends GroupStats {
  chatTitle: string;
  moderationToday: number;
  moderationTotal: number;
  premium: boolean;
  premiumDaysLeft: number;
}

function sumField(rows: DailyStatRow[], field: keyof DailyStatRow): number {
  return rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

export async function getGroupStats(
  api: Api,
  chatId: number,
  knownChat?: ChatRow,
): Promise<ExtendedGroupStats> {
  const [chat, tracked, bots, daily, warnings, actions, adminIds, totals, modToday, modTotal, liveCount] =
    await Promise.all([
      knownChat ?? getChat(chatId),
      countTrackedMembers(chatId),
      countBots(chatId),
      getDailyStats(chatId, 30),
      countChatWarnings(chatId),
      getActionCount(chatId),
      getAdminIds(api, chatId).catch(() => new Set<number>()),
      getTotals(chatId),
      countModerationToday(chatId),
      countModerationTotal(chatId),
      api.getChatMemberCount(chatId).catch(() => null),
    ]);

  const memberCount = liveCount ?? tracked;

  const today = todayInTimeZone();
  const todayRow = daily.find((row) => normalizeDate(row.date) === today);
  const last7 = daily.filter((row) => normalizeDate(row.date) >= dateOffset(-6));
  const last30 = daily.filter((row) => normalizeDate(row.date) >= dateOffset(-29));

  const premiumUntil = chat?.premium_until ?? null;
  const premiumDaysLeft =
    premiumUntil && premiumUntil.getTime() > Date.now()
      ? Math.max(1, Math.ceil((premiumUntil.getTime() - Date.now()) / 86_400_000))
      : 0;

  return {
    chatTitle: chat?.title ?? "Grupo",
    memberCount,
    adminCount: adminIds.size,
    botCount: bots,
    trackedMembers: tracked,
    messagesToday: Number(todayRow?.messages ?? 0),
    messages7d: sumField(last7, "messages"),
    messages30d: sumField(last30, "messages"),
    messagesTotal: Number(totals.messages ?? 0),
    joinsToday: Number(todayRow?.joins ?? 0),
    joins7d: sumField(last7, "joins"),
    leavesToday: Number(todayRow?.leaves ?? 0),
    warnings,
    boosts: chat?.boosts ?? 0,
    actionsToday: actions,
    moderationToday: modToday,
    moderationTotal: modTotal,
    premium: premiumDaysLeft > 0,
    premiumDaysLeft,
  };
}

export function normalizeDate(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

export interface ChartPoint {
  date: string;
  label: string;
  messages: number;
  joins: number;
  leaves: number;
}

export async function getChartData(chatId: number, days = 14): Promise<ChartPoint[]> {
  const safeDays = Math.max(1, Math.min(days, 90));
  const rows = await getDailyStats(chatId, safeDays);
  const byDate = new Map(rows.map((row) => [normalizeDate(row.date), row]));
  const points: ChartPoint[] = [];

  for (let index = safeDays - 1; index >= 0; index -= 1) {
    const date = dateOffset(-index);
    const row = byDate.get(date);
    points.push({
      date,
      label: date.slice(8, 10),
      messages: Number(row?.messages ?? 0),
      joins: Number(row?.joins ?? 0),
      leaves: Number(row?.leaves ?? 0),
    });
  }
  return points;
}

export async function getTopMembers(
  chatId: number,
  period: "today" | "week" | "month" | "all" = "week",
  limit = 10,
): Promise<TopMember[]> {
  return topMembers(chatId, period, Math.max(1, Math.min(limit, 50)));
}

export function premiumSummary(chat: ChatRow | null): string {
  if (!chat?.premium_until || chat.premium_until.getTime() <= Date.now()) {
    return "Plan gratuito";
  }
  const days = Math.max(1, Math.ceil((chat.premium_until.getTime() - Date.now()) / 86_400_000));
  return `Premium · ${days} días`;
}
