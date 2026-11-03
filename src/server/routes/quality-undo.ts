import type {FastifyInstance} from 'fastify';
import type {Bot} from 'grammy';
import {z} from 'zod';
import type {AppContext} from '../../bot/context.js';
import {runtimeForChat} from '../../services/branded-bots.js';
import {hasFeature} from '../../services/entitlements.js';
import {withFreshTelegramReads} from '../../services/telegram-cache.js';
import {settingsOf} from '../../services/chat-cache.js';
import {ruleQuality,reviewRule} from '../../services/rule-quality.js';
import {listSanctions,previewUndo,applyUndo} from '../../services/sanction-journal.js';
import {ApiError,requireAuth,requireChat,parseChatId,parseIntParam,bodyOf} from '../helpers.js';

export function registerQualityUndoRoutes(app:FastifyInstance,primary:Bot<AppContext>){
 async function access(request:Parameters<typeof requireAuth>[0],chatId:number,feature:'ruleQuality'|'undoSanctions'){
  const auth=requireAuth(request),runtime=await runtimeForChat(chatId),bot=runtime?.bot??primary;
  const chat=await requireChat(bot.api,chatId,auth);
  if(!hasFeature(chat,feature,auth.user.id))throw new ApiError(402,feature==='ruleQuality'?'Calidad de reglas requiere Ultra.':'Deshacer sanciones requiere Pro o Ultra.');
  return {api:bot.api,botId:bot.botInfo.id,chatId,chat,settings:await settingsOf(chat),actorId:auth.user.id,actorName:auth.user.first_name,source:'miniapp' as const};
 }
 app.get('/api/review/quality',async(request,reply)=>{
  const q=request.query as Record<string,unknown>,ctx=await access(request,parseChatId(q.chat_id),'ruleQuality');reply.header('Cache-Control','no-store');
  return {ok:true,...await ruleQuality(ctx.chatId,z.coerce.number().pipe(z.union([z.literal(7),z.literal(14),z.literal(30)])).parse(q.days??14),parseIntParam(q.offset,0,0,1000000))};
 });
 app.post('/api/review/quality',async request=>withFreshTelegramReads(async()=>{
  const b=bodyOf(request),ctx=await access(request,parseChatId(b.chatId),'ruleQuality');
  const input=z.object({id:z.uuid(),version:z.number().int().min(0),verdict:z.enum(['correct','false_positive','unsure'])}).parse(b);
  return reviewRule(ctx.chatId,ctx.actorId,input.id,input.version,input.verdict);
 }));
 app.get('/api/review/sanctions',async(request,reply)=>{
  const q=request.query as Record<string,unknown>,ctx=await access(request,parseChatId(q.chat_id),'undoSanctions');reply.header('Cache-Control','no-store');
  return {ok:true,...await listSanctions(ctx.chatId,parseIntParam(q.offset,0,0,1000000))};
 });
 app.post('/api/review/sanctions',async request=>withFreshTelegramReads(async()=>{
  const b=bodyOf(request),ctx=await access(request,parseChatId(b.chatId),'undoSanctions');
  if(b.action==='preview')return {ok:true,...await previewUndo(ctx,z.uuid().parse(b.id))};
  if(b.action!=='apply'||b.confirm!==true)throw new ApiError(400,'Revisa la vista previa y confirma antes de deshacer.');
  return applyUndo(ctx,z.string().max(3000).parse(b.token));
 }));
}
