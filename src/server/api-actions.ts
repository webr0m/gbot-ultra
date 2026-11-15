import type { Api } from "grammy";
import type { ChatRow } from "../db/types.js";
import {
  countModerationLog,
  listModerationLog,
  logModeration,
} from "../db/repositories/moderation.js";
import {
  countTrackedMembers,
  getWarnCounts,
  listMembers,
} from "../db/repositories/members.js";
import { getDailyStats, getTotals } from "../db/repositories/stats.js";
import { getUser } from "../db/repositories/users.js";
import { settingsOf } from "../services/chat-cache.js";
import {
  banUser,
  demoteUser,
  kickUser,
  ModerationError,
  muteUser,
  promoteUser,
  unbanUser,
  unmuteUser,
  warnUser,
  type ModerationContext,
  type PromotePreset,
  type TargetInfo,
  type WarnResult,
} from "../services/moderation.js";
import { displayName } from "../utils/format.js";
import { getChatMemberSafe } from "../utils/telegram.js";
import { serializeLog } from "./serializers.js";

export const MODERATION_ACTIONS = [
  "ban",
  "unban",
  "mute",
  "unmute",
  "kick",
  "warn",
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const ADMIN_ACTIONS = ["promote", "demote"] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export const ADMIN_PRESETS = ["moderator", "full"] as const;

const ADMIN_RIGHT_KEYS = [
  "can_manage_chat",
  "can_delete_messages",
  "can_manage_video_chats",
  "can_restrict_members",
  "can_promote_members",
  "can_change_info",
  "can_invite_users",
  "can_pin_messages",
  "can_manage_topics",
  "can_manage_tags",
] as const;

export interface ApiActor {
  id: string;
  name: string;
  created_by: number;
}

export interface ApiModerationResult {
  ok: true;
  action: ModerationAction;
  target?: TargetInfo;
  warning?: WarnResult;
  message: string;
}

export interface ApiAdminResult {
  ok: true;
  action: AdminAction;
  target: TargetInfo;
  preset?: PromotePreset;
  message: string;
}

export class ApiTargetNotFoundError extends Error {
  constructor() {
    super("Ese usuario no existe o no está en el grupo.");
    this.name = "ApiTargetNotFoundError";
  }
}

export async function resolveApiTarget(
  api: Api,
  chatId: number,
  userId: number,
): Promise<TargetInfo> {
  const member = await getChatMemberSafe(api, chatId, userId);
  if (member)
    return {
      userId,
      name: displayName(member.user),
      username: member.user.username ?? null,
    };
  const user = await getUser(userId);
  if (user)
    return {
      userId,
      name: displayName({
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
      }),
      username: user.username,
    };
  throw new ApiTargetNotFoundError();
}

export async function readApiMembers(
  chat: ChatRow,
  limit: number,
  search: string,
): Promise<Record<string, unknown>> {
  const [rows, total, warns] = await Promise.all([
    listMembers(chat.chat_id, limit, search),
    countTrackedMembers(chat.chat_id),
    getWarnCounts(chat.chat_id),
  ]);
  return {
    ok: true,
    total,
    items: rows.map((member) => ({
      id: member.user_id,
      displayName:
        [member.first_name, member.last_name].filter(Boolean).join(" ").trim() ||
        member.username ||
        "Usuario",
      username: member.username,
      status: member.status,
      messages: Number(member.message_count ?? 0),
      warnings: warns.get(member.user_id) ?? 0,
      joinedAt: member.joined_at
        ? new Date(member.joined_at).toISOString()
        : null,
      lastMessageAt: member.last_message_at
        ? new Date(member.last_message_at).toISOString()
        : null,
    })),
  };
}

export async function readApiStats(
  chat: ChatRow,
  days: number,
): Promise<Record<string, unknown>> {
  const [daily, totals] = await Promise.all([
    getDailyStats(chat.chat_id, days),
    getTotals(chat.chat_id),
  ]);
  return {
    ok: true,
    days,
    totals: {
      messages: Number(totals.messages ?? 0),
      joins: Number(totals.joins ?? 0),
      leaves: Number(totals.leaves ?? 0),
      commands: Number(totals.commands ?? 0),
    },
    daily: daily.map((row) => ({
      date: row.date,
      messages: Number(row.messages ?? 0),
      joins: Number(row.joins ?? 0),
      leaves: Number(row.leaves ?? 0),
      commands: Number(row.commands ?? 0),
    })),
  };
}

export function readApiSettings(chat: ChatRow): Record<string, unknown> {
  return { ok: true, settings: settingsOf(chat) };
}

export async function readApiAdmins(
  api: Api,
  chatId: number,
): Promise<Record<string, unknown>> {
  const members = await api.getChatAdministrators(chatId);
  const items = members.map((member) => {
    const raw = member as unknown as Record<string, unknown>;
    const isOwner = member.status === "creator";
    return {
      id: member.user.id,
      displayName: displayName(member.user),
      username: member.user.username ?? null,
      status: member.status,
      customTitle:
        typeof raw.custom_title === "string" && raw.custom_title.length > 0
          ? raw.custom_title
          : null,
      isOwner,
      rights: Object.fromEntries(
        ADMIN_RIGHT_KEYS.map((key) => [key, isOwner || raw[key] === true]),
      ),
    };
  });
  return { ok: true, total: items.length, items };
}

export async function readApiModerationLog(
  chat: ChatRow,
  limit: number,
  offset: number,
  action: string,
): Promise<Record<string, unknown>> {
  const [items, total] = await Promise.all([
    listModerationLog(chat.chat_id, limit, offset, action),
    countModerationLog(chat.chat_id, action),
  ]);
  return {
    ok: true,
    total,
    hasMore: offset + limit < total,
    items: items.map(serializeLog),
  };
}

export function apiModerationContext(
  api: Api,
  chat: ChatRow,
  botId: number,
  actor: ApiActor,
  channel: string,
): ModerationContext {
  return {
    api,
    chatId: chat.chat_id,
    chat,
    settings: settingsOf(chat),
    botId,
    actorId: actor.created_by,
    actorName: `${channel} · ${actor.name}`,
    source: "api",
  };
}

export async function applyApiModeration(
  context: ModerationContext,
  action: ModerationAction,
  target: TargetInfo,
  reason: string | null,
  durationSeconds: number | null,
  actor: ApiActor,
  channel: string,
  defaultReason: string,
): Promise<ApiModerationResult> {
  if (action === "warn") {
    const result = await warnUser(context, target, reason);
    await logModeration({
      chatId: context.chatId,
      actorId: context.actorId,
      targetId: target.userId,
      action: `${channel}_warn`,
      reason,
      metadata: { keyId: actor.id, keyName: actor.name, count: result.count },
    });
    return {
      ok: true,
      action,
      target,
      warning: result,
      message: `Advertencia ${result.count}/${result.limit} para ${target.name}.`,
    };
  }
  switch (action) {
    case "ban":
      await banUser(context, { target, reason: reason ?? defaultReason, durationSeconds });
      break;
    case "unban":
      await unbanUser(context, target);
      break;
    case "kick":
      await kickUser(context, { target, reason: reason ?? defaultReason });
      break;
    case "mute":
      await muteUser(context, {
        target,
        reason: reason ?? defaultReason,
        durationSeconds: durationSeconds ?? 3_600,
      });
      break;
    case "unmute":
      await unmuteUser(context, target);
      break;
  }
  await logModeration({
    chatId: context.chatId,
    actorId: context.actorId,
    targetId: target.userId,
    action: `${channel}_${action}`,
    reason,
    durationSeconds,
    metadata: { keyId: actor.id, keyName: actor.name },
  });
  return {
    ok: true,
    action,
    target,
    message: `${action}: ${target.name}.`,
  };
}

export async function applyApiAdminChange(
  context: ModerationContext,
  action: AdminAction,
  target: TargetInfo,
  preset: PromotePreset,
  customTitle: string | null,
  actor: ApiActor,
  channel: string,
): Promise<ApiAdminResult> {
  if (action === "promote") await promoteUser(context, target, preset, customTitle);
  else await demoteUser(context, target);
  await logModeration({
    chatId: context.chatId,
    actorId: context.actorId,
    targetId: target.userId,
    action: `${channel}_${action}`,
    reason: customTitle,
    metadata: {
      keyId: actor.id,
      keyName: actor.name,
      ...(action === "promote" ? { preset } : {}),
    },
  });
  return {
    ok: true,
    action,
    target,
    preset: action === "promote" ? preset : undefined,
    message:
      action === "promote"
        ? `${target.name} ahora es administrador.`
        : `${target.name} ya no es administrador.`,
  };
}
