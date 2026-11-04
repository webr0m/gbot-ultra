// ============================================================
//  Tipos de dominio y filas de PostgreSQL
// ============================================================

export interface WelcomeMedia {
  type: "photo" | "video" | "animation" | "document";
  fileId: string;
}

export interface WelcomeSettings {
  enabled: boolean;
  text: string;
  media: WelcomeMedia | null;
  deleteAfter: number;
}

export interface GroupSettings {
  welcome: WelcomeSettings;
  goodbye: { enabled: boolean; text: string };
  rules: { enabled: boolean; text: string; button: boolean };
  captcha: { enabled: boolean; mode: "button" | "math"; timeoutSeconds: number };
  antilink: {
    enabled: boolean;
    action: "delete" | "mute" | "ban";
    muteSeconds: number;
    whitelist: string[];
  };
  antiflood: {
    enabled: boolean;
    limit: number;
    windowSeconds: number;
    muteSeconds: number;
  };
  blacklist: { enabled: boolean; action: "delete" | "warn" | "mute" | "ban" };
  warnings: {
    enabled: boolean;
    limit: number;
    action: "mute" | "kick" | "ban";
    muteSeconds: number;
  };
  reports: { enabled: boolean };
  logs: { enabled: boolean; chatId: number | null };
  serviceMessages: { deleteJoins: boolean };
  joinRequests: { autoApprove: boolean };
  language: string;
}

export interface ChatRow {
  chat_id: number;
  title: string;
  username: string | null;
  type: string;
  description: string | null;
  owner_id: number | null;
  premium_until: Date | null;
  premium_plan: string | null;
  premium_tier?: string | null;
  pro_license_id?: number | null;
  pro_owner_id?: number | null;
  premium_reminder_sent: boolean;
  active: boolean;
  settings: Partial<GroupSettings>;
  boosts: number;
  created_at: Date;
  updated_at: Date;
}

export interface UserRow {
  user_id: number;
  username: string | null;
  first_name: string;
  last_name: string | null;
  language_code: string | null;
  is_bot: boolean;
  first_seen_at: Date;
  last_seen_at: Date;
}

export interface MemberRow {
  chat_id: number;
  user_id: number;
  status: string;
  custom_title: string | null;
  is_bot: boolean;
  joined_at: Date;
  last_seen_at: Date;
  last_message_at: Date | null;
  message_count: number;
}

export interface MemberWithUser extends MemberRow {
  username: string | null;
  first_name: string;
  last_name: string | null;
  warn_count?: number;
}

export interface WarningRow {
  id: number;
  chat_id: number;
  user_id: number;
  admin_id: number | null;
  reason: string | null;
  created_at: Date;
  expires_at?: Date | null;
  resolved_at?: Date | null;
}

export interface ModerationLogRow {
  id: number;
  chat_id: number;
  actor_id: number | null;
  target_id: number | null;
  action: string;
  reason: string | null;
  duration_seconds: number | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  actor_name?: string | null;
  actor_username?: string | null;
  target_name?: string | null;
  target_username?: string | null;
}

export interface DailyStatRow {
  chat_id: number;
  date: string;
  messages: number;
  joins: number;
  leaves: number;
  commands: number;
}

export interface PaymentRow {
  id: number;
  charge_id: string | null;
  user_id: number | null;
  chat_id: number | null;
  amount: number;
  currency: string;
  plan: string | null;
  days: number | null;
  payload: string | null;
  created_at: Date;
}

export interface PremiumPlan {
  tier?: 'premium'|'pro'|'ultra';
  kind?: 'subscription'|'license';
  groups?: number;
  id: string;
  label: string;
  days: number;
  stars: number;
  perDay: string;
  save: string | null;
  popular: boolean;
  emoji: string;
}

export interface PremiumStatus {
  active: boolean;
  plan: string | null;
  until: Date | null;
  daysLeft: number;
  autoRenew: boolean;
}

export interface CustomCommandRow {
  chat_id: number;
  name: string;
  content: string;
  created_by: number | null;
  uses: number;
  created_at: Date;
}

export interface NoteRow {
  chat_id: number;
  name: string;
  content: string;
  created_by: number | null;
  uses: number;
  created_at: Date;
}

export interface BlacklistRow {
  chat_id: number;
  pattern: string;
  is_regex: boolean;
  created_by: number | null;
  created_at: Date;
}

export interface GbanRow {
  user_id: number;
  reason: string | null;
  banned_by: number | null;
  created_at: Date;
}

export interface PremiumCodeRow {
  code: string;
  days: number;
  plan: string | null;
  created_by: number | null;
  created_at: Date;
  redeemed_by: number | null;
  redeemed_chat_id: number | null;
  redeemed_at: Date | null;
}

export interface CaptchaPendingRow {
  restriction_until: number | null;
  chat_id: number;
  user_id: number;
  message_id: number | null;
  answer: string | null;
  attempts: number;
  created_at: Date;
}

export interface ChatBoostRow {
  chat_id: number;
  boost_id: string;
  user_id: number | null;
  added_at: Date;
}

export interface GroupStats {
  memberCount: number;
  adminCount: number;
  botCount: number;
  trackedMembers: number;
  messagesToday: number;
  messages7d: number;
  messages30d: number;
  messagesTotal: number;
  joinsToday: number;
  joins7d: number;
  leavesToday: number;
  warnings: number;
  boosts: number;
  actionsToday: number;
}
