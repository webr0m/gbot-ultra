import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Api} from 'grammy';
import type {ChatMember,ChatPermissions} from 'grammy/types';
import {config} from '../config.js';
import {many,one,query,withSessionLock} from '../db/pool.js';
import {logModeration} from '../db/repositories/moderation.js';
import {setMemberStatus} from '../db/repositories/members.js';
import type {ModerationContext} from './moderation.js';
import {hasFeature} from './entitlements.js';
import {withFreshTelegramReads} from './telegram-cache.js';
import {checkCas} from './cas.js';

const fail=(message:string,statusCode=409):never=>{throw Object.assign(new Error(message),{statusCode});};
const lock=(chatId:number,userId:number)=>`sanction:${chatId}:${userId}`;
export const PERMISSION_KEYS=['can_send_messages','can_send_audios','can_send_documents','can_send_photos','can_send_videos','can_send_video_notes','can_send_voice_notes','can_send_polls','can_send_other_messages','can_add_web_page_previews','can_react_to_messages','can_change_info','can_invite_users','can_pin_messages','can_manage_topics'] as const;
export function memberSnapshot(member:ChatMember):Record<string,unknown>{
 const raw=member as unknown as Record<string,unknown>,state:Record<string,unknown>={status:member.status};
 if(member.status==='restricted'||member.status==='kicked')state.until_date=Number(raw.until_date??0);
 if(member.status==='restricted'){state.is_member=raw.is_member===true;for(const key of PERMISSION_KEYS)state[key]=raw[key]===true;}
 return state;
}
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
async function bump(chatId:number,userId:number){return (await one<{version:number}>('INSERT INTO sanction_versions(chat_id,user_id) VALUES($1,$2) ON CONFLICT(chat_id,user_id) DO UPDATE SET version=sanction_versions.version+1,updated_at=now() RETURNING version',[chatId,userId]))!.version;}
export async function memberMutation<T>(chatId:number,userId:number,run:()=>Promise<T>):Promise<T>{
 return withSessionLock(lock(chatId,userId),async()=>{await query('UPDATE sanction_versions SET version=version+1,updated_at=now() WHERE chat_id=$1 AND user_id=$2',[chatId,userId]);return run();});
}
type Entry={id:string;chat_id:number;user_id:number;actor_id:number;bot_id:number;kind:'ban'|'mute';version:number;before_state:Record<string,unknown>;after_state:Record<string,unknown>|null;state:string;undo_state:string;created_at:Date};

/** Persist intent before Telegram. Any ambiguous result remains unavailable for undo. */
export async function journalMemberAction<T>(ctx:ModerationContext,userId:number,kind:string,metadata:Record<string,unknown>|undefined,run:()=>Promise<T>):Promise<T>{
 return withSessionLock(lock(ctx.chatId,userId),async()=>{
  const eligible=(kind==='ban'||kind==='mute')&&hasFeature(ctx.chat,'undoSanctions',ctx.actorId)&&!metadata?.externalSource&&!metadata?.allianceCaseId;
  if(!eligible){await query('UPDATE sanction_versions SET version=version+1,updated_at=now() WHERE chat_id=$1 AND user_id=$2',[ctx.chatId,userId]);return run();}
  const version=await bump(ctx.chatId,userId);
  return withFreshTelegramReads(async()=>{
   // If a snapshot cannot be read, moderation still works, but cannot be undone.
   const before=await ctx.api.getChatMember(ctx.chatId,userId).then(memberSnapshot).catch(()=>null);
   if(!before)return run();
   const id=randomUUID();
   await query('INSERT INTO sanction_actions(id,chat_id,user_id,actor_id,bot_id,kind,source,version,before_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[id,ctx.chatId,userId,ctx.actorId,ctx.botId,kind,ctx.source??'bot',version,JSON.stringify(before)]);
   try{
    const result=await run();
    const after=await ctx.api.getChatMember(ctx.chatId,userId).then(memberSnapshot).catch(()=>null);
    if(!after){await query("UPDATE sanction_actions SET state='uncertain',updated_at=now() WHERE id=$1",[id]);return result;}
    await query("UPDATE sanction_actions SET state='applied',after_state=$2::jsonb,updated_at=now() WHERE id=$1",[id,JSON.stringify(after)]);
    return result;
   }catch(error){await query("UPDATE sanction_actions SET state='uncertain',updated_at=now() WHERE id=$1",[id]);throw error;}
  });
 });
}

/** Delivered external membership updates invalidate provenance even if permissions match. */
export async function observeSanctionChange(api:Api,botId:number,chatId:number,userId:number,actorId:number,member:ChatMember){
 return withSessionLock(lock(chatId,userId),async()=>{
  const last=await one<Entry>('SELECT * FROM sanction_actions WHERE chat_id=$1 AND user_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[chatId,userId]);
  if(!last)return;
  const current=memberSnapshot(member);
  if(actorId!==botId||last.bot_id!==botId||!last.after_state||fingerprint(current)!==fingerprint(last.after_state))await bump(chatId,userId);
 });
}
export async function listSanctions(chatId:number,offset=0){
 const items=await many('SELECT a.id,a.user_id,a.actor_id,a.kind,a.state,a.undo_state,a.created_at,a.undone_at,a.undone_by,(v.version=a.version) AS current FROM sanction_actions a LEFT JOIN sanction_versions v ON v.chat_id=a.chat_id AND v.user_id=a.user_id WHERE a.chat_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 31 OFFSET $2',[chatId,offset]);
 return {items:items.slice(0,30),hasMore:items.length>30,offset};
}
export function restorePermissions(before:Record<string,unknown>,now=Math.floor(Date.now()/1000)):{permissions:ChatPermissions;until_date:number;description:string}{
 const until=Number(before.until_date??0);
 if(before.status==='restricted'&&(!until||until>now)){
  if(until&&until-now<30)fail('La restricción anterior vence en menos de 30 segundos. Espera a que expire y revisa nuevamente.');
  if(before.is_member!==true)fail('El estado anterior no permite una reversión segura.');
  return {permissions:Object.fromEntries(PERMISSION_KEYS.map(key=>[key,before[key]===true])),until_date:until,description:'Restaurar los permisos individuales anteriores y su vencimiento.'};
 }
 if(!['member','restricted'].includes(String(before.status)))fail('El estado anterior no permite una reversión segura.');
 return {permissions:Object.fromEntries(PERMISSION_KEYS.map(key=>[key,true])),until_date:0,description:'Retirar esta restricción individual. Se mantienen los límites generales del grupo.'};
}
async function validate(ctx:ModerationContext,id:string){
 if(!hasFeature(ctx.chat,'undoSanctions',ctx.actorId))fail('Deshacer sanciones requiere Pro o Ultra.',402);
 const row=await one<Entry>('SELECT * FROM sanction_actions WHERE id=$1 AND chat_id=$2',[id,ctx.chatId]);
 if(!row)fail('Sanción no encontrada.',404);
 const entry=row!;
 if(entry.bot_id!==ctx.botId)fail('Cambió el bot asignado al grupo. Revisa la sanción manualmente.');
 if(entry.state!=='applied'||entry.undo_state!=='none')fail('Esta acción ya se procesó o necesita una revisión manual.');
 const version=await one<{version:number}>('SELECT version FROM sanction_versions WHERE chat_id=$1 AND user_id=$2',[ctx.chatId,entry.user_id]);
 if(version?.version!==entry.version)fail('Hubo otra acción sobre este miembro. Revisa su estado actual.');
 if(config.ownerIds.has(entry.user_id)||entry.user_id===ctx.botId||entry.user_id===ctx.actorId)fail('No se puede aplicar esta acción a esta cuenta.',403);
 const actor=config.ownerIds.has(ctx.actorId)?null:await ctx.api.getChatMember(ctx.chatId,ctx.actorId),bot=await ctx.api.getChatMember(ctx.chatId,ctx.botId);
 if(!config.ownerIds.has(ctx.actorId)&&actor?.status!=='creator'&&(actor?.status!=='administrator'||!actor.can_restrict_members))fail('Ya no tienes permiso para restringir miembros.',403);
 if(bot.status!=='administrator'||!bot.can_restrict_members)fail('El bot necesita permiso para restringir miembros.',403);
 if(await one('SELECT 1 FROM gbans WHERE user_id=$1',[entry.user_id]))fail('La cuenta tiene un baneo global. No puede revertirse desde este grupo.');
 if(config.casEnabled){const cas=await checkCas(entry.user_id);if(cas.status==='banned')fail('CAS mantiene esta cuenta bloqueada.');if(cas.status==='unavailable')fail('No se pudo verificar CAS. Inténtalo más tarde.');}
 if(await one("SELECT 1 FROM captcha_pending WHERE chat_id=$1 AND user_id=$2 UNION ALL SELECT 1 FROM join_challenges WHERE chat_id=$1 AND user_id=$2 AND state='pending' LIMIT 1",[ctx.chatId,entry.user_id]))fail('El miembro tiene una verificación de ingreso pendiente.');
 const current=memberSnapshot(await ctx.api.getChatMember(ctx.chatId,entry.user_id));
 if(!entry.after_state||fingerprint(current)!==fingerprint(entry.after_state))fail('El estado de Telegram cambió. No se revertirá una sanción distinta.');
 if(entry.kind==='ban'&&(current.status!=='kicked'||!['member','left'].includes(String(entry.before_state.status))))fail('Esta expulsión no permite una reversión segura.');
 if(entry.kind==='mute'&&current.status!=='restricted')fail('El silencio ya no está activo.');
 const until=Number(current.until_date??0);if(until&&until<=Date.now()/1000)fail('La sanción ya venció.');
 const restore=entry.kind==='mute'?restorePermissions(entry.before_state):null;
 const group=await ctx.api.getChat(ctx.chatId);
 const binding=fingerprint({current,restore,permissions:'permissions' in group?group.permissions:null});
 return {entry,restore,binding};
}
function sign(payload:string){return createHmac('sha256',config.botToken).update(payload).digest('hex');}
export async function previewUndo(ctx:ModerationContext,id:string){
 const item=await one<Entry>('SELECT * FROM sanction_actions WHERE id=$1 AND chat_id=$2',[id,ctx.chatId]);if(!item)fail('Sanción no encontrada.',404);
 return withFreshTelegramReads(()=>withSessionLock(lock(ctx.chatId,item!.user_id),async()=>{
 const v=await validate(ctx,id);const payload=Buffer.from(JSON.stringify({id,chat:ctx.chatId,actor:ctx.actorId,bot:ctx.botId,binding:v.binding,version:v.entry.version,expires:Date.now()+5*60_000})).toString('base64url');
 return {id,targetId:v.entry.user_id,kind:v.entry.kind,createdAt:v.entry.created_at,restore:v.restore?{permissions:v.restore.permissions,untilDate:v.restore.until_date,individualRestriction:v.entry.before_state.status==='restricted'&&(!v.entry.before_state.until_date||Number(v.entry.before_state.until_date)>Date.now()/1000)}:null,description:v.restore?.description??'Retirar el baneo local para que el usuario pueda volver por invitación. No se reincorpora automáticamente.',notice:'No recupera mensajes borrados. La reversión no cambia reglas ni baneos globales. La vista previa vence en cinco minutos.',token:payload+'.'+sign(payload)};
}));}
export async function applyUndo(ctx:ModerationContext,token:string){
 const [payload,signature]=token.split('.');if(!payload||!signature||!/^([a-f0-9]{64})$/.test(signature)||!timingSafeEqual(Buffer.from(sign(payload)),Buffer.from(signature)))fail('Vista previa inválida.',400);
 let data:{id:string;chat:number;actor:number;bot:number;binding:string;version:number;expires:number};try{data=JSON.parse(Buffer.from(payload!,'base64url').toString());}catch{fail('Vista previa inválida.',400);}
 const d=data!;if(d.chat!==ctx.chatId||d.actor!==ctx.actorId||d.bot!==ctx.botId||d.expires<Date.now())fail('La vista previa venció o pertenece a otra sesión.');
 const item=await one<Entry>('SELECT * FROM sanction_actions WHERE id=$1 AND chat_id=$2',[d.id,ctx.chatId]);if(!item)fail('Sanción no encontrada.',404);
 return withFreshTelegramReads(()=>withSessionLock(lock(ctx.chatId,item!.user_id),async()=>{
  const v=await validate(ctx,d.id);if(v.binding!==d.binding||v.entry.version!==d.version)fail('Cambió el estado de la vista previa. Revisa nuevamente.');
  await query("UPDATE sanction_actions SET undo_state='processing',undone_by=$2,updated_at=now() WHERE id=$1",[d.id,ctx.actorId]);
  await bump(ctx.chatId,v.entry.user_id);
  try{
   if(v.entry.kind==='ban')await ctx.api.unbanChatMember(ctx.chatId,v.entry.user_id,{only_if_banned:true});
   else await ctx.api.restrictChatMember(ctx.chatId,v.entry.user_id,v.restore!.permissions,{use_independent_chat_permissions:true,until_date:v.restore!.until_date});
   await setMemberStatus(ctx.chatId,v.entry.user_id,v.entry.kind==='ban'?'left':v.restore!.until_date||v.entry.before_state.status==='restricted'&&!v.entry.before_state.until_date?'restricted':'member');
   await logModeration({chatId:ctx.chatId,actorId:ctx.actorId,targetId:v.entry.user_id,action:'undo_'+v.entry.kind,metadata:{sanctionId:d.id,source:'miniapp'}});
   await query("UPDATE sanction_actions SET undo_state='done',undone_at=now(),updated_at=now() WHERE id=$1",[d.id]);
   return {ok:true,notice:'Sanción revertida. La acción quedó registrada.'};
  }catch(error){await query("UPDATE sanction_actions SET undo_state='uncertain',updated_at=now() WHERE id=$1",[d.id]);throw error;}
 }));
}
