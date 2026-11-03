import { config } from '../config.js';
import { one,query } from '../db/pool.js';
import { ReadCache } from './read-cache.js';
import { logger } from '../logger.js';
import { assertDeveloper } from './roles.js';
export type CasVerdict={status:'banned'|'clear'|'unavailable'|'exempt';checkedAt:string;offenses?:number};
const cache=new ReadCache(10000);let pauseUntil=0;let health='not_checked';let inFlight=0;const waiters:(()=>void)[]=[];
async function slot(){if(inFlight>=3)await new Promise<void>(resolve=>waiters.push(resolve));else inFlight++;return()=>{const next=waiters.shift();if(next)next();else inFlight--;};}
export function parseCasResponse(http:number,body:unknown):'banned'|'clear'|'unavailable'{
 if(http!==200||!body||typeof body!=='object')return 'unavailable';
 const b=body as {ok?:unknown;description?:unknown;result?:{offenses?:unknown}};
 if(b.ok===true&&Number.isInteger(b.result?.offenses)&&Number(b.result?.offenses)>0)return 'banned';
 if(b.ok===false&&typeof b.description==='string'&&/^record not found\.?$/i.test(b.description.trim()))return 'clear';
 return 'unavailable';
}
export function invalidateCas(userId:number):void{cache.invalidate(String(userId));}
export function casHealth(){return {enabled:Boolean(config.casEnabled),status:health,paused:pauseUntil>Date.now(),attribution:'https://cas.chat'};}
export async function setCasException(userId:number,actorId:number,reason:string|null):Promise<void>{
 assertDeveloper(actorId);
 if(reason===null)await query('DELETE FROM cas_exceptions WHERE user_id=$1',[userId]);
 else await query('INSERT INTO cas_exceptions(user_id,actor_id,reason) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET actor_id=EXCLUDED.actor_id,reason=EXCLUDED.reason',[userId,actorId,reason]);
 invalidateCas(userId);
}
export async function checkCas(userId:number):Promise<CasVerdict>{
 if(config.ownerIds.has(userId))return {status:'exempt',checkedAt:new Date().toISOString()};
 if(!config.casEnabled||!config.casApiKey)return {status:'unavailable',checkedAt:new Date().toISOString()};
 return cache.get(String(userId),60000,async()=>{
  if(await one('SELECT 1 FROM cas_exceptions WHERE user_id=$1',[userId]))return {status:'exempt',checkedAt:new Date().toISOString()};
  const stored=await one<{status:'banned'|'clear';checked_at:Date;offenses:number}>('SELECT status,checked_at,offenses FROM cas_cache WHERE user_id=$1 AND expires_at>now()',[userId]);
  if(stored)return {status:stored.status,checkedAt:stored.checked_at.toISOString(),offenses:stored.offenses??undefined};
  if(pauseUntil>Date.now())return {status:'unavailable',checkedAt:new Date().toISOString()};
  const release=await slot();
  try{
   if(pauseUntil>Date.now())return {status:'unavailable',checkedAt:new Date().toISOString()};
   const response=await fetch('https://api.cas.chat/check?user_id='+userId,{headers:{Authorization:'Bearer '+config.casApiKey},signal:AbortSignal.timeout(2500),redirect:'error'});
   const body=await response.json().catch(()=>null);const status=parseCasResponse(response.status,body);health=status==='unavailable'?'unavailable':'ok';
   if(status==='unavailable'){pauseUntil=Date.now()+60000;logger.warn({http:response.status},'CAS no disponible; no se sanciona por el error');return {status,checkedAt:new Date().toISOString()};}
   const offenses=status==='banned'?Number((body as {result:{offenses:number}}).result.offenses):null,ttl=status==='banned'?900:21600;
   await query('INSERT INTO cas_cache(user_id,status,expires_at,offenses) VALUES($1,$2,now()+make_interval(secs=>$3),$4) ON CONFLICT(user_id) DO UPDATE SET status=EXCLUDED.status,checked_at=now(),expires_at=EXCLUDED.expires_at,offenses=EXCLUDED.offenses',[userId,status,ttl,offenses]);
   return {status,checkedAt:new Date().toISOString(),offenses:offenses??undefined};
  }catch{health='unavailable';pauseUntil=Date.now()+60000;logger.warn('CAS no disponible; se mantiene la moderación local');return {status:'unavailable',checkedAt:new Date().toISOString()};}
  finally{release();}
 },String(userId),result=>result.status!=='unavailable');
}
