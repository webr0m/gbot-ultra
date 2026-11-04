import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Bot } from 'grammy';
import { z } from 'zod';
import type { AppContext } from '../../bot/context.js';
import { findNativeChallenge, nativeJoinBot, resolveNativeJoin } from '../../services/native-join.js';
import { verifyInitData } from '../auth.js';
import { ApiError } from '../helpers.js';

const responseSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify'), answer: z.string().trim().min(1).max(8) }),
  z.object({ action: z.literal('review') }),
]);

export function registerNativeJoinRoutes(app: FastifyInstance, primary: Bot<AppContext>): void {
  async function session(request: FastifyRequest) {
    const header = request.headers['x-telegram-init-data'];
    const unauthorized = () => new ApiError(401, 'Abre la verificación desde tu solicitud de ingreso en Telegram.');
    if (typeof header !== 'string' || !header || header.length > 16384) throw unauthorized();
    const id = new URLSearchParams(header).get('chat_join_request_query_id');
    if (!id || id.length > 1024) throw unauthorized();
    const row = await findNativeChallenge(id);
    if (!row) throw unauthorized();
    const bot = await nativeJoinBot(row, { api: primary.api, id: primary.botInfo.id });
    const auth = bot && verifyInitData(header, bot.token);
    const age = auth ? Math.floor(Date.now() / 1000) - auth.authDate : Infinity;
    if (!auth || auth.joinRequestQueryId !== id || auth.chatId !== row.chat_id || auth.user.id !== row.user_id ||
        auth.user.is_bot || age < -30 || age > 300) throw unauthorized();
    return { row, bot };
  }

  app.get('/api/native-join', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { row } = await session(request);
    const state = row.state === 'pending' && row.expires_at.getTime() <= Date.now() ? 'expired' : row.state;
    return { state, prompt: state === 'pending' ? row.native_prompt : '' };
  });

  app.post('/api/native-join', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { row, bot } = await session(request);
    const input = responseSchema.parse(request.body);
    return resolveNativeJoin(row, bot, input.action === 'verify' ? input.answer : null);
  });
}
