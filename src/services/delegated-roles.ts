import type { Message } from 'grammy/types';
import { config } from '../config.js';
import { many, one, query, withSessionLock } from '../db/pool.js';
import { logModeration } from '../db/repositories/moderation.js';
import { hasFeature } from './entitlements.js';
import { ModerationError, assertBotRight, type ModerationContext } from './moderation.js';
import { withFreshTelegramReads } from './telegram-cache.js';
import { tr } from './bot-i18n.js';

export const DELEGATE_SCOPES = ['delete', 'pin'] as const;
type Scope = typeof DELEGATE_SCOPES[number];
type Role = { user_id: number; granted_by: number; scopes: Scope[]; expires_at: Date };
const isOwner = async (ctx: ModerationContext, userId: number) =>
  config.ownerIds.has(userId) || (await ctx.api.getChatMember(ctx.chatId, userId)).status === 'creator';

export function listDelegates(chatId: number): Promise<Role[]> {
  return many<Role>('SELECT user_id,granted_by,scopes,expires_at FROM delegated_roles WHERE chat_id=$1 AND expires_at>now() ORDER BY expires_at', [chatId]);
}

export async function manageDelegate(ctx: ModerationContext, userId: number, grant?: { scopes: Scope[]; hours: number }): Promise<void> {
  await withFreshTelegramReads(async () => {
    if (!await isOwner(ctx, ctx.actorId)) throw new ModerationError(tr('Solo el propietario del grupo puede delegar funciones.'));
    if (grant && !hasFeature(ctx.chat, 'delegatedRoles', ctx.actorId)) throw new ModerationError(tr('Los roles temporales requieren Ultra.'));
    await withSessionLock(`delegates:${ctx.chatId}`, async () => {
      if (grant) {
        const member = await ctx.api.getChatMember(ctx.chatId, userId);
        if (member.status !== 'member' || member.user.is_bot || config.ownerIds.has(userId)) {
          throw new ModerationError(tr('Elige un miembro del grupo sin otro rango ni restricciones.'));
        }
        const active = await listDelegates(ctx.chatId);
        if (active.length >= 20 && !active.some(role => role.user_id === userId)) {
          throw new ModerationError(tr('Ya hay 20 roles temporales activos.'));
        }
        await query(`INSERT INTO delegated_roles(chat_id,user_id,granted_by,scopes,expires_at)
          VALUES($1,$2,$3,$4,now()+make_interval(hours=>$5))
          ON CONFLICT(chat_id,user_id) DO UPDATE SET granted_by=EXCLUDED.granted_by,scopes=EXCLUDED.scopes,expires_at=EXCLUDED.expires_at`,
          [ctx.chatId, userId, ctx.actorId, grant.scopes, grant.hours]);
      } else await query('DELETE FROM delegated_roles WHERE chat_id=$1 AND user_id=$2', [ctx.chatId, userId]);
      await logModeration({ chatId: ctx.chatId, actorId: ctx.actorId, targetId: userId,
        action: grant ? 'delegate_granted' : 'delegate_revoked', metadata: grant ?? {} });
    });
  });
}

export async function delegateMessageAction(ctx: ModerationContext, action: Scope, message: Message): Promise<void> {
  await withSessionLock(`delegates:${ctx.chatId}`, () => withFreshTelegramReads(async () => {
    const role = await one<Role>('SELECT * FROM delegated_roles WHERE chat_id=$1 AND user_id=$2 AND expires_at>now()', [ctx.chatId, ctx.actorId]);
    if (!role?.scopes.includes(action) || !hasFeature(ctx.chat, 'delegatedRoles', role.granted_by) || !await isOwner(ctx, role.granted_by)) {
      throw new ModerationError(tr('No tienes un rol temporal vigente para esta acción.'));
    }
    const actor = await ctx.api.getChatMember(ctx.chatId, ctx.actorId);
    if (actor.status !== 'member') throw new ModerationError(tr('Tu cuenta debe seguir siendo miembro del grupo para usar el rol.'));
    const author = message.from;
    if (message.sender_chat || !author || author.is_bot || config.ownerIds.has(author.id) ||
        (await ctx.api.getChatMember(ctx.chatId, author.id)).status !== 'member') {
      throw new ModerationError(tr('El rol temporal solo puede actuar sobre mensajes de miembros del grupo.'));
    }
    await assertBotRight(ctx.api, ctx.chatId, ctx.botId, action === 'delete' ? 'can_delete_messages' : 'can_pin_messages');
    if (action === 'delete') await ctx.api.deleteMessage(ctx.chatId, message.message_id);
    else await ctx.api.pinChatMessage(ctx.chatId, message.message_id, { disable_notification: true });
    await logModeration({ chatId: ctx.chatId, actorId: ctx.actorId, targetId: author.id,
      action: 'delegate_' + action, metadata: { messageId: message.message_id, grantedBy: role.granted_by } });
  }));
}
