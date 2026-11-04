import {contentExample} from '../../services/message-content.js';
import type { FastifyInstance } from 'fastify';
import type { Bot } from 'grammy';
import { z } from 'zod';
import { config } from '../../config.js';
import type { AppContext } from '../../bot/context.js';
import type { ChatRow } from '../../db/types.js';
import { many, one, query } from '../../db/pool.js';
import { requireAuth, requireChat, bodyOf, parseChatId, ApiError } from '../helpers.js';
import { advancedConfig, advancedSchema, saveAdvanced, invalidateAdvanced, TRUST_SCOPES, CONTENT_TYPES, FORWARD_ORIGINS, ADVANCED_DEFAULTS, type AdvancedSettings } from '../../services/advanced-config.js';
import { ADVANCED_FEATURES, TIER_CATALOG, chatTier, hasFeature, type AdvancedFeature } from '../../services/entitlements.js';
import { assertActorRight, muteReactions, removeReactions } from '../../services/moderation.js';
import { apiIdentityForChat } from '../../services/branded-bots.js';
import { createGroupInvite, listGroupInvites, revokeGroupInvite } from '../../services/group-invites.js';
import { applyBulkModeration, bulkInputSchema, previewBulkModeration } from '../../services/bulk-moderation.js';
import { DELEGATE_SCOPES, listDelegates, manageDelegate } from '../../services/delegated-roles.js';
import { settingsOf } from '../../services/chat-cache.js';
import { settingsPatchSchema } from '../../services/settings.js';
import { getChatMemberSafe } from '../../utils/telegram.js';
import { advancedDataCache, contentMatch, contentRule } from '../../services/advanced-engine.js';
import { onceOperation } from '../../services/operations.js';
import { logModeration } from '../../db/repositories/moderation.js';
import { allianceOverview, linkedAlliance, createAlliance, joinAlliance, leaveAlliance, proposeCase, reviewCase, rotateAllianceInvite, publishAllianceProfile, adoptAllianceProfile } from '../../services/alliances.js';
import { antispamHits } from '../../services/antispam.js';
import { listBlacklist } from '../../db/repositories/filters.js';
import { casHealth } from '../../services/cas.js';
import { DEVELOPER_ID } from '../../services/roles.js';
const id=z.number().int().safe().positive();
const https=z.string().url().max(1000).refine(s=>new URL(s).protocol==='https:','Usa un enlace HTTPS');
const resourceName=z.string().regex(/^[a-z0-9_]{1,32}$/);
const trustSchema=z.object({userId:id,scopes:z.array(z.enum(TRUST_SCOPES)).min(1).max(6),reason:z.string().max(300),days:z.number().int().min(0).max(365)});
const responseSchema=z.object({trigger:z.string().trim().min(1).max(100),mode:z.enum(['word','exact','prefix']),content:z.string().min(1).max(2000),buttonLabel:z.string().max(50).default(''),buttonUrl:z.union([https,z.literal('')]).default(''),cooldownSeconds:z.number().int().min(10).max(86400)}).refine(v=>v.mode!=='word'||!/[\s\p{P}]/u.test(v.trigger),'La coincidencia por palabra admite una sola palabra sin puntuación').refine(v=>Boolean(v.buttonLabel)===Boolean(v.buttonUrl),'Completa el texto y enlace del botón');
const richSchema=z.object({name:resourceName,content:z.string().max(1024),privateDelivery:z.boolean(),buttonLabel:z.string().max(50).default(''),buttonUrl:z.union([https,z.literal('')]).default('')}).refine(v=>Boolean(v.buttonLabel)===Boolean(v.buttonUrl),'Completa el texto y enlace del botón');
const transferSchema=z.object({format:z.literal('gbot-settings'),version:z.literal(1),advanced:advancedSchema,base:settingsPatchSchema.optional()}).strict();
export function settingsDiff(before:AdvancedSettings,after:AdvancedSettings){return Object.keys(after).filter(k=>JSON.stringify(before[k as keyof AdvancedSettings])!==JSON.stringify(after[k as keyof AdvancedSettings])).map(key=>({key,before:before[key as keyof AdvancedSettings],after:after[key as keyof AdvancedSettings]}));}
export function registerAdvancedRoutes(app:FastifyInstance,bot:Bot<AppContext>):void{
 async function access(request:Parameters<typeof requireAuth>[0],chatId:number,feature?:AdvancedFeature,right='can_change_info'){
  const auth=requireAuth(request);const chat=await requireChat(bot.api,chatId,auth);
  if(feature&&!hasFeature(chat,feature,auth.user.id))throw new ApiError(402,ADVANCED_FEATURES[feature].label+' requiere '+ADVANCED_FEATURES[feature].tier+'.');
  const ctx={api:bot.api,chatId,chat,settings:settingsOf(chat),botId:bot.botInfo.id,actorId:auth.user.id,actorName:auth.user.first_name,source:'miniapp' as const};
  if(request.method!=='GET')await assertActorRight(ctx,right);
  return {auth,chat,ctx};
 }
 app.get('/api/advanced',async request=>{
  const q=request.query as Record<string,unknown>;const chatId=parseChatId(q.chat_id);const {auth,chat}=await access(request,chatId);
  const record=await advancedConfig(chatId);
  const [trust,responses,notes,history,raid,alliance,operations]=await Promise.all([
   many('SELECT * FROM trusted_users WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 200',[chatId]),
   many('SELECT * FROM auto_responses WHERE chat_id=$1 ORDER BY id LIMIT 100',[chatId]),
   many('SELECT name,content,media_type,private_delivery,buttons FROM rich_notes WHERE chat_id=$1 ORDER BY name LIMIT 200',[chatId]),
   many('SELECT version,actor_id,created_at FROM advanced_history WHERE chat_id=$1 ORDER BY version DESC LIMIT 30',[chatId]),
   one('SELECT until_at FROM raid_state WHERE chat_id=$1 AND until_at>now()',[chatId]),
   hasFeature(chat,'alliances',auth.user.id)?allianceOverview(chatId,auth.user.id):(async()=>{const a=await linkedAlliance(chatId);return a?{id:a.id,name:a.name,inactive:true}:null;})(),
   many("SELECT key,state,created_at FROM operation_receipts WHERE state<>'done' AND key LIKE $1 UNION ALL SELECT 'update:'||update_id::text AS key,state,created_at FROM update_receipts WHERE state<>'done' AND chat_id=$2 ORDER BY created_at DESC LIMIT 30",['%:'+chatId+':%',chatId]),
  ]);
  return {ok:true,...record,developer:auth.user.id===DEVELOPER_ID,cas:casHealth(),tier:chatTier(chat,auth.user.id),tiers:TIER_CATALOG,features:Object.entries(ADVANCED_FEATURES).map(([key,f])=>({key,...f,allowed:hasFeature(chat,key as AdvancedFeature,auth.user.id)})),trust,responses,notes,history,raid,alliance,operations};
 });
 app.patch('/api/advanced',async request=>{
  const b=bodyOf(request);const {auth,chat,ctx}=await access(request,parseChatId(b.chatId));
  const parsed=z.object({settings:advancedSchema,version:z.number().int().min(0)}).parse(b);
  const current=await advancedConfig(chat.chat_id);
  if(parsed.settings.silent.enabled){
    const logId=settingsOf(chat).logs.chatId;if(!logId)throw new ApiError(400,'Configura un destino de registros.');
    const destination=await bot.api.getChat(logId).catch(()=>null);const member=await getChatMemberSafe(bot.api,logId,bot.botInfo.id);
    if(!destination||!member||!(member.status==='creator'||member.status==='administrator'&&(destination.type!=='channel'||member.can_post_messages)))throw new ApiError(400,'El bot necesita acceso de administrador para publicar en el destino de registros.');
  }
  const changed = settingsDiff(current.settings, parsed.settings).map(diff=>diff.key);
  if(['raid','locks','warningExpiry','night','probation','forwarding','textLimits'].some(key=>changed.includes(key)))await assertActorRight(ctx,'can_restrict_members');
  if(['forwarding','textLimits'].some(key=>changed.includes(key)))await assertActorRight(ctx,'can_delete_messages');
  return {ok:true,...await saveAdvanced(chat,parsed.settings,auth.user.id,parsed.version)};
 });
 app.post('/api/advanced/trust',async request=>{
  const b=bodyOf(request);const {chat,auth}=await access(request,parseChatId(b.chatId),'trust','can_restrict_members');const v=trustSchema.parse(b);
  await query('INSERT INTO trusted_users(chat_id,user_id,scopes,reason,actor_id,expires_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $6>0 THEN now()+make_interval(days=>$6) ELSE NULL END) ON CONFLICT(chat_id,user_id) DO UPDATE SET scopes=EXCLUDED.scopes,reason=EXCLUDED.reason,actor_id=EXCLUDED.actor_id,expires_at=EXCLUDED.expires_at',[chat.chat_id,v.userId,v.scopes,v.reason,auth.user.id,v.days]);
  invalidateAdvanced(chat.chat_id);await logModeration({chatId:chat.chat_id,actorId:auth.user.id,targetId:v.userId,action:'trust',reason:v.reason,metadata:{scopes:v.scopes}});return {ok:true};
 });
 app.post('/api/advanced/response',async request=>{
  const b=bodyOf(request);const {chat}=await access(request,parseChatId(b.chatId),'filters');const v=responseSchema.parse(b);
  const count=await one('SELECT COUNT(*)::int AS n FROM auto_responses WHERE chat_id=$1',[chat.chat_id]);if(count!.n>=100&&!await one('SELECT 1 FROM auto_responses WHERE chat_id=$1 AND trigger=$2',[chat.chat_id,v.trigger]))throw new ApiError(400,'Máximo 100 respuestas.');
  await query('INSERT INTO auto_responses(chat_id,trigger,mode,content,button_label,button_url,cooldown_seconds) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(chat_id,trigger) DO UPDATE SET mode=EXCLUDED.mode,content=EXCLUDED.content,button_label=EXCLUDED.button_label,button_url=EXCLUDED.button_url,cooldown_seconds=EXCLUDED.cooldown_seconds',[chat.chat_id,v.trigger,v.mode,v.content,v.buttonLabel||null,v.buttonUrl||null,v.cooldownSeconds]);advancedDataCache.invalidate(String(chat.chat_id));return {ok:true};
 });
 app.post('/api/advanced/note',async request=>{
  const b=bodyOf(request);const {chat,auth}=await access(request,parseChatId(b.chatId),'richNotes');const v=richSchema.parse(b);
  const count=await one('SELECT COUNT(*)::int AS n FROM rich_notes WHERE chat_id=$1',[chat.chat_id]);if(count!.n>=100&&!await one('SELECT 1 FROM rich_notes WHERE chat_id=$1 AND name=$2',[chat.chat_id,v.name]))throw new ApiError(400,'Máximo 100 notas enriquecidas.');
  const buttons=v.buttonUrl?[{label:v.buttonLabel,url:v.buttonUrl}]:[];
  // Keep any media captured from Telegram; the panel never asks visitors for file IDs.
  await query('INSERT INTO rich_notes(chat_id,name,content,private_delivery,buttons,actor_id) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(chat_id,name) DO UPDATE SET content=EXCLUDED.content,private_delivery=EXCLUDED.private_delivery,buttons=EXCLUDED.buttons,actor_id=EXCLUDED.actor_id',[chat.chat_id,v.name,v.content,v.privateDelivery,JSON.stringify(buttons),auth.user.id]);advancedDataCache.invalidate(String(chat.chat_id));return {ok:true};
 });
 app.post('/api/advanced/remove',async request=>{
  const b=bodyOf(request);const kind=z.enum(['trust','response','note']).parse(b.kind);const {chat,auth}=await access(request,parseChatId(b.chatId),kind==='trust'?'trust':kind==='response'?'filters':'richNotes',kind==='trust'?'can_restrict_members':'can_change_info');
  const key=kind==='note'?resourceName.parse(b.key):id.parse(Number(b.key));
  const tables={trust:['trusted_users','user_id'],response:['auto_responses','id'],note:['rich_notes','name']} as const;const [table,column]=tables[kind];
  await query(`DELETE FROM ${table} WHERE chat_id=$1 AND ${column}=$2`,[chat.chat_id,key]);invalidateAdvanced(chat.chat_id);advancedDataCache.invalidate(String(chat.chat_id));await logModeration({chatId:chat.chat_id,actorId:auth.user.id,action:'advanced_remove',reason:kind+':'+key});return {ok:true};
 });
 app.post('/api/advanced/raid',async request=>{
  const b=bodyOf(request);const {chat,auth}=await access(request,parseChatId(b.chatId),'raid','can_restrict_members');const seconds=z.number().int().min(0).max(86400).parse(b.seconds);
  if(seconds)await query('INSERT INTO raid_state(chat_id,until_at) VALUES($1,now()+make_interval(secs=>$2)) ON CONFLICT(chat_id) DO UPDATE SET until_at=EXCLUDED.until_at',[chat.chat_id,seconds]);else await query('DELETE FROM raid_state WHERE chat_id=$1',[chat.chat_id]);
  await logModeration({chatId:chat.chat_id,actorId:auth.user.id,action:seconds?'raid_on':'raid_off',reason:'Control manual',durationSeconds:seconds});return {ok:true};
 });
 app.get('/api/advanced/export',async request=>{
  const q=request.query as Record<string,unknown>;const {chat}=await access(request,parseChatId(q.chat_id),'transfer');const record=await advancedConfig(chat.chat_id);
  const advanced=structuredClone(record.settings);advanced.topics={welcomeThreadId:0,logThreadId:0};advanced.silent.enabled=false;advanced.observation.enabled=false;advanced.richArticles=ADVANCED_DEFAULTS.richArticles;
  return {format:'gbot-settings',version:1,advanced};
 });
 app.post('/api/advanced/transfer',async request=>{
  const b=bodyOf(request);const {chat,auth,ctx}=await access(request,parseChatId(b.chatId),'transfer');await assertActorRight(ctx,'can_restrict_members');
  const mode=z.enum(['preview','apply','restore-preview','restore']).parse(b.mode);const current=await advancedConfig(chat.chat_id);let target:AdvancedSettings;
  if(mode.startsWith('restore')){const version=z.number().int().min(0).parse(b.targetVersion);const row=await one('SELECT settings FROM advanced_history WHERE chat_id=$1 AND version=$2',[chat.chat_id,version]);if(!row)throw new ApiError(404,'Versión no encontrada.');target=advancedSchema.parse(row.settings);}
  else {const file=transferSchema.parse(b.file);const sections=z.array(z.enum(['raid','locks','warningExpiry','night','filters','silent','joinGate','richNotes','observation','probation','forwarding','textLimits','discussion'])).min(1).max(13).parse(b.sections);target=structuredClone(current.settings);for(const key of sections)(target as Record<string,unknown>)[key]=file.advanced[key];}
  for(const key of Object.keys(target) as (keyof AdvancedSettings)[])if(JSON.stringify(target[key])!==JSON.stringify(current.settings[key])&&!hasFeature(chat,key,auth.user.id))throw new ApiError(402,'Tu nivel no incluye '+ADVANCED_FEATURES[key].label+'.');
  if(mode==='preview'||mode==='restore-preview')return {ok:true,diff:settingsDiff(current.settings,target),version:current.version,target};
  const version=z.number().int().min(0).parse(b.version);return {ok:true,...await saveAdvanced(chat,target,auth.user.id,version)};
 });
 app.post('/api/advanced/simulate',async request=>{
  const b=bodyOf(request);const {chat}=await access(request,parseChatId(b.chatId),'observation');const v=z.object({text:z.string().max(4000),type:z.enum(['text',...CONTENT_TYPES]),origin:z.enum(FORWARD_ORIGINS).optional(),messageCount:z.number().int().min(1).max(100).default(1)}).parse(b);
  const a=(await advancedConfig(chat.chat_id)).settings;const message=contentExample(v.text,v.type,v.origin) as any;
  const matches:{rule:string;action:string}[]=[];const content=contentMatch(message,a);if(content)matches.push({rule:'Contenido: '+content,action:contentRule(a,content).action});
  const base=settingsOf(chat);const rows=base.blacklist.enabled?await listBlacklist(chat.chat_id):[];
  const labels={blacklist:'Lista negra',antilink:'Antienlaces',antiflood:'Antiflood dentro de '+base.antiflood.windowSeconds+' segundos'};
  for(const hit of antispamHits(message,base,rows,v.messageCount))matches.push({rule:labels[hit.rule],action:hit.action});
  return {ok:true,matches,selected:matches[0]??null,notice:'Simulación de un miembro normal sin excepciones. No ejecuta acciones ni modifica contadores.'};
 });
 app.post('/api/advanced/reactions',async request=>{
  const b=bodyOf(request);
  const v=z.discriminatedUnion('action',[
   z.object({action:z.literal('mute'),userId:id,minutes:z.number().int().min(1).max(43200)}),
   z.object({action:z.literal('remove'),userId:id,messageId:id}),
   z.object({action:z.literal('clear'),userId:id}),
  ]).parse(b);
  const {ctx}=await access(request,parseChatId(b.chatId),'reactions',v.action==='mute'?'can_restrict_members':'can_delete_messages');
  const identity=await apiIdentityForChat(ctx.chatId,ctx.api,ctx.botId);
  const target={userId:v.userId,name:String(v.userId)};
  if(v.action==='mute')await muteReactions({...ctx,...identity},target,v.minutes*60);
  else await removeReactions({...ctx,...identity},target,v.action==='remove'?v.messageId:undefined);
  return {ok:true};
 });
 app.post('/api/advanced/invites',async (request,reply)=>{
  reply.header('Cache-Control','no-store');
  const b=bodyOf(request);
  const v=z.discriminatedUnion('action',[
   z.object({action:z.literal('list')}),
   z.object({action:z.literal('create'),name:z.string().trim().min(1).max(32),hours:z.number().int().min(1).max(168),memberLimit:z.number().int().min(1).max(99999),operationId:z.string().uuid()}),
   z.object({action:z.literal('revoke'),inviteId:z.string().uuid()}),
  ]).parse(b);
  const {ctx}=await access(request,parseChatId(b.chatId),v.action==='create'?'temporaryInvites':undefined,'can_invite_users');
  if(v.action==='list')return {ok:true,invites:await listGroupInvites(ctx.chatId)};
  const identity=await apiIdentityForChat(ctx.chatId,ctx.api,ctx.botId);
  if(v.action==='create')await createGroupInvite({...ctx,...identity},v);
  else await revokeGroupInvite({...ctx,...identity},v.inviteId);
  return {ok:true,invites:await listGroupInvites(ctx.chatId)};
 });
 app.post('/api/advanced/bulk',async request=>{
  const b=bodyOf(request);
  const v=z.discriminatedUnion('action',[
   z.object({action:z.literal('preview'),input:bulkInputSchema}),
   z.object({action:z.literal('apply'),token:z.string().max(4000)}),
  ]).parse(b);
  const {ctx}=await access(request,parseChatId(b.chatId),'bulkModeration','can_restrict_members');
  const identity=await apiIdentityForChat(ctx.chatId,ctx.api,ctx.botId);
  if(v.action==='preview')return {ok:true,...await previewBulkModeration({...ctx,...identity},v.input)};
  return {ok:true,...await applyBulkModeration({...ctx,...identity},v.token)};
 });
 app.post('/api/advanced/delegates',async request=>{
  const b=bodyOf(request);
  const v=z.discriminatedUnion('action',[
   z.object({action:z.literal('grant'),userId:id,hours:z.number().int().min(1).max(168),scopes:z.array(z.enum(DELEGATE_SCOPES)).min(1).max(2)}),
   z.object({action:z.literal('revoke'),userId:id}),
  ]).parse(b);
  const {ctx}=await access(request,parseChatId(b.chatId),v.action==='grant'?'delegatedRoles':undefined);
  const identity=await apiIdentityForChat(ctx.chatId,ctx.api,ctx.botId);
  await manageDelegate({...ctx,...identity},v.userId,v.action==='grant'?v:undefined);
  return {ok:true,roles:await listDelegates(ctx.chatId)};
 });
 app.get('/api/advanced/delegates',async request=>{
  const q=request.query as Record<string,unknown>;const {ctx}=await access(request,parseChatId(q.chat_id));
  return {ok:true,roles:await listDelegates(ctx.chatId)};
 });
 app.post('/api/advanced/topic',async request=>{
  const b=bodyOf(request);const {chat,auth}=await access(request,parseChatId(b.chatId),'topics','can_manage_topics');const v=z.object({action:z.enum(['create','rename','close','reopen']),threadId:z.number().int().positive().optional(),name:z.string().min(1).max(128).optional(),operationId:z.string().uuid()}).parse(b);
  if(v.action!=='create'&&!v.threadId)throw new ApiError(400,'Selecciona el tema.');if(['create','rename'].includes(v.action)&&!v.name)throw new ApiError(400,'Escribe el nombre.');
  return onceOperation(`topic:${chat.chat_id}:${auth.user.id}:${v.operationId}`,async()=>{let topic;
   if(v.action==='create')topic=await bot.api.createForumTopic(chat.chat_id,v.name!);else if(v.action==='rename')await bot.api.editForumTopic(chat.chat_id,v.threadId!,{name:v.name!});else if(v.action==='close')await bot.api.closeForumTopic(chat.chat_id,v.threadId!);else await bot.api.reopenForumTopic(chat.chat_id,v.threadId!);
   await logModeration({chatId:chat.chat_id,actorId:auth.user.id,action:'topic_'+v.action,reason:v.name??String(v.threadId)});return {ok:true,topic};});
 });
 app.post('/api/advanced/alliance',async request=>{
  const b=bodyOf(request);const action=z.enum(['create','join','leave','rotate','propose','review','publish','adopt','preview']).parse(b.action);const {chat,auth,ctx}=await access(request,parseChatId(b.chatId),action==='leave'?undefined:'alliances');
  if(['create','join','leave'].includes(action)&&!config.ownerIds.has(auth.user.id)){const member=await getChatMemberSafe(bot.api,chat.chat_id,auth.user.id);if(member?.status!=='creator')throw new ApiError(403,'Solo el creador del grupo puede vincularlo o retirarlo de una Alianza.');}
  if(action==='create')await createAlliance(chat.chat_id,auth.user.id,z.string().min(3).max(80).parse(b.name));
  if(action==='join')await joinAlliance(chat.chat_id,auth.user.id,z.string().regex(/^[a-f0-9]{36}$/).parse(b.code));
  if(action==='leave')await leaveAlliance(chat.chat_id,auth.user.id);
  if(action==='rotate')await rotateAllianceInvite(chat.chat_id,auth.user.id);
  if(action==='propose'){await assertActorRight(ctx,'can_restrict_members');await proposeCase(chat.chat_id,auth.user.id,id.parse(b.userId),z.string().min(5).max(500).parse(b.reason),z.number().int().min(60).max(2592000).parse(b.seconds));}
  if(action==='review')await reviewCase(bot.api,bot.botInfo.id,chat,auth.user.id,id.parse(b.caseId),z.enum(['apply','skip','undo']).parse(b.decision));
  if(action==='publish')await publishAllianceProfile(chat.chat_id,auth.user.id);
  if(action==='preview'){const a=await allianceOverview(chat.chat_id,auth.user.id);if(!a?.profile)throw new ApiError(404,'No hay perfil.');const current=await advancedConfig(chat.chat_id);const target={...a.profile,topics:current.settings.topics,silent:current.settings.silent,observation:current.settings.observation,richArticles:current.settings.richArticles,discussion:current.settings.discussion};return {ok:true,diff:settingsDiff(current.settings,target),version:current.version,profileVersion:a.profileVersion};}
  if(action==='adopt'){await assertActorRight(ctx,'can_restrict_members');await adoptAllianceProfile(chat,auth.user.id,z.number().int().min(0).parse(b.version),z.number().int().positive().parse(b.profileVersion));}
  return {ok:true,alliance:await allianceOverview(chat.chat_id,auth.user.id)};
 });
}
