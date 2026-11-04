import {messageContent,isGuestMessage,moderationUser} from './message-content.js';
import { recordRuleEvent, ruleRevision } from "./rule-quality.js";
import { tr } from "./bot-i18n.js";
import { randomInt, randomBytes } from 'node:crypto';
import { InlineKeyboard, type Api } from 'grammy';
import type { Message, User, Chat, ChatJoinRequest } from 'grammy/types';
import { config } from '../config.js';
import { many, one, query, withTransaction } from '../db/pool.js';
import type { ChatRow, GroupSettings } from '../db/types.js';
import { advancedConfig, effectiveAdvanced, trustedScopes, type AdvancedSettings, type FORWARD_ORIGINS } from './advanced-config.js';
import { hasFeature } from './entitlements.js';
import { globalBan } from './global-bans.js';
import { ReadCache } from './read-cache.js';
import { logModeration } from '../db/repositories/moderation.js';
import { getChat } from '../db/repositories/chats.js';
import { settingsOf } from './chat-cache.js';
import { banUser, muteUser, warnUser, MUTED_PERMISSIONS, type ModerationContext } from './moderation.js';
import { sendCaptcha } from './captcha.js';
import { escapeHtml } from '../utils/format.js';
import { getChatMemberSafe, isAdminStatus } from '../utils/telegram.js';
import { onceOperation } from './operations.js';
import { logger } from '../logger.js';
import { expireNativeJoins } from './native-join.js';
import { primaryBot } from './bot-runtime.js';
export const advancedDataCache=new ReadCache(2000);
export async function runtimeAdvanced(chat:ChatRow):Promise<AdvancedSettings>{const c=await advancedConfig(chat.chat_id);return effectiveAdvanced(chat,c.settings,c.actorId);}
export async function scopeExemptions(chat:ChatRow,userId:number):Promise<string[]>{
 if(config.ownerIds.has(userId))return ['locks','raid','captcha','blacklist','antilink','antiflood'];
 const c=await advancedConfig(chat.chat_id);return hasFeature(chat,'trust',c.actorId)?trustedScopes(chat.chat_id,userId):[];
}
function matchesTextPattern(text:string,pattern:string):boolean{
 let offset=0;
 for(const part of pattern.trim().split('*').filter(Boolean)){
  const index=text.indexOf(part,offset);
  if(index===-1)return false;
  offset=index+part.length;
 }
 return true;
}
export function contentMatch(message:Partial<Message>,settings:AdvancedSettings,skipPatterns=false):string|null{
 const forward=message.forward_origin;
 const origin:typeof FORWARD_ORIGINS[number]|undefined=forward?.type==='user'?(forward.sender_user.is_bot?'bot':'person'):forward?.type;
 if(origin&&settings.forwarding.actions[origin])return 'forward:'+origin;
 const {patterns,maxLength}=settings.textLimits;
 if(!settings.locks.enabled&&!maxLength&&(!patterns||skipPatterns))return null;
 const content=messageContent(message);
 for(const type of settings.locks.enabled?settings.locks.types:[]){
  if(type==='invite'&&content.links.some(link=>/(?:t\.me|telegram\.me)\/(?:\+|joinchat\/|[a-zA-Z0-9_]+)/i.test(link)))return type;
  if(content.types.has(type))return type;
 }
 if(maxLength&&content.text.length>maxLength&&Array.from(content.text).length>maxLength)return 'text_length';
 if(patterns&&!skipPatterns){
  const normalize=(value:string)=>value.normalize('NFKC').toLowerCase();
  const text=normalize(content.text);
  if(normalize(patterns).split('\n').filter(line=>line.trim()).some(line=>line.split('&&').every(term=>matchesTextPattern(text,term))))return 'text_pattern';
 }
 return null;
}
export function contentRule(settings:AdvancedSettings,type:string){
 if(type.startsWith('forward:')){
  const origin=type.slice(8) as typeof FORWARD_ORIGINS[number];
  return {key:'forwarding',action:settings.forwarding.actions[origin]!,durationSeconds:settings.forwarding.durationSeconds} as const;
 }
 const key=type.startsWith('text_')?'textLimits':'locks';
 return {key,action:settings[key].action,durationSeconds:settings[key].durationSeconds} as const;
}
export function isNight(settings:AdvancedSettings['night'],now=new Date()):boolean{
 if(!settings.enabled)return false;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:settings.timezone,hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'}).formatToParts(now);
 const part=(k:string)=>parts.find(x=>x.type===k)?.value??'';
 const day=[tr("Sun"),tr("Mon"),tr("Tue"),tr("Wed"),tr("Thu"),tr("Fri"),tr("Sat")].indexOf(part('weekday'));
 const clock=part('hour')+':'+part('minute');
 if(settings.start<settings.end)return settings.days.includes(day)&&clock>=settings.start&&clock<settings.end;
 return (clock>=settings.start&&settings.days.includes(day))||(clock<settings.end&&settings.days.includes((day+6)%7));
}
export async function advancedMessage(api:Api,chat:ChatRow,base:GroupSettings,message:Message,user:User,botId:number):Promise<{handled:boolean;settings:GroupSettings;observe:boolean}>{
 const settings=structuredClone(base);const a=await runtimeAdvanced(chat);const scopes=await scopeExemptions(chat,user.id);
 for(const key of ['blacklist','antilink','antiflood'] as const)if(scopes.includes(key))settings[key].enabled=false;
 const type=scopes.includes('locks')?null:contentMatch(message,a,scopes.includes('blacklist'));
 if(!type)return {handled:false,settings,observe:a.observation.enabled};
 const rule=contentRule(a,type);
 const metric=(outcome:'applied'|'observation'|'error')=>recordRuleEvent(chat.chat_id,message.message_id,rule.key+':'+type,ruleRevision(a[rule.key]),rule.action,outcome);
 try{await onceOperation(`content:${chat.chat_id}:${message.message_id}:${message.edit_date??0}`,async()=>{
  if(a.observation.enabled){await metric('observation');await logModeration({chatId:chat.chat_id,targetId:user.id,action:'observation',reason:tr("Contenido: ")+type,metadata:{would:rule.action}});return null;}
  await api.deleteMessage(chat.chat_id,message.message_id);
  if(message.sender_chat||(isGuestMessage(message)&&!moderationUser(message))){await metric('applied');await logModeration({chatId:chat.chat_id,action:'delete_channel_post',reason:tr("Contenido: ")+type,metadata:{senderChatId:message.sender_chat?.id??message.guest_bot_caller_chat?.id,guest:isGuestMessage(message)}});return null;}
  const ctx:ModerationContext={api,chatId:chat.chat_id,chat,settings,botId,actorId:botId,actorName:'GBot',source:'bot',publicLogFallback:a.silent.enabled};
  const target={userId:user.id,name:user.first_name};const options={target,reason:tr("Contenido no permitido: ")+type,durationSeconds:rule.durationSeconds};
  if(rule.action==='warn')await warnUser(ctx,target,options.reason);
  else if(rule.action==='mute')await muteUser(ctx,options);
  else if(rule.action==='ban')await banUser(ctx,options);
  else {
   await logModeration({chatId:chat.chat_id,targetId:user.id,action:'delete',reason:options.reason});
   if(settings.logs.enabled&&settings.logs.chatId){try{await api.sendMessage(settings.logs.chatId,'🛡️ '+chat.title+' · '+options.reason,{message_thread_id:a.topics.logThreadId||undefined});}catch{if(a.silent.enabled)await api.sendMessage(chat.chat_id,tr("🛡️ Mensaje eliminado. No se pudo enviar el registro al destino configurado.")).catch(()=>undefined);}}
   else if(a.silent.enabled)await api.sendMessage(chat.chat_id,tr("🛡️ Mensaje eliminado. Revisa el destino de registros.")).catch(()=>undefined);
  }
  await metric('applied');
  // Always keep a database audit; quiet mode suppresses only public notices.
  if(!a.silent.enabled)await api.sendMessage(chat.chat_id,tr("🛡️ Contenido no permitido: ")+type+'.').catch(()=>undefined);
  return null;
 });}catch(error){await metric('error');throw error;}return {handled:!a.observation.enabled,settings,observe:a.observation.enabled};
}
export async function raidJoin(api:Api,chat:ChatRow,tgChat:Chat,user:User,base:GroupSettings,botId:number):Promise<boolean>{
 if(config.ownerIds.has(user.id))return false;
 const a=await runtimeAdvanced(chat);if(!a.raid.enabled||(await scopeExemptions(chat,user.id)).includes('raid'))return false;
 const member=await getChatMemberSafe(api,chat.chat_id,user.id);if(member&&isAdminStatus(member.status))return false;
 if((await globalBan(user.id)).banned)return false;
 const raid=await withTransaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock($1)',[chat.chat_id]);
  await c.query('INSERT INTO raid_joins(chat_id,user_id) VALUES($1,$2) ON CONFLICT(chat_id,user_id) DO UPDATE SET joined_at=now()',[chat.chat_id,user.id]);
  const count=(await c.query('SELECT COUNT(*)::int AS n FROM raid_joins WHERE chat_id=$1 AND joined_at>now()-make_interval(secs=>$2)',[chat.chat_id,a.raid.windowSeconds])).rows[0].n;
  if(count>=a.raid.threshold)await c.query('INSERT INTO raid_state(chat_id,until_at) VALUES($1,now()+make_interval(secs=>$2)) ON CONFLICT(chat_id) DO UPDATE SET until_at=GREATEST(raid_state.until_at,EXCLUDED.until_at)',[chat.chat_id,a.raid.durationSeconds]);
  return Boolean((await c.query('SELECT 1 FROM raid_state WHERE chat_id=$1 AND until_at>now()',[chat.chat_id])).rowCount);
 });if(!raid)return false;
 await onceOperation(`raid:${chat.chat_id}:${user.id}:${Math.floor(Date.now()/60000)}`,async()=>{
  if(a.observation.enabled){await logModeration({chatId:chat.chat_id,targetId:user.id,action:'observation',reason:tr("Ingreso durante antirraid"),metadata:{would:a.raid.action}});return null;}
  if(a.raid.action==='captcha')await sendCaptcha(api,tgChat,user,{...base,captcha:{...base.captcha,enabled:true}});
  else {const ctx:ModerationContext={api,chatId:chat.chat_id,chat,settings:base,botId,actorId:botId,actorName:'GBot',source:'bot'};const options={target:{userId:user.id,name:user.first_name},reason:tr("Protección antirraid"),durationSeconds:a.raid.sanctionSeconds};if(a.raid.action==='ban')await banUser(ctx,options);else await muteUser(ctx,options);}
  return null;
 });return !a.observation.enabled;
}
export type ResponseRule={id:number;trigger:string;mode:string;content:string;button_label:string|null;button_url:string|null;cooldown_seconds:number};
export function responseMatches(rule:Pick<ResponseRule,'trigger'|'mode'>,text:string):boolean{
 const input=text.normalize('NFKC').toLocaleLowerCase().trim(),trigger=rule.trigger.normalize('NFKC').toLocaleLowerCase().trim();
 if(rule.mode==='exact')return input===trigger;if(rule.mode==='prefix')return input.startsWith(trigger);
 return input.split(/[^\p{L}\p{N}_]+/u).includes(trigger);
}
export async function autoRespond(api:Api,chat:ChatRow,message:Message):Promise<boolean>{
 const a=await runtimeAdvanced(chat);if(!a.filters.enabled)return false;
 const text=message.text??message.caption??'';if(!text||text.startsWith('/')||text.startsWith('#'))return false;
 const rules=await advancedDataCache.get('responses:'+chat.chat_id,10000,()=>many<ResponseRule>('SELECT * FROM auto_responses WHERE chat_id=$1 AND enabled=true ORDER BY id LIMIT 100',[chat.chat_id]),String(chat.chat_id));
 const rule=rules.find(r=>responseMatches(r,text));if(!rule)return false;
 const claimed=await one('UPDATE auto_responses SET last_sent_at=now() WHERE id=$1 AND (last_sent_at IS NULL OR last_sent_at<now()-make_interval(secs=>cooldown_seconds)) RETURNING id',[rule.id]);if(!claimed)return false;
 await api.sendMessage(chat.chat_id,rule.content,{message_thread_id:message.message_thread_id,reply_parameters:{message_id:message.message_id,allow_sending_without_reply:true},reply_markup:rule.button_url&&rule.button_label?new InlineKeyboard().url(rule.button_label,rule.button_url):undefined});return true;
}
export async function autoDiscussionComment(api: Api, chat: ChatRow, message: Message): Promise<void> {
 const origin = message.forward_origin;
 if (!message.is_automatic_forward || origin?.type !== 'channel' || origin.chat.id !== message.sender_chat?.id) return;
 const { discussion } = await runtimeAdvanced(chat);
 if (!discussion.enabled) return;
 await onceOperation(`discussion:${chat.chat_id}:${origin.chat.id}:${origin.message_id}`, async () => {
  const sent = await api.sendMessage(chat.chat_id, discussion.text, {
   reply_parameters: { message_id: message.message_id },
   message_thread_id: message.is_topic_message ? message.message_thread_id : undefined,
   link_preview_options: { is_disabled: true },
  });
  return sent.message_id;
 });
}
export type RichNote={chat_id:number;name:string;content:string;media_type:string|null;file_id:string|null;buttons:{label:string;url:string}[];private_delivery:boolean};
export async function deliverRichNote(api:Api,note:RichNote,destination:number,threadId?:number):Promise<void>{
 const keyboard=new InlineKeyboard();for(const b of note.buttons)keyboard.url(b.label,b.url).row();
 const options={caption:note.content||undefined,reply_markup:keyboard,message_thread_id:threadId};
 if(note.file_id&&note.media_type==='photo')await api.sendPhoto(destination,note.file_id,options);
 else if(note.file_id&&note.media_type==='video')await api.sendVideo(destination,note.file_id,options);
 else if(note.file_id&&note.media_type==='animation')await api.sendAnimation(destination,note.file_id,options);
 else if(note.file_id&&note.media_type==='document')await api.sendDocument(destination,note.file_id,options);
 else await api.sendMessage(destination,note.content||tr("Nota"),{reply_markup:keyboard,message_thread_id:threadId});
}
export async function getRichNote(chat:ChatRow,name:string):Promise<RichNote|null>{
 if(!(await runtimeAdvanced(chat)).richNotes.enabled)return null;
 return advancedDataCache.get('note:'+chat.chat_id+':'+name,10000,()=>one<RichNote>('SELECT * FROM rich_notes WHERE chat_id=$1 AND name=$2',[chat.chat_id,name]),String(chat.chat_id));
}
export async function beginJoinGate(api:Api,chat:ChatRow,request:ChatJoinRequest):Promise<boolean>{
 if(config.ownerIds.has(request.from.id))return false;
 const a=await runtimeAdvanced(chat);if(!a.joinGate.enabled)return false;
 if((await scopeExemptions(chat,request.from.id)).includes('captcha')){await api.approveChatJoinRequest(chat.chat_id,request.from.id);return true;}
 const token=randomBytes(12).toString('hex');const x=randomInt(2,10),y=randomInt(2,10),answer=a.joinGate.mode==='math'?String(x+y):'ok';
 await query("INSERT INTO join_challenges(token,chat_id,user_id,user_chat_id,answer,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '4 minutes') ON CONFLICT(chat_id,user_id) DO UPDATE SET token=EXCLUDED.token,user_chat_id=EXCLUDED.user_chat_id,answer=EXCLUDED.answer,expires_at=EXCLUDED.expires_at,attempts=0,state='pending',native_query=NULL,native_bot_id=NULL,native_request_id=NULL,native_prompt=NULL",[token,chat.chat_id,request.from.id,request.user_chat_id,answer]);
 const keyboard=new InlineKeyboard();if(answer==='ok')keyboard.text(tr("Verificar y solicitar ingreso"),`jg:${token}:ok`);else for(const value of [x+y-1,x+y,x+y+2].sort(()=>Math.random()-.5))keyboard.text(String(value),`jg:${token}:${value}`);
 try{await api.sendMessage(request.user_chat_id,tr("🔐 Verificación para {0}\n{1}\nVálida durante 4 minutos.", [chat.title,answer==='ok'?tr("Pulsa el botón para continuar."):tr("Resuelve: {0} + {1}", [x,y])]),{reply_markup:keyboard});}
 catch(error){logger.warn({chatId:chat.chat_id,err:error},tr("No se pudo entregar captcha de solicitud; queda para revisión manual"));await query("UPDATE join_challenges SET state='delivery_failed' WHERE token=$1",[token]);}
 return true;
}
export async function verifyJoinGate(api:Api,token:string,userId:number,value:string):Promise<string>{
 return withTransaction(async c=>{
  const r=(await c.query("SELECT * FROM join_challenges WHERE token=$1 FOR UPDATE",[token])).rows[0];
  if(!r||r.native_bot_id||r.user_id!==userId||r.state!=='pending'||new Date(r.expires_at).getTime()<Date.now())return tr("La verificación venció o ya fue utilizada. Solicita acceso nuevamente.");
  const chat=await getChat(r.chat_id);if(!chat||!(await runtimeAdvanced(chat)).joinGate.enabled)return tr("La protección cambió. Un administrador debe revisar tu solicitud.");
  if(r.answer!==value){await c.query("UPDATE join_challenges SET attempts=attempts+1,state=CASE WHEN attempts>=2 THEN 'failed' ELSE state END WHERE token=$1",[token]);return r.attempts>=2?tr("No quedan intentos. Tu solicitud requiere revisión manual."):tr("Respuesta incorrecta. Intenta de nuevo.");}
  // Mark before the external call; an uncertain response must not trigger a second approval.
  await c.query("UPDATE join_challenges SET state='approving' WHERE token=$1",[token]);
  try{await api.approveChatJoinRequest(r.chat_id,userId);await c.query("UPDATE join_challenges SET state='approved' WHERE token=$1",[token]);await c.query("UPDATE pending_joins SET state='approved',resolved_at=now() WHERE chat_id=$1 AND user_id=$2",[r.chat_id,userId]);return tr("✅ Verificación completada. Ya puedes ingresar.");}
  catch{await c.query("UPDATE join_challenges SET state='manual_review' WHERE token=$1",[token]);return tr("Verificación correcta. Un administrador debe completar el ingreso.");}
 });
}
export async function runAdvancedSchedules(api:Api):Promise<void>{
 const rows=await many<ChatRow>('SELECT c.* FROM chats c WHERE c.active AND (EXISTS(SELECT 1 FROM advanced_config a WHERE a.chat_id=c.chat_id) OR EXISTS(SELECT 1 FROM night_state n WHERE n.chat_id=c.chat_id))');
 for(const chat of rows){try{const {runtimeForChat}=await import('./branded-bots.js');const effectiveApi=(await runtimeForChat(chat.chat_id))?.bot.api??api;const a=await runtimeAdvanced(chat);await reconcileNight(effectiveApi,chat,a);}catch(error){logger.warn({err:error,chatId:chat.chat_id},tr("No se pudo aplicar horario"));}}
 await query("DELETE FROM raid_joins WHERE joined_at<now()-interval '10 minutes'");
 await query("DELETE FROM group_invites WHERE expires_at<now() OR revoked_at<now()-interval '1 day'");
 await query("DELETE FROM delegated_roles WHERE expires_at<now()");
 const primary=primaryBot();
 if(primary)await expireNativeJoins({api,id:primary.botInfo.id});
 await query("UPDATE join_challenges SET state='expired' WHERE state='pending' AND native_bot_id IS NULL AND expires_at<now()");
 await query("DELETE FROM join_challenges WHERE expires_at<now()-interval '7 days'");
 await query("DELETE FROM operation_receipts WHERE state='done' AND completed_at<now()-interval '30 days'");
 await query("DELETE FROM update_receipts WHERE created_at<now()-interval '7 days'");
}
export async function reconcileNight(api:Api,chat:ChatRow,a:AdvancedSettings,now=new Date()):Promise<void>{
 // Session advisory lock serializes against itself; manual /lock is checked before closing.
 const {pool}=await import('../db/pool.js');const client=await pool.connect();
 try{await client.query('SELECT pg_advisory_lock(hashtext($1))',['night:'+chat.chat_id]);
 const stored=(await client.query('SELECT * FROM night_state WHERE chat_id=$1',[chat.chat_id])).rows[0];
 const shouldClose=isNight(a.night,now)&&!a.observation.enabled;
 if(shouldClose&&!stored){
  if((await client.query('SELECT 1 FROM chat_locks WHERE chat_id=$1',[chat.chat_id])).rowCount)return;
  const current=await api.getChat(chat.chat_id);const before=('permissions'in current&&current.permissions)||null;
  if(!before)throw new Error(tr("No se pueden leer los permisos actuales; el horario no modifica el grupo."));
  const applied={...before,...MUTED_PERMISSIONS};
  await client.query('INSERT INTO night_state(chat_id,permissions,applied_permissions) VALUES($1,$2::jsonb,$3::jsonb)',[chat.chat_id,JSON.stringify(before),JSON.stringify(applied)]);
  await api.setChatPermissions(chat.chat_id,applied,{use_independent_chat_permissions:true});
  await client.query('UPDATE night_state SET applied=true WHERE chat_id=$1',[chat.chat_id]);
  await logModeration({chatId:chat.chat_id,action:'night_close',reason:tr("Horario ")+a.night.timezone});
 }else if(shouldClose&&stored&&!stored.applied){
  if((await client.query('SELECT 1 FROM chat_locks WHERE chat_id=$1',[chat.chat_id])).rowCount)return;
  const live=await api.getChat(chat.chat_id),permissions=('permissions'in live&&live.permissions)||{};
  const same=(expected:Record<string,unknown>)=>Object.keys(expected).every(k=>Boolean((permissions as Record<string,unknown>)[k])===Boolean(expected[k]));
  if(same(stored.permissions))await api.setChatPermissions(chat.chat_id,stored.applied_permissions,{use_independent_chat_permissions:true});
  else if(!same(stored.applied_permissions))await logModeration({chatId:chat.chat_id,action:'night_conflict',reason:tr("Cambio de permisos externo durante un cierre pendiente; se conservan los cambios")});
  await client.query('UPDATE night_state SET applied=true WHERE chat_id=$1',[chat.chat_id]);
 }else if(!shouldClose&&stored){
  const manual=(await client.query('SELECT 1 FROM chat_locks WHERE chat_id=$1',[chat.chat_id])).rowCount;
  if(manual)return;
  const live=await api.getChat(chat.chat_id);const permissions=('permissions'in live&&live.permissions)||{};
  const unchanged=Object.keys(stored.applied_permissions).every(k=>Boolean((permissions as Record<string,unknown>)[k])===Boolean(stored.applied_permissions[k]));
  if(unchanged)await api.setChatPermissions(chat.chat_id,stored.permissions,{use_independent_chat_permissions:true});
  await client.query('DELETE FROM night_state WHERE chat_id=$1',[chat.chat_id]);
  await logModeration({chatId:chat.chat_id,action:unchanged?'night_open':'night_conflict',reason:unchanged?tr("Permisos restaurados"):tr("Un administrador cambió permisos; se conservan sus cambios")});
 }
 }finally{try{await client.query('SELECT pg_advisory_unlock(hashtext($1))',['night:'+chat.chat_id]);}finally{client.release();}}
}
