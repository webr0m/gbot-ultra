import { createHash, randomInt } from 'node:crypto';
import { GrammyError, type Api } from 'grammy';
import type { ChatJoinRequest } from 'grammy/types';
import { config } from '../config.js';
import { one, query, many, withSessionLock, withTransaction } from '../db/pool.js';
import { getChat } from '../db/repositories/chats.js';
import type { ChatRow } from '../db/types.js';
import { logger } from '../logger.js';
import { advancedConfig, trustedScopes } from './advanced-config.js';
import { hasFeature } from './entitlements.js';
import { globalBan } from './global-bans.js';
import { brandRow, brandRuntime } from './branded-bots.js';

const tokenOf = (id: string) => 'native:' + createHash('sha256').update(id).digest('hex');
// grammY's raw API types the signal using its Node compatibility shim.
const timeout = (ms: number) => AbortSignal.timeout(ms) as unknown as NonNullable<Parameters<Api['raw']['answerChatJoinRequestQuery']>[1]>;
type Decision = 'approve' | 'decline' | 'queue';
type State = 'pending' | 'approving' | 'approved' | 'declined' | 'expired' | 'failed' | 'manual_review' | 'native_uncertain' | 'delivery_failed';
export type NativeChallenge = {
  token: string;
  chat_id: number;
  user_id: number;
  native_query: string | null;
  native_bot_id: number;
  native_request_id: string;
  native_prompt: string;
  answer: string;
  attempts: number;
  state: State;
  expires_at: Date;
};

export function findNativeChallenge(id: string) {
  return one<NativeChallenge>('SELECT * FROM join_challenges WHERE token=$1 AND native_bot_id IS NOT NULL', [tokenOf(id)]);
}

async function nativeSettings(chat: ChatRow) {
  const saved = await advancedConfig(chat.chat_id);
  return saved.settings.joinGate.enabled && hasFeature(chat, 'joinGate', saved.actorId) ? saved : null;
}

export async function answerNativeJoin(api: Api, queryId: string, result: Decision): Promise<void> {
  await api.raw.answerChatJoinRequestQuery({ chat_join_request_query_id: queryId, result }, timeout(2500));
}

export async function openNativeJoin(api: Api, botId: number, chat: ChatRow, request: ChatJoinRequest, requestId: string): Promise<boolean> {
  const id = request.query_id;
  if (!id || id.length > 1024 || !config.hasWebapp || config.ownerIds.has(request.from.id) || !chat.active) return false;
  const saved = await nativeSettings(chat);
  if (!saved) return false;
  if (hasFeature(chat, 'trust', saved.actorId) && (await trustedScopes(chat.chat_id, request.from.id)).includes('captcha')) return false;
  const math = saved.settings.joinGate.mode === 'math';
  const left = randomInt(2, 10), right = randomInt(2, 10);
  const token = tokenOf(id);
  await query(`INSERT INTO join_challenges(token,chat_id,user_id,user_chat_id,answer,expires_at,native_query,native_bot_id,native_request_id,native_prompt)
    VALUES($1,$2,$3,$4,$5,now()+interval '2 minutes',$6,$7,$8,$9)
    ON CONFLICT(chat_id,user_id) DO UPDATE SET token=EXCLUDED.token,user_chat_id=EXCLUDED.user_chat_id,
      answer=EXCLUDED.answer,expires_at=EXCLUDED.expires_at,state='pending',attempts=0,native_query=EXCLUDED.native_query,
      native_bot_id=EXCLUDED.native_bot_id,native_request_id=EXCLUDED.native_request_id,native_prompt=EXCLUDED.native_prompt`,
    [token, chat.chat_id, request.from.id, request.user_chat_id, math ? String(left + right) : 'ok',
      id, botId, requestId, math ? `${left} + ${right}` : '']);
  try {
    const url = new URL('/verificar-ingreso.html', config.webappUrl);
    await api.raw.sendChatJoinRequestWebApp({ chat_join_request_query_id: id, web_app_url: url.href }, timeout(3500));
    return true;
  } catch {
    await query("UPDATE join_challenges SET state='delivery_failed',native_query=NULL WHERE token=$1 AND state='pending'", [token]);
    logger.warn({ chatId: chat.chat_id }, 'Telegram no confirmó la apertura del portal de ingreso');
    return false;
  }
}

export async function nativeJoinBot(row: NativeChallenge, primary: {api:Api;id:number}) {
  if (row.native_bot_id === primary.id) return { api: primary.api, token: config.botToken, active: true, ownerId: undefined };
  const brand = await brandRow(row.chat_id);
  if (!brand || brand.bot_id !== row.native_bot_id) return null;
  try {
    const runtime = await brandRuntime(brand);
    return { api: runtime.bot.api, token: runtime.token, active: brand.state === 'active', ownerId: brand.owner_id };
  } catch { return null; }
}

function lockFor(row: NativeChallenge) {
  return `inbox:${row.chat_id}:join:${row.native_request_id}`;
}

async function finish(row: NativeChallenge, api: Api | null, decision: Decision, state: State): Promise<State> {
  // A process can stop after Telegram accepts the decision. Never repeat an interrupted decision.
  await query("UPDATE join_challenges SET state='approving',native_query=NULL,expires_at=now()+interval '30 seconds' WHERE token=$1", [row.token]);
  let outcome = state;
  try {
    if (!api || !row.native_query) throw new Error('Unavailable');
    await answerNativeJoin(api, row.native_query, decision);
  } catch (error) {
    outcome = decision === 'queue' || !api || error instanceof GrammyError ? 'manual_review' : 'native_uncertain';
  }
  await withTransaction(async client => {
    await client.query("UPDATE join_challenges SET state=$2 WHERE token=$1 AND state='approving'", [row.token, outcome]);
    if (outcome === 'approved' || outcome === 'declined' || outcome === 'native_uncertain') {
      await client.query(`UPDATE pending_joins SET state=$2,resolved_at=CASE WHEN $2='uncertain' THEN NULL ELSE now() END
        WHERE request_id=$1 AND state='pending'`, [row.native_request_id, outcome === 'native_uncertain' ? 'uncertain' : outcome]);
    }
  });
  return outcome;
}

export async function resolveNativeJoin(
  row: NativeChallenge, bot: NonNullable<Awaited<ReturnType<typeof nativeJoinBot>>> | null, answer: string | null,
) {
  return withSessionLock(lockFor(row), async () => {
    const current = await one<NativeChallenge>(`SELECT j.* FROM join_challenges j JOIN pending_joins p
      ON p.request_id=j.native_request_id WHERE j.token=$1 AND p.state='pending'`, [row.token]);
    if (!current || current.state !== 'pending') {
      const saved = await one<{state:State}>('SELECT state FROM join_challenges WHERE token=$1', [row.token]);
      return { state: saved?.state === 'pending' ? 'manual_review' : saved?.state ?? 'manual_review' };
    }
    const api = bot?.api ?? null;
    const chat = await getChat(row.chat_id);
    if (!chat?.active || !bot?.active || (bot.ownerId !== undefined && !hasFeature(chat, 'branding', bot.ownerId)) || !await nativeSettings(chat)) {
      return { state: await finish(current, api, 'queue', 'manual_review') };
    }
    if (current.expires_at.getTime() <= Date.now()) return { state: await finish(current, api, 'queue', 'expired') };
    if (answer === null) return { state: await finish(current, api, 'queue', 'manual_review') };
    if (answer !== current.answer) {
      const attemptsLeft = 2 - current.attempts;
      if (!attemptsLeft) return { state: await finish(current, api, 'queue', 'failed') };
      await query('UPDATE join_challenges SET attempts=attempts+1 WHERE token=$1', [row.token]);
      return { state: 'wrong' as const, attemptsLeft };
    }
    const banned = (await globalBan(row.user_id)).banned;
    return { state: await finish(current, api, banned ? 'decline' : 'approve', banned ? 'declined' : 'approved') };
  });
}

export async function expireNativeJoins(primary: {api:Api;id:number}): Promise<void> {
  await query(`WITH interrupted AS (
    UPDATE join_challenges SET state='native_uncertain' WHERE state='approving' AND native_request_id IS NOT NULL AND expires_at<now() RETURNING native_request_id
  ) UPDATE pending_joins SET state='uncertain' WHERE state='pending' AND request_id IN (SELECT native_request_id FROM interrupted)`);
  const expired = await many<NativeChallenge>("SELECT * FROM join_challenges WHERE state='pending' AND native_query IS NOT NULL AND expires_at<now() ORDER BY expires_at LIMIT 25");
  for (const row of expired) {
    try { await resolveNativeJoin(row, await nativeJoinBot(row, primary), null); }
    catch { logger.warn({ chatId: row.chat_id }, 'No se pudo cerrar un portal de ingreso vencido'); }
  }
}
