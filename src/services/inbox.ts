import {randomUUID} from 'node:crypto';
import type {Api} from 'grammy';
import type {ChatJoinRequest} from 'grammy/types';
import {pool,query} from '../db/pool.js';
import type {ChatRow} from '../db/types.js';
import {globalBan} from './global-bans.js';
import {assertActorRight} from './moderation.js';
import {settingsOf} from './chat-cache.js';
import {hasFeature} from './entitlements.js';

export const INBOX_KINDS=['report','join','visual','operation','publication','update'] as const;
export type InboxKind=typeof INBOX_KINDS[number];
export async function rememberReport(chatId:number,reporterId:number,messageId:number,targetId?:number,excerpt?:string){
 const clean=excerpt?.replace(/(?:gsk_[a-zA-Z0-9]{20,}|sk-proj-[\w-]{20,}|\b\d{8,12}:[\w-]{30,})/g,'[credencial oculta]').slice(0,300);
 await query('INSERT INTO member_reports(chat_id,reporter_id,message_id,target_id,excerpt) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[chatId,reporterId,messageId,targetId??null,clean??null]);
}
export async function rememberJoin(request:ChatJoinRequest){
 await query("INSERT INTO pending_joins(chat_id,user_id,request_id,first_name,username) VALUES($1,$2,$3,$4,$5) ON CONFLICT(chat_id,user_id) DO UPDATE SET request_id=EXCLUDED.request_id,first_name=EXCLUDED.first_name,username=EXCLUDED.username,state='pending',requested_at=now(),resolved_at=null,resolved_by=null",[request.chat.id,request.from.id,randomUUID(),request.from.first_name,request.from.username??null]);
}
export async function finishJoin(chatId:number,userId:number,state='approved',actorId?:number){
 await query("UPDATE pending_joins SET state=$3,resolved_at=now(),resolved_by=$4 WHERE chat_id=$1 AND user_id=$2 AND state IN ('pending','processing','uncertain')",[chatId,userId,state,actorId??null]);
 await query("UPDATE join_challenges SET state=$3 WHERE chat_id=$1 AND user_id=$2 AND state IN ('pending','approving','manual_review','delivery_failed','failed','expired')",[chatId,userId,state]);
}
const sourceSql=`WITH source AS (
 SELECT chat_id,'report'::text AS kind,id::text AS source_ref,'Reporte de un miembro'::text AS title,
   COALESCE(excerpt,'Revisa el mensaje reportado en Telegram.') AS detail,target_id AS user_id,message_id,
   created_at,'open'::text AS system_state,md5(id::text||created_at::text) AS revision FROM member_reports WHERE chat_id=ANY($1::bigint[])
 UNION ALL
 SELECT p.chat_id,'join',p.request_id::text,'Solicitud de ingreso',p.first_name||CASE WHEN p.username IS NULL THEN '' ELSE ' (@'||p.username||')' END||
   CASE WHEN j.state IN ('failed','expired','delivery_failed','manual_review') THEN ' · Verificación pendiente de revisión' ELSE '' END,
   p.user_id,NULL::bigint,p.requested_at,CASE WHEN p.state IN ('approved','declined') THEN 'resolved' WHEN p.state='uncertain' THEN 'uncertain' ELSE 'open' END,
   md5(p.request_id::text||p.state) FROM pending_joins p LEFT JOIN join_challenges j ON j.chat_id=p.chat_id AND j.user_id=p.user_id WHERE p.chat_id=ANY($1::bigint[])
 UNION ALL
 SELECT chat_id,'visual',id::text,'Revisión de fotografía',COALESCE(detail,'Revisa la foto antes de decidir.'),user_id,message_id,
   created_at,CASE WHEN state='reviewed' THEN 'resolved' ELSE 'open' END,md5(id::text||state||updated_at::text)
   FROM visual_jobs WHERE chat_id=ANY($1::bigint[]) AND state IN ('review','unavailable','reviewed')
 UNION ALL
 SELECT chat_id,'operation',key,'Operación por comprobar','Comprueba el resultado en Telegram y el registro. Marcar revisada no repite la operación.',NULL::bigint,NULL::bigint,created_at,'uncertain',md5(key||state)
   FROM operation_receipts WHERE chat_id=ANY($1::bigint[]) AND (state='uncertain' OR state='pending' AND created_at<now()-interval '3 minutes')
 UNION ALL
 SELECT p.chat_id,'publication',p.id::text,'Publicación por revisar',COALESCE(p.last_error,'Comprueba si el mensaje llegó antes de reprogramarlo.'),NULL::bigint,NULL::bigint,p.updated_at,
   CASE WHEN p.state='review' THEN 'open' ELSE 'resolved' END,md5(p.id::text||p.state||p.version::text)
   FROM scheduled_posts p WHERE p.chat_id=ANY($1::bigint[]) AND (p.state='review' OR EXISTS(SELECT 1 FROM inbox_decisions d WHERE d.chat_id=p.chat_id AND d.kind='publication' AND d.source_ref=p.id::text))
 UNION ALL
 SELECT chat_id,'update',update_id::text,'Actualización por comprobar','Una actualización quedó interrumpida. Consulta el registro; no se reintentará desde la bandeja.',NULL::bigint,NULL::bigint,created_at,'uncertain',md5(update_id::text||state)
   FROM update_receipts WHERE chat_id=ANY($1::bigint[]) AND (state='uncertain' OR state='pending' AND created_at<now()-interval '3 minutes')
 ), entries AS (
 SELECT s.*,c.title AS chat_title,COALESCE(d.version,0) AS version,
   CASE WHEN d.state='resolved' OR s.system_state='resolved' THEN 'resolved' WHEN d.state='uncertain' OR s.system_state='uncertain' OR d.state='pending' AND d.created_at<now()-interval '3 minutes' THEN 'uncertain' WHEN d.state='pending' THEN 'processing' ELSE 'open' END AS state,
   d.decision,d.actor_id,d.resolved_at,COALESCE(NULLIF(u.first_name,''),'Administrador') AS resolver_name
 FROM source s JOIN chats c ON c.chat_id=s.chat_id LEFT JOIN inbox_decisions d ON d.chat_id=s.chat_id AND d.kind=s.kind AND d.source_ref=s.source_ref
 LEFT JOIN users u ON u.user_id=d.actor_id
 )`;
export interface InboxEntry {chat_id:number;chat_title:string;kind:InboxKind;source_ref:string;title:string;detail:string;user_id:number|null;message_id:number|null;created_at:Date;revision:string;version:number;state:string;decision:string|null;actor_id:number|null;resolved_at:Date|null;resolver_name:string;}
export async function listInbox(chatIds:number[],state:string,kind:string,offset:number,limit:number){
 if(!chatIds.length)return {items:[],total:0,open:0,hasMore:false};
 const result=await query(sourceSql+`, filtered AS (SELECT * FROM entries WHERE ($2='all' OR $2='open' AND state<>'resolved' OR $2<>'open' AND state=$2) AND ($3='all' OR kind=$3)),page AS (SELECT * FROM filtered ORDER BY created_at DESC,chat_id,kind,source_ref LIMIT $4 OFFSET $5)
 SELECT COALESCE((SELECT jsonb_agg(p ORDER BY p.created_at DESC,p.chat_id,p.kind,p.source_ref) FROM page p),'[]'::jsonb) AS items,(SELECT count(*)::int FROM filtered) AS total,(SELECT count(*)::int FROM entries WHERE state<>'resolved') AS open`,[chatIds,state,kind,limit,offset]);
 const row=result.rows[0] as {items:InboxEntry[];total:number;open:number};return {...row,hasMore:offset+row.items.length<row.total};
}
export async function resolveInbox(api:Api,botId:number,chat:ChatRow,actorId:number,input:{kind:InboxKind;ref:string;revision:string;version:number;action:'acknowledge'|'dismiss'|'approve'|'decline'}){
 if(!hasFeature(chat,'inbox',actorId))throw Object.assign(new Error('La bandeja requiere Pro o Ultra.'),{statusCode:402});
 const fail=(message:string,statusCode=409):never=>{throw Object.assign(new Error(message),{statusCode});};
 const joinAction=input.action==='approve'||input.action==='decline';
 if(joinAction&&input.kind!=='join')fail('Esta acción solo corresponde a solicitudes de ingreso.',400);
 await assertActorRight({api,chatId:chat.chat_id,chat,settings:settingsOf(chat),botId,actorId,actorName:'Administrador'},joinAction?'can_invite_users':'can_change_info');
 if(input.action==='approve'){
  const candidate=(await query<InboxEntry>(sourceSql+' SELECT * FROM entries WHERE kind=$2 AND source_ref=$3',[[chat.chat_id],input.kind,input.ref])).rows[0];
  if(candidate&&(await globalBan(candidate.user_id!)).banned)fail('El usuario está bloqueado por la protección global. Puedes rechazar la solicitud.',403);
 }
 const client=await pool.connect(),lock=`inbox:${chat.chat_id}:${input.kind}:${input.ref}`;let locked=false;
 try{
  locked=(await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',[lock])).rows[0]?.locked;if(!locked)fail('Otro administrador está resolviendo este elemento.');
  const item=(await client.query<InboxEntry>(sourceSql+' SELECT * FROM entries WHERE kind=$2 AND source_ref=$3',[[chat.chat_id],input.kind,input.ref])).rows[0];
  if(!item)fail('El elemento ya no está disponible. Actualiza la bandeja.');
  if(item.state==='resolved'){if(item.decision===input.action)return {ok:true,repeated:true};fail('Este elemento ya fue resuelto. Actualiza la bandeja para comprobar la decisión.');}
  if(item.revision!==input.revision||item.version!==input.version)fail('El elemento cambió. Actualiza antes de resolver.');
  if(item.state==='processing')fail('La resolución sigue en curso. Espera antes de revisarla.');
  if(joinAction&&item.state==='uncertain')fail('El resultado quedó incierto. Comprueba Telegram y márcalo revisado; no repitas la solicitud.');
  // Persist before contacting Telegram. A killed process can only be acknowledged later, never auto-replayed.
  if(!joinAction)await client.query('BEGIN');
  try{
   await client.query("INSERT INTO inbox_decisions(chat_id,kind,source_ref,state,decision,actor_id,version,resolved_at) VALUES($1,$2,$3,$4,$5,$6,1,CASE WHEN $4='resolved' THEN now() END) ON CONFLICT(chat_id,kind,source_ref) DO UPDATE SET state=EXCLUDED.state,decision=EXCLUDED.decision,actor_id=EXCLUDED.actor_id,version=inbox_decisions.version+1,resolved_at=EXCLUDED.resolved_at,created_at=now()",[chat.chat_id,input.kind,input.ref,joinAction?'pending':'resolved',input.action,actorId]);
   if(!joinAction){
    if(input.kind==='visual')await client.query("UPDATE visual_jobs SET state='reviewed',updated_at=now() WHERE chat_id=$1 AND id::text=$2",[chat.chat_id,input.ref]);
    await client.query("INSERT INTO moderation_log(chat_id,actor_id,target_id,action,reason,metadata) VALUES($1,$2,$3,'inbox_decision',$4,$5::jsonb)",[chat.chat_id,actorId,item.user_id,input.action,JSON.stringify({kind:input.kind,sourceRef:input.ref})]);
    await client.query('COMMIT');return {ok:true};
   }
  }catch(error){if(!joinAction)await client.query('ROLLBACK');throw error;}
  if(joinAction){
   await client.query("UPDATE pending_joins SET state='processing' WHERE chat_id=$1 AND request_id=$2",[chat.chat_id,input.ref]);
   try{
    if(input.action==='approve')await api.approveChatJoinRequest(chat.chat_id,item.user_id!);else await api.declineChatJoinRequest(chat.chat_id,item.user_id!);
    const state=input.action==='approve'?'approved':'declined';
    await client.query('UPDATE pending_joins SET state=$3,resolved_at=now(),resolved_by=$4 WHERE chat_id=$1 AND request_id=$2',[chat.chat_id,input.ref,state,actorId]);
    await client.query("UPDATE join_challenges SET state=$3 WHERE chat_id=$1 AND user_id=$2 AND state IN ('pending','approving','manual_review','delivery_failed','failed','expired')",[chat.chat_id,item.user_id,state]);
    await client.query("UPDATE inbox_decisions SET state='resolved',resolved_at=now() WHERE chat_id=$1 AND kind=$2 AND source_ref=$3",[chat.chat_id,input.kind,input.ref]);
   }catch{
    await client.query("UPDATE pending_joins SET state='uncertain' WHERE chat_id=$1 AND request_id=$2",[chat.chat_id,input.ref]);
    await client.query("UPDATE inbox_decisions SET state='uncertain' WHERE chat_id=$1 AND kind=$2 AND source_ref=$3",[chat.chat_id,input.kind,input.ref]);
    return {ok:true,uncertain:true,notice:'No se confirmó el resultado. Comprueba Telegram antes de marcar revisado.'};
   }
  }
  await client.query("INSERT INTO moderation_log(chat_id,actor_id,target_id,action,reason,metadata) VALUES($1,$2,$3,'inbox_decision',$4,$5::jsonb)",[chat.chat_id,actorId,item.user_id,input.action,JSON.stringify({kind:input.kind,sourceRef:input.ref})]);
  return {ok:true};
 }finally{try{if(locked)await client.query('SELECT pg_advisory_unlock(hashtext($1))',[lock]);}finally{client.release();}}
}
export async function cleanupInbox(){
 await query("DELETE FROM member_reports WHERE created_at<now()-interval '30 days'");
 await query("DELETE FROM pending_joins WHERE requested_at<now()-interval '30 days'");
 await query("DELETE FROM inbox_decisions WHERE state='resolved' AND kind IN ('report','join','visual') AND resolved_at<now()-interval '90 days'");
 await query("DELETE FROM setup_applications WHERE created_at<now()-interval '90 days'");
}
