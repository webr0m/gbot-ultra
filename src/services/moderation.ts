import { journalMemberAction } from "./sanction-journal.js";
import { tr } from "./bot-i18n.js";
import {withBotLanguage} from './bot-i18n.js';
import type { Api } from "grammy";
import type { ChatPermissions } from "grammy/types";
import { config } from "../config.js";
import { withTransaction } from "../db/pool.js";
import { logModeration } from "../db/repositories/moderation.js";
import { setMemberStatus } from "../db/repositories/members.js";
import { clearWarnings, addWarning, countWarnings } from "../db/repositories/warnings.js";
import type { ChatRow, GroupSettings } from "../db/types.js";
import { advancedConfig, effectiveAdvanced } from './advanced-config.js';
import { logger } from "../logger.js";
import { formatDuration, untilDateFromSeconds } from "../utils/duration.js";
import { escapeHtml, mentionUser } from "../utils/format.js";
import { formatDateTime } from "../utils/date.js";
import {
  RIGHT_LABELS,
  checkBotRights,
  getChatMemberSafe,
} from "../utils/telegram.js";

export class ModerationError extends Error {
  constructor(
    message: string,
    public readonly userMessage = message,
  ) {
    super(message);
    this.name = "ModerationError";
  }
}

export const MUTED_PERMISSIONS: ChatPermissions = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_react_to_messages: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
};

export const UNMUTED_PERMISSIONS: ChatPermissions = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_react_to_messages: true,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
};

export const LOCKED_PERMISSIONS: ChatPermissions = { ...MUTED_PERMISSIONS };
export const UNLOCKED_PERMISSIONS: ChatPermissions = { ...UNMUTED_PERMISSIONS };

export const MODERATOR_RIGHTS = {
  can_manage_chat: false,
  can_delete_messages: true,
  can_manage_video_chats: true,
  can_restrict_members: true,
  can_promote_members: false,
  can_change_info: false,
  can_invite_users: true,
  can_pin_messages: true,
  can_manage_topics: true,
  can_manage_tags: false,
  is_anonymous: false,
} as const;

export const FULL_ADMIN_RIGHTS = {
  can_manage_chat: true,
  can_delete_messages: true,
  can_manage_video_chats: true,
  can_restrict_members: true,
  can_promote_members: true,
  can_change_info: true,
  can_invite_users: true,
  can_pin_messages: true,
  can_manage_topics: true,
  can_manage_tags: true,
  is_anonymous: false,
} as const;

export const DEMOTED_RIGHTS = {
  can_manage_chat: false,
  can_delete_messages: false,
  can_manage_video_chats: false,
  can_restrict_members: false,
  can_promote_members: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
  can_manage_tags: false,
  is_anonymous: false,
} as const;

function wrapApiError(error: unknown): never {
  if (error instanceof ModerationError) throw error;
  const description =
    (error as { description?: string }).description ??
    (error as { message?: string }).message ??
    tr("Error desconocido");
  const normalized = description.toLowerCase();

  if (normalized.includes(tr("not enough rights")) || normalized.includes("chat_admin_required")) {
    throw new ModerationError(description, tr("Me faltan permisos de administrador para hacer eso."));
  }
  if (normalized.includes(tr("user is an administrator"))) {
    throw new ModerationError(description, tr("No puedo moderar a un administrador del grupo."));
  }
  if (normalized.includes("participant_id_invalid") || normalized.includes(tr("user not found"))) {
    throw new ModerationError(description, tr("El usuario indicado no es válido o no está en el grupo."));
  }
  if (normalized.includes(tr("can't restrict self")) || normalized.includes(tr("cannot restrict self"))) {
    throw new ModerationError(description, tr("No puedo restringirme a mí mismo."));
  }
  if (normalized.includes(tr("chat not found"))) {
    throw new ModerationError(description, tr("No encuentro el grupo. ¿Sigues estando en él?"));
  }
  throw new ModerationError(description, tr("Telegram rechazó la acción. Comprueba mis permisos."));
}

export async function assertBotRight(
  api: Api,
  chatId: number,
  botId: number,
  right: string,
): Promise<void> {
  const result = await checkBotRights(api, chatId, botId, [right]);
  if (!result.ok) {
    const labels = result.missing
      .map((item) => tr(RIGHT_LABELS[item] ?? item))
      .join(", ");
    throw new ModerationError(
      tr("Falta el permiso {0}", [right]),
      tr("Necesito estos permisos de administrador: <b>{0}</b>.", [escapeHtml(labels)]),
    );
  }
}

export interface TargetInfo {
  userId: number;
  name: string;
  username?: string | null;
}

async function assertTargetModeratable(
  api: Api,
  chatId: number,
  actorId: number,
  target: TargetInfo,
  botId: number,
): Promise<void> {
  if (target.userId === botId) {
    throw new ModerationError(tr("No puedo moderarme a mí mismo."), tr("No puedo moderarme a mí mismo."));
  }
  if(config.ownerIds.has(target.userId))throw new ModerationError(tr("Usuario global protegido"),tr("No se puede aplicar esta acción a esta cuenta."));
  if (target.userId === actorId) {
    throw new ModerationError(tr("Auto-moderación"), tr("No puedes moderarte a ti mismo."));
  }

  const member = await getChatMemberSafe(api, chatId, target.userId);
  if (!member) {
    throw new ModerationError(tr("Miembro no encontrado"), tr("Ese usuario no está en el grupo."));
  }
  if (member.status === "creator") {
    throw new ModerationError(tr("El creador no se puede moderar"), tr("No puedo moderar al creador del grupo."));
  }
  if (member.status === "administrator") {
    throw new ModerationError(
      tr("No se puede moderar a un administrador"),
      tr("No puedo moderar a otro administrador. Primero degrádalo."),
    );
  }
}

export interface ModerationContext {
  api: Api;
  chatId: number;
  chat: ChatRow;
  settings: GroupSettings;
  botId: number;
  actorId: number;
  actorName: string;
  source?: "bot" | "miniapp";
  publicLogFallback?:boolean;
}

/** The bot's own rights must not allow a human administrator to exceed theirs. */
export async function assertActorRight(context: ModerationContext, right: string): Promise<void> {
  if (context.actorId === context.botId || config.ownerIds.has(context.actorId)) return;
  const member = await getChatMemberSafe(context.api, context.chatId, context.actorId);
  if (member?.status === "creator") return;
  if (member?.status !== "administrator" || (member as unknown as Record<string, unknown>)[right] !== true) {
    throw new ModerationError(tr("Permiso del administrador insuficiente"), tr("No tienes el permiso de Telegram necesario para esta acción. Pide al creador que revise tus permisos."));
  }
}

async function assertModerationRight(context: ModerationContext, right: string): Promise<void> {
  await assertActorRight(context, right);
  await assertBotRight(context.api, context.chatId, context.botId, right);
}

function targetMention(target: TargetInfo): string {
  return mentionUser({ id: target.userId, first_name: target.name, username: target.username });
}

function actorMention(context: ModerationContext): string {
  return mentionUser({ id: context.actorId, first_name: context.actorName });
}

async function writeLog(
  context: ModerationContext,
  action: string,
  target: TargetInfo | null,
  reason: string | null,
  durationSeconds: number | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  return withBotLanguage(context.settings.language,()=>writeLogLocalized(context,action,target,reason,durationSeconds,metadata));
}
async function writeLogLocalized(context:ModerationContext,action:string,target:TargetInfo|null,reason:string|null,durationSeconds:number|null,metadata:Record<string,unknown>):Promise<void>{
  await logModeration({
    chatId: context.chatId,
    actorId: context.actorId,
    targetId: target?.userId ?? null,
    action,
    reason,
    durationSeconds,
    metadata: { ...metadata, source: context.source ?? "bot" },
  });

  if (!context.settings.logs.enabled || !context.settings.logs.chatId) {
    if(context.publicLogFallback)await context.api.sendMessage(context.chatId,tr("🛡️ Se aplicó una acción de moderación. El destino de registros no está disponible; revisa el panel.")).catch(()=>undefined);
    return;
  }

  const lines = [
    tr("🛡️ <b>Acción de moderación</b>"),
    tr("📌 Grupo: <b>{0}</b>", [escapeHtml(context.chat.title)]),
    tr("⚙️ Acción: <b>{0}</b>", [escapeHtml(action)]),
    tr("👤 Objetivo: {0}", [target ? targetMention(target) : "—"]),
    tr("🛡️ Moderador: {0}", [actorMention(context)]),
  ];
  if (reason) lines.push(tr("📝 Motivo: {0}", [escapeHtml(reason)]));
  if (durationSeconds !== null) lines.push(tr("⏱️ Duración: {0}", [formatDuration(durationSeconds)]));
  lines.push(`🕒 ${formatDateTime(new Date())}`);

  try {
    const advanced=await advancedConfig(context.chatId);
    const threadId=effectiveAdvanced(context.chat,advanced.settings,advanced.actorId).topics.logThreadId;
    await context.api.sendMessage(context.settings.logs.chatId, lines.join("\n"), {
      parse_mode: "HTML",
      message_thread_id:threadId||undefined,
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    logger.warn(
      { err: error, chatId: context.chatId, logChatId: context.settings.logs.chatId },
      tr("No se pudo enviar el registro al canal"),
    );
    if(context.publicLogFallback)await context.api.sendMessage(context.chatId,tr("🛡️ Se aplicó una acción de moderación. Falló el envío al canal de registros; revisa el panel.")).catch(()=>undefined);
  }
}

export interface ActionOptions {
  metadata?:Record<string,unknown>;
  target: TargetInfo;
  reason?: string | null;
  durationSeconds?: number | null;
}

async function banUserRaw(
  context: ModerationContext,
  options: ActionOptions,
): Promise<void> {
  await assertModerationRight(context, "can_restrict_members");
  await assertTargetModeratable(
    context.api,
    context.chatId,
    context.actorId,
    options.target,
    context.botId,
  );

  try {
    await context.api.banChatMember(context.chatId, options.target.userId, {
      until_date: untilDateFromSeconds(options.durationSeconds ?? null),
      revoke_messages: true,
    });
  } catch (error) {
    wrapApiError(error);
  }

  await setMemberStatus(context.chatId, options.target.userId, "kicked");
  await writeLog(
    context,
    "ban",
    options.target,
    options.reason ?? null,
    options.durationSeconds ?? null,
    options.metadata,
  );
}

async function unbanUserRaw(
  context: ModerationContext,
  target: TargetInfo,
): Promise<void> {
  await assertModerationRight(context, "can_restrict_members");
  try {
    await context.api.unbanChatMember(context.chatId, target.userId, {
      only_if_banned: true,
    });
  } catch (error) {
    wrapApiError(error);
  }
  await setMemberStatus(context.chatId, target.userId, "left");
  await writeLog(context, "unban", target, null, null);
}

async function kickUserRaw(
  context: ModerationContext,
  options: ActionOptions,
): Promise<void> {
  await assertModerationRight(context, "can_restrict_members");
  await assertTargetModeratable(
    context.api,
    context.chatId,
    context.actorId,
    options.target,
    context.botId,
  );

  try {
    await context.api.banChatMember(context.chatId, options.target.userId, {
      revoke_messages: false,
    });
    await context.api.unbanChatMember(context.chatId, options.target.userId, {
      only_if_banned: true,
    });
  } catch (error) {
    wrapApiError(error);
  }

  await setMemberStatus(context.chatId, options.target.userId, "left");
  await writeLog(
    context,
    "kick",
    options.target,
    options.reason ?? null,
    null,
  );
}

async function muteUserRaw(
  context: ModerationContext,
  options: ActionOptions,
): Promise<void> {
  await assertModerationRight(context, "can_restrict_members");
  await assertTargetModeratable(
    context.api,
    context.chatId,
    context.actorId,
    options.target,
    context.botId,
  );

  try {
    await context.api.restrictChatMember(
      context.chatId,
      options.target.userId,
      MUTED_PERMISSIONS,
      {
        use_independent_chat_permissions: true,
        until_date: untilDateFromSeconds(options.durationSeconds ?? 3_600),
      },
    );
  } catch (error) {
    wrapApiError(error);
  }

  await setMemberStatus(context.chatId, options.target.userId, "restricted");
  await writeLog(
    context,
    "mute",
    options.target,
    options.reason ?? null,
    options.durationSeconds ?? 3_600,
    options.metadata,
  );
}

async function unmuteUserRaw(
  context: ModerationContext,
  target: TargetInfo,
): Promise<void> {
  await assertModerationRight(context, "can_restrict_members");
  try {
    await context.api.restrictChatMember(
      context.chatId,
      target.userId,
      UNMUTED_PERMISSIONS,
      { use_independent_chat_permissions: true },
    );
  } catch (error) {
    wrapApiError(error);
  }
  await setMemberStatus(context.chatId, target.userId, "member");
  await writeLog(context, "unmute", target, null, null);
}

export type PromotePreset = "moderator" | "full";

export async function promoteUser(
  context: ModerationContext,
  target: TargetInfo,
  preset: PromotePreset = "moderator",
  customTitle?: string | null,
): Promise<void> {
  await assertModerationRight(context, "can_promote_members");

  const member = await getChatMemberSafe(context.api, context.chatId, target.userId);
  if (!member) {
    throw new ModerationError(tr("Miembro no encontrado"), tr("Ese usuario no está en el grupo."));
  }
  if (member.status === "creator") {
    throw new ModerationError(tr("Es el creador"), tr("El creador ya tiene todos los permisos."));
  }

  const rights = preset === "full" ? FULL_ADMIN_RIGHTS : MODERATOR_RIGHTS;
  if (!config.ownerIds.has(context.actorId)) {
    const actor = await getChatMemberSafe(context.api, context.chatId, context.actorId);
    if (actor?.status === "administrator") {
      const raw = actor as unknown as Record<string, unknown>;
      if (Object.entries(rights).some(([key, value]) => value === true && raw[key] !== true)) {
        throw new ModerationError(tr("No puede delegar permisos superiores"), tr("Solo puedes conceder permisos que tú también tienes. Pide al creador que realice esta promoción."));
      }
    }
  }
  try {
    await context.api.promoteChatMember(context.chatId, target.userId, { ...rights });
    if (customTitle) {
      const title = customTitle.trim().slice(0, 16);
      if (title) {
        await context.api.setChatAdministratorCustomTitle(
          context.chatId,
          target.userId,
          title,
        );
      }
    }
  } catch (error) {
    wrapApiError(error);
  }

  await setMemberStatus(context.chatId, target.userId, "administrator", customTitle ?? null);
  await writeLog(context, "promote", target, customTitle ?? null, null, { preset });
}

export async function demoteUser(
  context: ModerationContext,
  target: TargetInfo,
): Promise<void> {
  await assertModerationRight(context, "can_promote_members");

  const member = await getChatMemberSafe(context.api, context.chatId, target.userId);
  if (!member) {
    throw new ModerationError(tr("Miembro no encontrado"), tr("Ese usuario no está en el grupo."));
  }
  if (member.status === "creator") {
    throw new ModerationError(tr("Es el creador"), tr("No puedo degradar al creador del grupo."));
  }
  if (member.status !== "administrator") {
    throw new ModerationError(tr("No es administrador"), tr("Ese usuario no es administrador."));
  }

  try {
    await context.api.promoteChatMember(context.chatId, target.userId, {
      ...DEMOTED_RIGHTS,
    });
  } catch (error) {
    wrapApiError(error);
  }

  await setMemberStatus(context.chatId, target.userId, "member", null);
  await writeLog(context, "demote", target, null, null);
}

export async function lockChat(context: ModerationContext): Promise<void> {
  await assertModerationRight(context, "can_restrict_members");
  try {
    await withTransaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [context.chatId]);
      const existing = await client.query("SELECT permissions FROM chat_locks WHERE chat_id=$1", [context.chatId]);
      if (!existing.rowCount) {
        const chat = await context.api.getChat(context.chatId);
        if (!chat.permissions) throw new ModerationError(tr("Sin permisos de grupo"), tr("No se pudieron leer los permisos actuales. No se ha cerrado el grupo."));
        await client.query("INSERT INTO chat_locks (chat_id, permissions) VALUES ($1, $2::jsonb)", [context.chatId, JSON.stringify(chat.permissions)]);
      }
      await context.api.setChatPermissions(context.chatId, LOCKED_PERMISSIONS, { use_independent_chat_permissions: true });
    });
  } catch (error) {
    wrapApiError(error);
  }
  await writeLog(context, "lock", null, null, null);
}

export async function unlockChat(context: ModerationContext): Promise<void> {
  await assertModerationRight(context, "can_restrict_members");
  try {
    await withTransaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [context.chatId]);
      const result = await client.query<{permissions: ChatPermissions}>("SELECT permissions FROM chat_locks WHERE chat_id=$1", [context.chatId]);
      const permissions = result.rows[0]?.permissions;
      if (!permissions) throw new ModerationError(tr("Sin cierre registrado"), tr("No hay un cierre guardado por GBot. Revisa los permisos en Telegram; no se han modificado."));
      await context.api.setChatPermissions(context.chatId, permissions, { use_independent_chat_permissions: true });
      await client.query("DELETE FROM chat_locks WHERE chat_id=$1", [context.chatId]);
    });
  } catch (error) {
    wrapApiError(error);
  }
  await writeLog(context, "unlock", null, null, null);
}

export interface WarnResult {
  count: number;
  limit: number;
  actionTaken: "mute" | "kick" | "ban" | null;
  cleared: boolean;
}

export async function warnUser(
  context: ModerationContext,
  target: TargetInfo,
  reason: string | null,
): Promise<WarnResult> {
  await assertActorRight(context, "can_restrict_members");
  await assertTargetModeratable(context.api, context.chatId, context.actorId, target, context.botId);
  if (!context.settings.warnings.enabled) {
    throw new ModerationError(
      tr("Advertencias desactivadas"),
      tr("El sistema de advertencias está desactivado en este grupo."),
    );
  }

  const advanced = await advancedConfig(context.chatId);
  const expiryDays = effectiveAdvanced(context.chat, advanced.settings, advanced.actorId).warningExpiry.days;
  const warning = await addWarning(context.chatId, target.userId, context.actorId, reason, expiryDays);
  const count = await countWarnings(context.chatId, target.userId);
  const limit = context.settings.warnings.limit;

  await logModeration({
    chatId: context.chatId,
    actorId: context.actorId,
    targetId: target.userId,
    action: "warn",
    reason,
    metadata: { warningId: warning.id, count, limit, source: context.source ?? "bot" },
  });

  if (count < limit) {
    return { count, limit, actionTaken: null, cleared: false };
  }

  const action = context.settings.warnings.action;
  try {
    if (action === "mute") {
      await muteUser(context, {
        target,
        reason: tr("Límite de advertencias ({0})", [limit]),
        durationSeconds: context.settings.warnings.muteSeconds,
      });
    } else if (action === "kick") {
      await kickUser(context, {
        target,
        reason: tr("Límite de advertencias ({0})", [limit]),
      });
    } else {
      await banUser(context, {
        target,
        reason: tr("Límite de advertencias ({0})", [limit]),
      });
    }
  } catch (error) {
    logger.warn({ err: error, chatId: context.chatId, targetId: target.userId }, tr("Error aplicando acción por warns"));
  }

  await clearWarnings(context.chatId, target.userId);
  return { count, limit, actionTaken: action, cleared: true };
}

export async function purgeMessages(
  api: Api,
  chatId: number,
  messageIds: number[],
): Promise<number> {
  let deleted = 0;
  for (let index = 0; index < messageIds.length; index += 100) {
    const chunk = messageIds.slice(index, index + 100);
    try {
      await api.deleteMessages(chatId, chunk);
      deleted += chunk.length;
    } catch {
      for (const messageId of chunk) {
        try {
          await api.deleteMessage(chatId, messageId);
          deleted += 1;
        } catch {
          // Mensaje demasiado antiguo o sin permisos.
        }
      }
    }
  }
  return deleted;
}

export async function pinMessage(
  api: Api,
  chatId: number,
  messageId: number,
): Promise<void> {
  try {
    await api.pinChatMessage(chatId, messageId, { disable_notification: false });
  } catch (error) {
    wrapApiError(error);
  }
}

export async function unpinMessage(
  api: Api,
  chatId: number,
  messageId?: number,
): Promise<void> {
  try {
    await api.unpinChatMessage(chatId, messageId);
  } catch (error) {
    wrapApiError(error);
  }
}

export async function unpinAll(api: Api, chatId: number): Promise<void> {
  try {
    await api.unpinAllChatMessages(chatId);
  } catch (error) {
    wrapApiError(error);
  }
}

export function moderationSummary(action: string, target: TargetInfo): string {
  const labels: Record<string, string> = {
    ban: tr("🚫 Usuario baneado"),
    unban: tr("✅ Usuario desbaneado"),
    kick: tr("👢 Usuario expulsado"),
    mute: tr("🔇 Usuario silenciado"),
    unmute: tr("🔊 Usuario desilenciado"),
    promote: tr("⬆️ Usuario promovido"),
    demote: tr("⬇️ Usuario degradado"),
    lock: tr("🔒 Grupo cerrado"),
    unlock: tr("🔓 Grupo abierto"),
    warn: tr("⚠️ Advertencia añadida"),
  };
  return `${labels[action] ?? action}: ${targetMention(target)}`;
}

export function formatActionDuration(seconds: number | null | undefined): string {
  return formatDuration(seconds);
}

export function currentTimezone(): string {
  return config.timezone;
}

// Serialize all central member mutations; a later action invalidates an older undo.
export const banUser = (context: ModerationContext, options: ActionOptions) => journalMemberAction(context,options.target.userId,'ban',options.metadata,()=>banUserRaw(context,options));
export const muteUser = (context: ModerationContext, options: ActionOptions) => journalMemberAction(context,options.target.userId,'mute',options.metadata,()=>muteUserRaw(context,options));
export const kickUser = (context: ModerationContext, options: ActionOptions) => journalMemberAction(context,options.target.userId,'kick',options.metadata,()=>kickUserRaw(context,options));
export const unbanUser = (context: ModerationContext, target: TargetInfo) => journalMemberAction(context,target.userId,'unban',undefined,()=>unbanUserRaw(context,target));
export const unmuteUser = (context: ModerationContext, target: TargetInfo) => journalMemberAction(context,target.userId,'unmute',undefined,()=>unmuteUserRaw(context,target));
