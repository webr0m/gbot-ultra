import { pool, one, query, withDatabaseConnection } from '../db/pool.js';
/** Keep the advisory lock across the external action. An interrupted operation
 * remains uncertain and is never retried automatically (Telegram has no transaction). */
export async function onceOperation<T>(key:string,run:()=>Promise<T>):Promise<T>{
 const client=await pool.connect();
 try{
  await client.query('SELECT pg_advisory_lock(hashtext($1))',[key]);
  const existing=(await client.query('SELECT state,result FROM operation_receipts WHERE key=$1',[key])).rows[0];
  if(existing?.state==='done')return existing.result as T;
  if(existing)throw Object.assign(new Error('Esta operación quedó pendiente de revisión; comprueba el registro antes de repetirla.'),{statusCode:409});
  const parts=key.split(':'),candidate=parts[0]==='alliance'?parts[2]:parts[1];
  const chatId=/^-\d+$/.test(candidate??'')&&Number.isSafeInteger(Number(candidate))?Number(candidate):null;
  await client.query("INSERT INTO operation_receipts(key,state,chat_id) VALUES($1,'pending',$2)",[key,chatId]);
  try{const result=await withDatabaseConnection(client,run);await client.query("UPDATE operation_receipts SET state='done',result=$2::jsonb,completed_at=now() WHERE key=$1",[key,JSON.stringify(result??null)]);return result;}
  catch(error){await client.query("UPDATE operation_receipts SET state='uncertain' WHERE key=$1",[key]);throw error;}
 }finally{try{await client.query('SELECT pg_advisory_unlock(hashtext($1))',[key]);}finally{client.release();}}
}
