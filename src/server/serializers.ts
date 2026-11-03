import type {
  ChatRow,
  MemberWithUser,
  ModerationLogRow,
  PaymentRow,
  PremiumPlan,
} from "../db/types.js";
import { getPremiumStatus, premiumPlanLabel } from "../services/premium.js";
import { memberStatusLabel } from "../utils/telegram.js";
import { avatarUrl } from "./auth.js";
import { config } from "../config.js";
import { globalRole, globalRoleLabel } from "../services/roles.js";
import { chatTier } from '../services/entitlements.js';

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function serializePlan(plan: PremiumPlan) {
  return {
    tier:plan.tier??'premium',kind:plan.kind??'subscription',groups:plan.groups??1,
    id: plan.id,
    label: plan.label,
    days: plan.days,
    stars: plan.stars,
    perDay: plan.perDay,
    save: plan.save,
    popular: plan.popular,
    emoji: plan.emoji,
  };
}

export function serializeChatSummary(chat: ChatRow) {
  const premium = getPremiumStatus(chat);
  return {
    id: chat.chat_id,
    title: chat.title,
    username: chat.username,
    type: chat.type,
    photoUrl: avatarUrl(chat.chat_id,chat.chat_id),
    boosts: chat.boosts,
    premium: {
      tier: chatTier(chat),
      active: premium.active,
      plan: premium.plan,
      planLabel: premiumPlanLabel(premium.plan),
      until: iso(premium.until),
      daysLeft: premium.daysLeft,
    },
  };
}

export function serializeMember(member: MemberWithUser, chatId: number, warns = 0) {
  return {
    id: member.user_id,
    roleLabel: globalRoleLabel(globalRole(member.user_id, config.ownerIds)),
    firstName: member.first_name,
    lastName: member.last_name,
    username: member.username,
    displayName:
      [member.first_name, member.last_name].filter(Boolean).join(" ").trim() ||
      member.username ||
      "Usuario",
    status: member.status,
    statusLabel: memberStatusLabel(member.status),
    customTitle: member.custom_title,
    isBot: member.is_bot,
    messages: Number(member.message_count ?? 0),
    warns,
    joinedAt: iso(member.joined_at),
    lastSeenAt: iso(member.last_seen_at),
    lastMessageAt: iso(member.last_message_at),
    avatarUrl: avatarUrl(chatId, member.user_id),
  };
}

export function serializeLog(row: ModerationLogRow) {
  return {
    id: row.id,
    action: row.action,
    reason: row.reason,
    durationSeconds: row.duration_seconds,
    createdAt: iso(row.created_at),
    metadata: row.metadata ?? {},
    actor: row.actor_id
      ? {
          id: row.actor_id,
          name: row.actor_name ?? "Administrador",
          username: row.actor_username,
        }
      : null,
    target: row.target_id
      ? {
          id: row.target_id,
          name: row.target_name ?? "Usuario",
          username: row.target_username,
        }
      : null,
  };
}

export function serializePayment(payment: PaymentRow) {
  return {
    id: payment.id,
    amount: Number(payment.amount ?? 0),
    currency: payment.currency,
    plan: payment.plan,
    planLabel: premiumPlanLabel(payment.plan),
    days: payment.days,
    createdAt: iso(payment.created_at),
  };
}
