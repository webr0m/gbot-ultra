import { tr } from "./bot-i18n.js";
import { config } from '../config.js';
import { isGbanned } from '../db/repositories/filters.js';
import { ReadCache } from './read-cache.js';
import { checkCas } from './cas.js';
let local=new ReadCache(10000);
export function invalidateGlobalBan(userId?:number):void{if(userId!==undefined)local.invalidate(String(userId));else local=new ReadCache(10000);}
export async function globalBan(userId:number):Promise<{banned:boolean;source?:'local'|'cas';reason?:string;checkedAt?:string}>{
 if(config.ownerIds.has(userId))return {banned:false};
 // Other hosting processes can change this list; bound cross-process delay.
 const own=await local.get(String(userId),15000,()=>isGbanned(userId),String(userId));
 if(own)return {banned:true,source:'local',reason:own.reason??tr("Baneo global de GBot")};
 const cas=await checkCas(userId);return cas.status==='banned'?{banned:true,source:'cas',reason:tr("Registro externo de spam en CAS"),checkedAt:cas.checkedAt}:{banned:false};
}
