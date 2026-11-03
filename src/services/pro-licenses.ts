import type { Api } from 'grammy';
import { many, one, query, withTransaction } from '../db/pool.js';
import { invalidateChat } from './chat-cache.js';
import { getChatMemberSafe } from '../utils/telegram.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
export async function licenseOverview(ownerId:number){
 const total=await one<{slots:number}>('SELECT COALESCE(SUM(slots),0)::int AS slots FROM pro_licenses WHERE owner_id=$1',[ownerId]);
 const groups=await many<{chat_id:number;title:string;active:boolean}>('SELECT chat_id,title,active FROM chats WHERE pro_owner_id=$1 AND pro_license_id IS NOT NULL ORDER BY title',[ownerId]);return {slots:total?.slots??0,used:groups.length,groups};
}
export async function eligibleLicenseAdmin(api:Api,chatId:number,ownerId:number):Promise<boolean>{
 const member=await getChatMemberSafe(api,chatId,ownerId);
 if(!member)throw new Error('No se pudo comprobar el administrador; se conserva la licencia.');
 return member?.status==='creator'||(member?.status==='administrator'&&(member.can_restrict_members||member.can_delete_messages));
}
export async function assignProLicense(api:Api,chatId:number,ownerId:number):Promise<void>{
 if(config.ownerIds.has(ownerId))return; // The global role needs no purchased license or slots.
 if(!await eligibleLicenseAdmin(api,chatId,ownerId))throw Object.assign(new Error('Debes administrar el grupo con permiso de borrar o restringir.'),{statusCode:403});
 await withTransaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock($1)',[ownerId]);
  const chat=(await c.query('SELECT * FROM chats WHERE chat_id=$1 AND active FOR UPDATE',[chatId])).rows[0];if(!chat)throw Object.assign(new Error('Grupo no disponible.'),{statusCode:404});
  if(chat.pro_license_id){if(chat.pro_owner_id===ownerId)return;throw Object.assign(new Error('Este grupo ya usa la licencia de otro propietario.'),{statusCode:409});}
  const license=(await c.query('SELECT l.id FROM pro_licenses l WHERE l.owner_id=$1 AND (SELECT COUNT(*) FROM chats c WHERE c.pro_license_id=l.id)<l.slots ORDER BY l.id LIMIT 1',[ownerId])).rows[0];
  if(!license)throw Object.assign(new Error('No tienes cupos Pro libres. Libera un grupo o compra otra licencia.'),{statusCode:402});
  await c.query('UPDATE chats SET pro_license_id=$2,pro_owner_id=$3,updated_at=now() WHERE chat_id=$1',[chatId,license.id,ownerId]);
 });invalidateChat(chatId);
}
export async function releaseProLicense(chatId:number,ownerId:number):Promise<void>{
 const result=await query('UPDATE chats SET pro_license_id=NULL,pro_owner_id=NULL,updated_at=now() WHERE chat_id=$1 AND pro_owner_id=$2 RETURNING chat_id',[chatId,ownerId]);
 if(!result.rowCount)throw Object.assign(new Error('No eres el propietario de la licencia de este grupo.'),{statusCode:403});invalidateChat(chatId);
}
export async function createProLicense(ownerId:number,chargeId:string|null):Promise<{duplicate:boolean}>{
 const result=await query('INSERT INTO pro_licenses(owner_id,charge_id) VALUES($1,$2) ON CONFLICT(charge_id) DO NOTHING RETURNING id',[ownerId,chargeId]);return {duplicate:!result.rowCount};
}
export async function purchaseProLicense(ownerId:number,chargeId:string|null,chatId:number,amount:number,payload:string|null):Promise<{duplicate:boolean}>{
 return withTransaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock($1)',[ownerId]);
  const license=await c.query('INSERT INTO pro_licenses(owner_id,charge_id) VALUES($1,$2) ON CONFLICT(charge_id) DO NOTHING RETURNING id',[ownerId,chargeId]);
  if(!license.rowCount)return {duplicate:true};
  await c.query("INSERT INTO payments(charge_id,user_id,chat_id,amount,currency,plan,days,payload) VALUES($1,$2,$3,$4,'XTR','pro',0,$5)",[chargeId,ownerId,chatId,amount,payload]);
  return {duplicate:false};
 });
}
export async function validateProLicenses(api:Api):Promise<void>{
 const groups=await many<{chat_id:number;pro_owner_id:number}>('SELECT chat_id,pro_owner_id FROM chats WHERE pro_license_id IS NOT NULL');
 for(const group of groups){
  try{if(!await eligibleLicenseAdmin(api,group.chat_id,group.pro_owner_id))await releaseProLicense(group.chat_id,group.pro_owner_id);}
  catch(error){logger.warn({err:error,chatId:group.chat_id},'No se pudo revisar licencia Pro; se conserva hasta la próxima revisión');}
 }
}
