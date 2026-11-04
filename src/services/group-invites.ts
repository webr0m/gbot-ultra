import { randomUUID } from 'node:crypto';
import { many, one, query, withSessionLock } from '../db/pool.js';
import { logModeration } from '../db/repositories/moderation.js';
import { assertActorRight, assertBotRight, type ModerationContext } from './moderation.js';
import { onceOperation } from './operations.js';

type Invite = {
  id: string; name: string; bot_id: number; actor_id: number;
  invite_link: string; expires_at: Date; member_limit: number; revoked_at: Date | null;
};

export function listGroupInvites(chatId: number): Promise<Invite[]> {
  return many<Invite>(
    'SELECT * FROM group_invites WHERE chat_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY expires_at LIMIT 20', [chatId],
  );
}

export async function createGroupInvite(ctx: ModerationContext, input: { name: string; hours: number; memberLimit: number; operationId: string }): Promise<void> {
  await assertActorRight(ctx, 'can_invite_users');
  await assertBotRight(ctx.api, ctx.chatId, ctx.botId, 'can_invite_users');
  await onceOperation(`invite-create:${ctx.chatId}:${ctx.actorId}:${input.operationId}`, () =>
    withSessionLock(`invites:${ctx.chatId}`, async () => {
      if ((await listGroupInvites(ctx.chatId)).length >= 20) {
        throw Object.assign(new Error('Ya hay 20 enlaces activos. Revoca uno antes de crear otro.'), { statusCode: 409 });
      }
      const expiresAt = Math.floor(Date.now() / 1000) + input.hours * 3600;
      const link = await ctx.api.createChatInviteLink(ctx.chatId, {
        name: input.name, expire_date: expiresAt, member_limit: input.memberLimit,
      });
      const inviteId = randomUUID();
      await query(
        'INSERT INTO group_invites(id,chat_id,actor_id,bot_id,invite_link,name,member_limit,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8))',
        [inviteId, ctx.chatId, ctx.actorId, ctx.botId, link.invite_link, input.name, input.memberLimit, expiresAt],
      );
      await logModeration({ chatId: ctx.chatId, actorId: ctx.actorId, action: 'invite_created', metadata: { inviteId } });
      return inviteId;
    }));
}

export async function revokeGroupInvite(ctx: ModerationContext, inviteId: string): Promise<void> {
  await assertActorRight(ctx, 'can_invite_users');
  await assertBotRight(ctx.api, ctx.chatId, ctx.botId, 'can_invite_users');
  const invite = await one<Invite>('SELECT * FROM group_invites WHERE chat_id=$1 AND id=$2', [ctx.chatId, inviteId]);
  if (!invite || invite.revoked_at) return;
  if (invite.bot_id !== ctx.botId) {
    throw Object.assign(new Error('El enlace lo creó otro bot. Usa la gestión de invitaciones de Telegram.'), { statusCode: 409 });
  }
  await onceOperation(`invite-revoke:${ctx.chatId}:${inviteId}`, async () => {
    await ctx.api.revokeChatInviteLink(ctx.chatId, invite.invite_link);
    await query("UPDATE group_invites SET revoked_at=now(),invite_link='' WHERE chat_id=$1 AND id=$2", [ctx.chatId, inviteId]);
    await logModeration({ chatId: ctx.chatId, actorId: ctx.actorId, action: 'invite_revoked', metadata: { inviteId } });
    return null;
  });
}
