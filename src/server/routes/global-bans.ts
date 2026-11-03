import type { FastifyInstance } from 'fastify';
import type { Bot } from 'grammy';
import { z } from 'zod';
import type { AppContext } from '../../bot/context.js';
import { assertDeveloper } from '../../services/roles.js';
import { requireAuth, requireChat, parseChatId, bodyOf } from '../helpers.js';
import { addGban,removeGban,listGbans } from '../../db/repositories/filters.js';
import { globalBan,invalidateGlobalBan } from '../../services/global-bans.js';
import { casHealth,setCasException } from '../../services/cas.js';
import { many } from '../../db/pool.js';
export function registerGlobalBanRoutes(app:FastifyInstance,bot:Bot<AppContext>):void{
 app.get('/api/globalban/check',async request=>{
  const auth=requireAuth(request),q=request.query as Record<string,unknown>;await requireChat(bot.api,parseChatId(q.chat_id),auth);
  const userId=z.coerce.number().int().safe().positive().parse(q.user_id);return {ok:true,verdict:await globalBan(userId),cas:casHealth()};
 });
 app.get('/api/globalban',async request=>{
  const auth=requireAuth(request);assertDeveloper(auth.user.id);
  return {ok:true,bans:await listGbans(500),exceptions:await many('SELECT user_id,reason,created_at FROM cas_exceptions ORDER BY created_at DESC LIMIT 500'),cas:casHealth()};
 });
 app.post('/api/globalban',async request=>{
  const auth=requireAuth(request);assertDeveloper(auth.user.id);const b=z.object({userId:z.number().int().safe().positive(),action:z.enum(['ban','unban','cas-allow','cas-remove']),reason:z.string().min(3).max(500).default('Gestión administrativa')}).parse(bodyOf(request));
  if(b.action==='ban')await addGban(b.userId,b.reason,auth.user.id);
  if(b.action==='unban')await removeGban(b.userId,auth.user.id);
  if(b.action==='cas-allow')await setCasException(b.userId,auth.user.id,b.reason);
  if(b.action==='cas-remove')await setCasException(b.userId,auth.user.id,null);
  invalidateGlobalBan(b.userId);return {ok:true};
 });
}
