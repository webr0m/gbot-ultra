import type {FastifyInstance} from 'fastify';
import type {Bot} from 'grammy';
import {z} from 'zod';
import type {AppContext} from '../../bot/context.js';
import {config} from '../../config.js';
import {getActiveChats,getAdminChatsForUser} from '../../db/repositories/chats.js';
import {hasFeature} from '../../services/entitlements.js';
import {runtimeForChat} from '../../services/branded-bots.js';
import {setupDiagnostics,setupPreview,applySetup} from '../../services/setup-wizard.js';
import {listInbox,resolveInbox,INBOX_KINDS} from '../../services/inbox.js';
import {ApiError,requireAuth,requireChat,parseChatId,parseIntParam,bodyOf} from '../helpers.js';
import {mapConcurrent} from '../../utils/concurrency.js';

export function registerWorkspaceRoutes(app:FastifyInstance,primary:Bot<AppContext>){
 const effective=async(chatId:number)=>{const runtime=await runtimeForChat(chatId);return runtime?{api:runtime.bot.api,botId:runtime.bot.botInfo.id}:{api:primary.api,botId:primary.botInfo.id};};
 async function access(request:Parameters<typeof requireAuth>[0],chatId:number){
  const auth=requireAuth(request),runtime=await effective(chatId),chat=await requireChat(runtime.api,chatId,auth);return {auth,chat,...runtime};
 }
 app.get('/api/workspace/setup',async request=>{
  const {auth,chat,api,botId}=await access(request,parseChatId((request.query as Record<string,unknown>).chat_id));
  return {ok:true,...await setupDiagnostics(api,botId,chat,auth.user.id)};
 });
 app.post('/api/workspace/setup',async request=>{
  const b=bodyOf(request),{auth,chat,api,botId}=await access(request,parseChatId(b.chatId));
  if(b.action==='preview')return {ok:true,...await setupPreview(chat,auth.user.id,z.enum(['balanced','community','strict']).parse(b.profile))};
  if(b.action!=='apply'||b.confirm!==true)throw new ApiError(400,'Revisa los cambios y confirma antes de aplicar.');
  return applySetup(api,botId,chat,auth.user.id,z.string().max(2000).parse(b.token));
 });
 app.get('/api/workspace/inbox',async(request,reply)=>{
  const q=request.query as Record<string,unknown>,{auth,chat}=await access(request,parseChatId(q.chat_id));
  if(!hasFeature(chat,'inbox',auth.user.id))throw new ApiError(402,'La bandeja unificada requiere Pro o Ultra.');
  const scope=z.enum(['group','all']).parse(q.scope??'group'),state=z.enum(['open','resolved','uncertain','processing','all']).parse(q.state??'open'),kind=z.enum(['all',...INBOX_KINDS]).parse(q.kind??'all');
  let chats=[chat];
  if(scope==='all'){
   if(!hasFeature(chat,'inboxGroups',auth.user.id))throw new ApiError(402,'La vista de varios grupos requiere Ultra.');
   const candidates=config.ownerIds.has(auth.user.id)?await getActiveChats():await getAdminChatsForUser(auth.user.id);
   const checked=await mapConcurrent(candidates.filter(c=>hasFeature(c,'inboxGroups',auth.user.id)),4,async candidate=>{
    try{const runtime=await effective(candidate.chat_id);const actual=await requireChat(runtime.api,candidate.chat_id,auth);return hasFeature(actual,'inboxGroups',auth.user.id)?actual:null;}catch{return null;}
   });chats=checked.filter((c):c is NonNullable<typeof c>=>Boolean(c));
  }
  reply.header('Cache-Control','no-store');
  const page=await listInbox(chats.map(c=>c.chat_id),state,kind,parseIntParam(q.offset,0,0,1000000),parseIntParam(q.limit,30,1,100));
  return {ok:true,...page,scope,groups:chats.length,multiAllowed:hasFeature(chat,'inboxGroups',auth.user.id)};
 });
 app.post('/api/workspace/inbox',async request=>{
  const b=bodyOf(request),{auth,chat,api,botId}=await access(request,parseChatId(b.chatId));
  const input=z.object({kind:z.enum(INBOX_KINDS),ref:z.string().min(1).max(300),revision:z.string().regex(/^[a-f0-9]{32}$/),version:z.number().int().min(0),action:z.enum(['acknowledge','dismiss','approve','decline'])}).parse(b);
  return resolveInbox(api,botId,chat,auth.user.id,input);
 });
}
