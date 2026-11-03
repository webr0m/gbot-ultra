import {query} from '../db/pool.js';
import {ReadCache} from './read-cache.js';
const cache=new ReadCache(10000);
export async function rememberPrivateContact(botId:number,userId:number,language?:string){
 return cache.get(`${botId}:${userId}:${language??''}`,60_000,async()=>{
  await query(`INSERT INTO bot_contacts(bot_id,user_id,can_contact,client_language,source) VALUES($1,$2,true,$3,'private_update') ON CONFLICT(bot_id,user_id) DO UPDATE SET can_contact=true,client_language=COALESCE(EXCLUDED.client_language,bot_contacts.client_language),last_seen_at=now(),source='private_update'`,[botId,userId,language??null]);return true;
 },`${botId}:${userId}`);
}
export async function recordContactDelivery(botId:number,userId:number,allowed:boolean,language?:string){
 await query(`INSERT INTO bot_contacts(bot_id,user_id,can_contact,client_language,source,last_delivery_at) VALUES($1,$2,$3,$4,'delivery',now()) ON CONFLICT(bot_id,user_id) DO UPDATE SET can_contact=EXCLUDED.can_contact,client_language=COALESCE(EXCLUDED.client_language,bot_contacts.client_language),last_seen_at=now(),last_delivery_at=now(),source='delivery'`,[botId,userId,allowed,language??null]);
 // An explicit private interaction after a rejection must reset contactability immediately.
 cache.invalidate(`${botId}:${userId}`);
}
export async function rememberBlockedContact(botId:number,userId:number){
 await query(`INSERT INTO bot_contacts(bot_id,user_id,can_contact,source) VALUES($1,$2,false,'blocked_update') ON CONFLICT(bot_id,user_id) DO UPDATE SET can_contact=false,last_seen_at=now(),source='blocked_update'`,[botId,userId]);
 cache.invalidate(`${botId}:${userId}`);
}
