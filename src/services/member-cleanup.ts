import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { logModeration } from '../db/repositories/moderation.js';
import { displayName } from '../utils/format.js';
import { assertActorRight, assertBotRight, banUser, kickUser, type ModerationContext } from './moderation.js';
import { withFreshTelegramReads } from './telegram-cache.js';
import { onceOperation } from './operations.js';
import { query } from '../db/pool.js';
import { isAdminStatus } from '../utils/telegram.js';

export const cleanupCriteriaSchema = z.object({
  inactiveDays: z.number().int().min(7).max(365),
  action: z.enum(['kick', 'ban']),
  limit: z.number().int().min(1).max(200),
  reason: z.string().trim().min(3).max(300),
});
export type CleanupCriteria = z.infer<typeof cleanupCriteriaSchema>;

const sign = (value: string) => createHmac('sha256', config.botToken).update('member-cleanup-v1:' + value).digest();
const fail = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 409 }); };

type Candidate = {
  userId: number; name: string; username: string | null;
  joinedAt: Date | null; lastMessageAt: Date | null; messageCount: number;
};

async function protectedIds(ctx: ModerationContext): Promise<number[]> {
  const ids = new Set<number>([ctx.botId, ctx.actorId, ...config.ownerIds]);
  const administrators = await ctx.api.getChatAdministrators(ctx.chatId).catch(() => []);
  for (const admin of administrators) ids.add(admin.user.id);
  return [...ids];
}

async function candidates(ctx: ModerationContext, criteria: CleanupCriteria, excluded: number[]): Promise<Candidate[]> {
  const rows = await query<{
    user_id: string; first_name: string; last_name: string | null; username: string | null;
    joined_at: Date; last_message_at: Date | null; message_count: string;
  }>(
    `SELECT cm.user_id, u.first_name, u.last_name, u.username, cm.joined_at, cm.last_message_at, cm.message_count
     FROM chat_members cm JOIN users u ON u.user_id = cm.user_id
     WHERE cm.chat_id = $1 AND cm.status = 'member' AND cm.is_bot = false
       AND COALESCE(cm.last_message_at, cm.joined_at) < now() - make_interval(days => $2::int)
       AND NOT (cm.user_id = ANY($3::bigint[]))
       AND NOT EXISTS (SELECT 1 FROM trusted_users t WHERE t.chat_id = cm.chat_id AND t.user_id = cm.user_id AND (t.expires_at IS NULL OR t.expires_at > now()))
     ORDER BY COALESCE(cm.last_message_at, cm.joined_at) ASC
     LIMIT $4::int`,
    [ctx.chatId, criteria.inactiveDays, excluded, criteria.limit]);
  return rows.rows.map(row => ({
    userId: Number(row.user_id),
    name: displayName({ first_name: row.first_name, last_name: row.last_name ?? undefined }),
    username: row.username,
    joinedAt: row.joined_at,
    lastMessageAt: row.last_message_at,
    messageCount: Number(row.message_count),
  }));
}

export async function previewMemberCleanup(ctx: ModerationContext, criteria: CleanupCriteria) {
  return withFreshTelegramReads(async () => {
    await assertActorRight(ctx, 'can_restrict_members');
    await assertBotRight(ctx.api, ctx.chatId, ctx.botId, 'can_restrict_members');
    const excluded = await protectedIds(ctx);
    const items = await candidates(ctx, criteria, excluded);
    const data = Buffer.from(JSON.stringify({
      ...criteria, userIds: items.map(item => item.userId), chatId: ctx.chatId, actorId: ctx.actorId,
      botId: ctx.botId, expires: Date.now() + 5 * 60_000, operationId: randomUUID(),
    })).toString('base64url');
    return { items, token: items.length ? data + '.' + sign(data).toString('base64url') : null };
  });
}

export async function applyMemberCleanup(ctx: ModerationContext, token: string) {
  const [data, signature] = token.split('.');
  if (!data || !signature) return fail('Vuelve a generar la vista previa.');
  const mac = Buffer.from(signature, 'base64url'), expected = sign(data);
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return fail('Vuelve a generar la vista previa.');
  const draft = JSON.parse(Buffer.from(data, 'base64url').toString()) as CleanupCriteria & {
    userIds: number[]; chatId: number; actorId: number; botId: number; operationId: string; expires: number;
  };
  if (draft.chatId !== ctx.chatId || draft.actorId !== ctx.actorId || draft.botId !== ctx.botId || draft.expires < Date.now()) {
    return fail('La vista previa venció o pertenece a otro grupo o administrador.');
  }
  return withFreshTelegramReads(async () => {
    await assertActorRight(ctx, 'can_restrict_members');
    await assertBotRight(ctx.api, ctx.chatId, ctx.botId, 'can_restrict_members');
    return onceOperation(`cleanup:${ctx.chatId}:${draft.operationId}`, async () => {
      const excluded = await protectedIds(ctx);
      const items = [];
      for (const userId of draft.userIds) {
        const name = String(userId);
        if (excluded.includes(userId)) { items.push({ userId, name, state: 'omitted', detail: 'Cuenta protegida.' }); continue; }
        const member = await ctx.api.getChatMember(ctx.chatId, userId).catch(() => null);
        if (!member || member.status !== 'member') { items.push({ userId, name, state: 'omitted', detail: 'Ya no es miembro.' }); continue; }
        if (isAdminStatus(member.status)) { items.push({ userId, name, state: 'omitted', detail: 'Es administrador.' }); continue; }
        try {
          const target = { userId, name };
          const options = { target, reason: draft.reason, durationSeconds: null, requireUnrestricted: true,
            metadata: { cleanupId: draft.operationId, inactiveDays: draft.inactiveDays } };
          if (draft.action === 'ban') await banUser(ctx, options);
          else await kickUser(ctx, options);
          items.push({ userId, name, state: 'applied' });
        } catch {
          items.push({ userId, name, state: 'review', detail: 'Verifica el estado de este miembro en Telegram.' });
        }
      }
      await logModeration({ chatId: ctx.chatId, actorId: ctx.actorId, action: 'member_cleanup',
        reason: draft.reason, metadata: { operationId: draft.operationId, action: draft.action,
          inactiveDays: draft.inactiveDays, items: items.map(({ userId, state }) => ({ userId, state })) } });
      return { items };
    });
  });
}
