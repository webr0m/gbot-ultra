import {createHash,randomUUID} from 'node:crypto';
import {many,one,query,withTransaction} from '../db/pool.js';
import {ReadCache} from './read-cache.js';
import {logger} from '../logger.js';
import {chatTier, type PremiumTier} from './entitlements.js';

/** Metadata kept per plan: free and Premium 30 days, Pro 100, Ultra one year. */
export const RULE_RETENTION_DAYS:Record<PremiumTier,number>={free:30,premium:30,pro:100,ultra:365};
/** Periods a group may ask for, never beyond its own retention. */
export const RULE_WINDOWS:Record<PremiumTier,number[]>={free:[7,14,30],premium:[7,14,30],pro:[7,14,30,90,100],ultra:[7,14,30,90,365]};

const cache=new ReadCache(500);
export const ruleRevision=(settings:unknown)=>createHash('sha256').update(JSON.stringify(settings)).digest('hex').slice(0,12);
/** One matched rule per message. Only technical metadata; never message content. */
export async function recordRuleEvent(chatId:number,messageId:number,ruleKey:string,revision:string,action:string,outcome:'applied'|'observation'|'error'){
 try{
  await query('INSERT INTO rule_events(id,chat_id,message_id,rule_key,revision,action,outcome) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(chat_id,message_id,rule_key) DO NOTHING',[randomUUID(),chatId,messageId,ruleKey,revision,action,outcome]);
  cache.invalidate(String(chatId));
 }catch(error){logger.warn({err:error,chatId},'No se pudo registrar la métrica de la regla');}
}
export async function ruleQuality(chatId:number,days:number,offset:number,tier:PremiumTier){
 const summary=await cache.get(`${chatId}:${days}`,15_000,async()=>{
  const rules=await many(`SELECT rule_key,revision,COUNT(*)::int AS total,
   COUNT(*) FILTER(WHERE outcome='applied')::int AS applied,
   COUNT(*) FILTER(WHERE outcome='observation')::int AS observed,
   COUNT(*) FILTER(WHERE outcome='error')::int AS errors,
   COUNT(*) FILTER(WHERE review IS NOT NULL)::int AS reviewed,
   COUNT(*) FILTER(WHERE review='false_positive')::int AS false_positives,
   COUNT(*) FILTER(WHERE review='correct')::int AS correct,
   COUNT(*) FILTER(WHERE review='unsure')::int AS unsure
   FROM rule_events WHERE chat_id=$1 AND created_at>=now()-make_interval(days=>$2) GROUP BY rule_key,revision ORDER BY total DESC,rule_key,revision`,[chatId,days]);
  const trend=await many(`SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,COUNT(*)::int AS total,COUNT(*) FILTER(WHERE review='false_positive')::int AS false_positives FROM rule_events WHERE chat_id=$1 AND created_at>=now()-make_interval(days=>$2) GROUP BY day ORDER BY day`,[chatId,days]);
  return {rules,trend};
 },String(chatId));
 const rows=await many('SELECT id,rule_key,revision,message_id,action,outcome,review,review_version,reviewed_at,reviewer_id,created_at FROM rule_events WHERE chat_id=$1 AND created_at>=now()-make_interval(days=>$2) ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET $3',[chatId,days,offset]);
 return {...summary,items:rows.slice(0,30),hasMore:rows.length>30,offset,days,timezone:'UTC',retentionDays:RULE_RETENTION_DAYS[tier],windows:RULE_WINDOWS[tier]};
}
export async function reviewRule(chatId:number,actorId:number,id:string,version:number,verdict:string){
 await withTransaction(async client=>{
  const row=(await client.query('UPDATE rule_events SET review=$4,review_version=review_version+1,reviewer_id=$3,reviewed_at=now() WHERE id=$1 AND chat_id=$2 AND review_version=$5 RETURNING id,review_version',[id,chatId,actorId,verdict,version])).rows[0];
  if(!row)throw Object.assign(new Error('El elemento cambió o ya no está disponible. Actualiza la lista.'),{statusCode:409});
  await client.query('INSERT INTO rule_reviews(event_id,actor_id,verdict,version) VALUES($1,$2,$3,$4)',[id,actorId,verdict,row.review_version]);
 });
 cache.invalidate(String(chatId));return {ok:true};
}
export async function cleanupRuleQuality(){
 const rows=await many('SELECT DISTINCT c.chat_id,c.premium_until,c.premium_tier,c.pro_license_id FROM chats c WHERE EXISTS(SELECT 1 FROM rule_events e WHERE e.chat_id=c.chat_id)');
 const groups=new Map<number,number[]>();
 for(const row of rows){
  const days=RULE_RETENTION_DAYS[chatTier({premium_until:row.premium_until,premium_tier:row.premium_tier,pro_license_id:row.pro_license_id})];
  const list=groups.get(days)??[];
  list.push(Number(row.chat_id));
  groups.set(days,list);
 }
 for(const [days,ids] of groups)await query('DELETE FROM rule_events WHERE chat_id=ANY($1::bigint[]) AND created_at<now()-make_interval(days=>$2)',[ids,days]);
 // Leave interrupted Telegram operations visible for review; never replay them.
 await query("DELETE FROM sanction_actions WHERE created_at<now()-interval '90 days' AND state IN ('applied','failed') AND undo_state IN ('none','done')");
 await query("DELETE FROM sanction_versions v WHERE updated_at<now()-interval '90 days' AND NOT EXISTS(SELECT 1 FROM sanction_actions a WHERE a.chat_id=v.chat_id AND a.user_id=v.user_id)");
}
