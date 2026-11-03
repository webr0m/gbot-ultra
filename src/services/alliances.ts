import { tr } from "./bot-i18n.js";
import { randomBytes } from 'node:crypto';
import type { Api } from 'grammy';
import { many, one, query, withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import type { ChatRow } from '../db/types.js';
import { advancedConfig, saveAdvanced, ADVANCED_DEFAULTS, type AdvancedSettings } from './advanced-config.js';
import { settingsOf } from './chat-cache.js';
import { banUser, unbanUser, assertActorRight } from './moderation.js';
import { getChatMemberSafe } from '../utils/telegram.js';
import { logModeration } from '../db/repositories/moderation.js';
import { onceOperation } from './operations.js';
type Alliance={id:number;name:string;owner_id:number;invite_code:string;profile:AdvancedSettings|null;profile_version:number};
function error(message:string,statusCode=403):never{throw Object.assign(new Error(message),{statusCode});}
export async function linkedAlliance(chatId:number):Promise<Alliance|null>{return one<Alliance>('SELECT a.* FROM alliances a JOIN alliance_chats m ON m.alliance_id=a.id WHERE m.chat_id=$1',[chatId]);}
export async function allianceOverview(chatId:number,actorId:number){
 const a=await linkedAlliance(chatId);if(!a)return null;
 const cases=await many('SELECT c.*,r.decision FROM alliance_cases c LEFT JOIN alliance_reviews r ON r.case_id=c.id AND r.chat_id=$2 WHERE c.alliance_id=$1 ORDER BY c.id DESC LIMIT 100',[a.id,chatId]);
 const groups=await many('SELECT c.chat_id,c.title,m.profile_version FROM alliance_chats m JOIN chats c ON c.chat_id=m.chat_id WHERE m.alliance_id=$1 ORDER BY c.title',[a.id]);
 return {id:a.id,name:a.name,ownerId:a.owner_id,inviteCode:a.owner_id===actorId||config.ownerIds.has(actorId)?a.invite_code:undefined,profile:a.profile,profileVersion:a.profile_version,cases,groups};
}
export async function createAlliance(chatId:number,actorId:number,name:string):Promise<void>{
 await withTransaction(async c=>{
  if((await c.query('SELECT 1 FROM alliance_chats WHERE chat_id=$1',[chatId])).rowCount)error(tr("Este grupo ya pertenece a una Alianza."),409);
  const a=(await c.query('INSERT INTO alliances(name,owner_id,invite_code) VALUES($1,$2,$3) RETURNING id',[name,actorId,randomBytes(18).toString('hex')])).rows[0];
  await c.query('INSERT INTO alliance_chats(chat_id,alliance_id,joined_by) VALUES($1,$2,$3)',[chatId,a.id,actorId]);
 });
 await logModeration({chatId,actorId,action:'alliance_create',reason:name});
}
export async function joinAlliance(chatId:number,actorId:number,code:string):Promise<void>{
 await withTransaction(async c=>{const a=(await c.query('SELECT id FROM alliances WHERE invite_code=$1',[code])).rows[0];if(!a)error(tr("Invitación no válida o revocada."),404);await c.query('INSERT INTO alliance_chats(chat_id,alliance_id,joined_by) VALUES($1,$2,$3)',[chatId,a.id,actorId]);});
 await logModeration({chatId,actorId,action:'alliance_join',reason:tr("Adhesión voluntaria")});
}
export async function leaveAlliance(chatId:number,actorId:number):Promise<void>{
 await query('DELETE FROM alliance_chats WHERE chat_id=$1',[chatId]);
 await logModeration({chatId,actorId,action:'alliance_leave',reason:tr("Las sanciones adoptadas conservan su registro; salir no las revierte.")});
}
export async function rotateAllianceInvite(chatId:number,actorId:number):Promise<void>{
 const a=await linkedAlliance(chatId);if(!a||(!config.ownerIds.has(actorId)&&a.owner_id!==actorId))error(tr("Solo el responsable de la Alianza puede renovar la invitación."));
 await query('UPDATE alliances SET invite_code=$2 WHERE id=$1',[a.id,randomBytes(18).toString('hex')]);
}
export async function proposeCase(chatId:number,actorId:number,userId:number,reason:string,seconds:number):Promise<void>{
 const a=await linkedAlliance(chatId);if(!a)error(tr("Este grupo no está en una Alianza."),404);
 if(config.ownerIds.has(userId))error(tr("No se puede aplicar esta acción a esta cuenta."));
 await query('INSERT INTO alliance_cases(alliance_id,source_chat_id,user_id,reason,actor_id,duration_seconds) VALUES($1,$2,$3,$4,$5,$6)',[a.id,chatId,userId,reason,actorId,seconds]);
 await logModeration({chatId,actorId,targetId:userId,action:'alliance_propose',reason});
}
export async function reviewCase(api:Api,botId:number,chat:ChatRow,actorId:number,caseId:number,decision:'apply'|'skip'|'undo'):Promise<void>{
 const a=await linkedAlliance(chat.chat_id);if(!a)error(tr("No perteneces a esta Alianza."),404);
 const c=await one<{id:number;user_id:number;reason:string;duration_seconds:number;withdrawn_at:Date|null;created_at:Date}>('SELECT * FROM alliance_cases WHERE id=$1 AND alliance_id=$2',[caseId,a.id]);if(!c)error(tr("Caso no encontrado."),404);
 const ctx={api,botId,chatId:chat.chat_id,chat,settings:settingsOf(chat),actorId,actorName:tr("Administrador de Alianza"),source:'miniapp' as const};
 await assertActorRight(ctx,'can_restrict_members');
 if(c.withdrawn_at && decision==='apply')error(tr("El caso fue retirado."),409);
 if(Date.now()-new Date(c.created_at).getTime()>30*86400000 && decision==='apply')error(tr("Este caso caducó para nuevas sanciones. Crea un caso actualizado."),409);
 await onceOperation(`alliance:${caseId}:${chat.chat_id}:${decision}`,async()=>{
  const previous=await one('SELECT * FROM alliance_reviews WHERE case_id=$1 AND chat_id=$2',[caseId,chat.chat_id]);
  if(decision==='skip'){
   if(previous?.decision==='applied')error(tr("Primero revierte la sanción adoptada."),409);
   await query("INSERT INTO alliance_reviews(case_id,chat_id,actor_id,decision) VALUES($1,$2,$3,'skipped') ON CONFLICT(case_id,chat_id) DO UPDATE SET decision='skipped',actor_id=EXCLUDED.actor_id",[caseId,chat.chat_id,actorId]);
  }else if(decision==='apply'){
   if(previous?.decision==='applied')return null;
   if(config.ownerIds.has(c.user_id))error(tr("Usuario global protegido."));
   const member=await getChatMemberSafe(api,chat.chat_id,c.user_id);if(!member)error(tr("Telegram no pudo comprobar el usuario."),400);
   if(member.status==='kicked')error(tr("Ya existe un baneo ajeno a este caso; no se reemplazará."),409);
   await banUser(ctx,{target:{userId:c.user_id,name:member.user.first_name},reason:tr("Alianza: ")+c.reason,durationSeconds:c.duration_seconds,metadata:{allianceCaseId:caseId}});
   await query("INSERT INTO alliance_reviews(case_id,chat_id,actor_id,decision,previous_status) VALUES($1,$2,$3,'applied',$4) ON CONFLICT(case_id,chat_id) DO UPDATE SET decision='applied',actor_id=EXCLUDED.actor_id,previous_status=EXCLUDED.previous_status",[caseId,chat.chat_id,actorId,member.status]);
   await logModeration({chatId:chat.chat_id,actorId,targetId:c.user_id,action:'alliance_ban',reason:c.reason,metadata:{caseId}});
  }else{
   if(previous?.decision!=='applied')error(tr("Este grupo no adoptó una sanción de este caso."),409);
   const last=await one('SELECT action,metadata FROM moderation_log WHERE chat_id=$1 AND target_id=$2 ORDER BY id DESC LIMIT 1',[chat.chat_id,c.user_id]);
   if(last?.action!=='alliance_ban'||last.metadata?.caseId!==caseId)error(tr("Hay una acción posterior sobre este usuario. Revisa el registro antes de cambiar su sanción."),409);
   await unbanUser(ctx,{userId:c.user_id,name:String(c.user_id)});
   await query("UPDATE alliance_reviews SET decision='undone',actor_id=$3 WHERE case_id=$1 AND chat_id=$2",[caseId,chat.chat_id,actorId]);
  }return null;
 });
}
export async function publishAllianceProfile(chatId:number,actorId:number):Promise<void>{
 const a=await linkedAlliance(chatId);if(!a||(!config.ownerIds.has(actorId)&&a.owner_id!==actorId))error(tr("Solo el responsable publica perfiles."));
 const c=await advancedConfig(chatId);const profile=structuredClone(c.settings);
 // Destinations and quiet policy are local, never transferred to another group.
 profile.topics=structuredClone(ADVANCED_DEFAULTS.topics);profile.silent.enabled=false;profile.observation.enabled=false;
 await query('UPDATE alliances SET profile=$2::jsonb,profile_version=profile_version+1 WHERE id=$1',[a.id,JSON.stringify(profile)]);
 await logModeration({chatId,actorId,action:'alliance_profile_publish',reason:tr("Perfil sin destinos privados")});
}
export async function adoptAllianceProfile(chat:ChatRow,actorId:number,version:number,profileVersion:number):Promise<void>{
 const a=await linkedAlliance(chat.chat_id);if(!a?.profile)error(tr("No hay perfil publicado."),404);if(a.profile_version!==profileVersion)error(tr("El perfil cambió; revisa de nuevo las diferencias."),409);
 const current=await advancedConfig(chat.chat_id);const profile={...a.profile,topics:current.settings.topics,silent:current.settings.silent,observation:current.settings.observation};
 await saveAdvanced(chat,profile,actorId,version);
 await query('UPDATE alliance_chats SET profile_version=$2 WHERE chat_id=$1',[chat.chat_id,a.profile_version]);
}
