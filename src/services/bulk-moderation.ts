import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { logModeration } from '../db/repositories/moderation.js';
import { displayName } from '../utils/format.js';
import { mapConcurrent } from '../utils/concurrency.js';
import { assertActorRight, assertBotRight, banUser, muteUser, type ModerationContext } from './moderation.js';
import { withFreshTelegramReads } from './telegram-cache.js';
import { onceOperation } from './operations.js';

export const bulkInputSchema = z.object({
  action: z.enum(['mute', 'ban']),
  userIds: z.array(z.number().safe().int().positive()).min(2).max(10)
    .refine(ids => new Set(ids).size === ids.length, 'Quita los IDs duplicados.'),
  minutes: z.number().int().min(1).max(43200),
  reason: z.string().trim().min(3).max(300),
});
type BulkInput = z.infer<typeof bulkInputSchema>;
const sign = (value: string) => createHmac('sha256', config.botToken).update('bulk-moderation-v1:' + value).digest();
const fail = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 409 }); };

async function inspectTarget(ctx: ModerationContext, userId: number) {
  if (userId === ctx.actorId || userId === ctx.botId || config.ownerIds.has(userId)) {
    return { userId, allowed: false, name: String(userId), detail: 'Cuenta protegida para esta operación.' };
  }
  const member = await ctx.api.getChatMember(ctx.chatId, userId).catch(() => null);
  const allowed = member?.status === 'member';
  return { userId, allowed, name: member ? displayName(member.user) : String(userId),
    detail: allowed ? '' : 'Telegram no confirma que sea un miembro sin restricciones.' };
}

export async function previewBulkModeration(ctx: ModerationContext, input: BulkInput) {
  return withFreshTelegramReads(async () => {
    await assertActorRight(ctx, 'can_restrict_members');
    await assertBotRight(ctx.api, ctx.chatId, ctx.botId, 'can_restrict_members');
    const items = await mapConcurrent(input.userIds, 3, id => inspectTarget(ctx, id));
    const userIds = items.filter(item => item.allowed).map(item => item.userId);
    const data = Buffer.from(JSON.stringify({
      ...input, userIds, chatId: ctx.chatId, actorId: ctx.actorId, botId: ctx.botId,
      expires: Date.now() + 5 * 60_000, operationId: randomUUID(),
    })).toString('base64url');
    return { items, token: userIds.length ? data + '.' + sign(data).toString('base64url') : null };
  });
}

export async function applyBulkModeration(ctx: ModerationContext, token: string) {
  const [data, signature] = token.split('.');
  if (!data || !signature) return fail('Vuelve a generar la vista previa.');
  const mac = Buffer.from(signature, 'base64url'), expected = sign(data);
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return fail('Vuelve a generar la vista previa.');
  const draft = JSON.parse(Buffer.from(data, 'base64url').toString()) as BulkInput & {
    chatId: number; actorId: number; botId: number; operationId: string; expires: number;
  };
  if (draft.chatId !== ctx.chatId || draft.actorId !== ctx.actorId || draft.botId !== ctx.botId || draft.expires < Date.now()) {
    return fail('La vista previa venció o pertenece a otro grupo o administrador.');
  }
  return withFreshTelegramReads(async () => {
    await assertActorRight(ctx, 'can_restrict_members');
    await assertBotRight(ctx.api, ctx.chatId, ctx.botId, 'can_restrict_members');
    return onceOperation(`bulk:${ctx.chatId}:${draft.operationId}`, async () => {
      const items = [];
      const perform = draft.action === 'mute' ? muteUser : banUser;
      for (const userId of draft.userIds) {
        const target = await inspectTarget(ctx, userId);
        if (!target.allowed) {
          items.push({ ...target, state: 'omitted' });
          continue;
        }
        try {
          await perform(ctx, { target, reason: draft.reason, durationSeconds: draft.minutes * 60, requireUnrestricted: true,
            metadata: { bulkId: draft.operationId } });
          items.push({ ...target, state: 'applied' });
        } catch {
          items.push({ ...target, state: 'review', detail: 'Verifica el estado de este miembro en Telegram.' });
        }
      }
      await logModeration({ chatId: ctx.chatId, actorId: ctx.actorId, action: 'bulk_moderation',
        metadata: { operationId: draft.operationId, action: draft.action, items: items.map(({ userId, state }) => ({ userId, state })) } });
      return { items };
    });
  });
}
