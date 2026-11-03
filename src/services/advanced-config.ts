import { z } from 'zod';
import { many, one, withTransaction } from '../db/pool.js';
import type { ChatRow } from '../db/types.js';
import { hasFeature, type AdvancedFeature } from './entitlements.js';
import { ReadCache } from './read-cache.js';

export const CONTENT_TYPES = ['sticker','gif','voice','audio','video','photo','document','forward','invite','anonymous','poll'] as const;
export const TRUST_SCOPES = ['locks','raid','captcha','blacklist','antilink','antiflood'] as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const zone = z.string().max(80).refine(value => {try {new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Zona horaria no válida');
export const advancedSchema = z.object({
 raid: z.object({enabled:z.boolean(), threshold:z.number().int().min(3).max(500), windowSeconds:z.number().int().min(10).max(300), durationSeconds:z.number().int().min(60).max(86400), action:z.enum(['captcha','mute','ban']), sanctionSeconds:z.number().int().min(60).max(86400)}),
 locks: z.object({enabled:z.boolean(), types:z.array(z.enum(CONTENT_TYPES)).max(11), action:z.enum(['delete','warn','mute','ban']), durationSeconds:z.number().int().min(60).max(2592000)}),
 warningExpiry: z.object({days:z.number().int().min(0).max(365)}),
 night: z.object({enabled:z.boolean(), timezone:zone, start:time, end:time, days:z.array(z.number().int().min(0).max(6)).min(1).max(7)}),
 filters:z.object({enabled:z.boolean()}),
 topics:z.object({welcomeThreadId:z.number().int().min(0), logThreadId:z.number().int().min(0)}),
 silent:z.object({enabled:z.boolean()}),
 joinGate:z.object({enabled:z.boolean(), mode:z.enum(['button','math'])}),
 richNotes:z.object({enabled:z.boolean()}),
 observation:z.object({enabled:z.boolean()}),
}).strict().refine(v => !v.night.enabled || v.night.start !== v.night.end,{message:'El inicio y el fin del horario deben ser distintos'});
export type AdvancedSettings = z.infer<typeof advancedSchema>;
export const ADVANCED_DEFAULTS: AdvancedSettings = {
 raid:{enabled:false,threshold:15,windowSeconds:60,durationSeconds:900,action:'captcha',sanctionSeconds:600},
 locks:{enabled:false,types:[],action:'delete',durationSeconds:600}, warningExpiry:{days:0},
 night:{enabled:false,timezone:'America/Santiago',start:'23:00',end:'07:00',days:[0,1,2,3,4,5,6]},
 filters:{enabled:false},topics:{welcomeThreadId:0,logThreadId:0},silent:{enabled:false},joinGate:{enabled:false,mode:'math'},richNotes:{enabled:false},observation:{enabled:false},
};
export function normalizeAdvanced(raw: unknown): AdvancedSettings {
 const merged=structuredClone(ADVANCED_DEFAULTS);
 if(raw && typeof raw==='object')for(const key of Object.keys(merged) as (keyof AdvancedSettings)[])Object.assign(merged[key],(raw as Record<string,object>)[key]??{});
 const parsed=advancedSchema.safeParse(merged);return parsed.success?parsed.data:structuredClone(ADVANCED_DEFAULTS);
}
type ConfigRecord = {settings:AdvancedSettings;version:number;actorId?:number};
// Small bounded coalescing cache, invalidated by every write; cross-process TTL 10s.
const cache=new ReadCache(2000);
export async function advancedConfig(chatId:number):Promise<ConfigRecord>{
 return cache.get('config:'+chatId,10000,async()=>{const row=await one<{settings:unknown;version:number;updated_by:number}>('SELECT settings,version,updated_by FROM advanced_config WHERE chat_id=$1',[chatId]);return {settings:normalizeAdvanced(row?.settings),version:row?.version??0,actorId:row?.updated_by};},String(chatId));
}
export function invalidateAdvanced(chatId:number):void{cache.invalidate(String(chatId));}
export function effectiveAdvanced(chat:ChatRow,settings:AdvancedSettings,actorId?:number):AdvancedSettings{
 const result=structuredClone(settings);
 for(const key of Object.keys(result) as (keyof AdvancedSettings)[]){if(!hasFeature(chat,key as AdvancedFeature,actorId))(result as Record<string,unknown>)[key]=structuredClone(ADVANCED_DEFAULTS[key]);}
 return result;
}
export async function saveAdvanced(chat:ChatRow,raw:unknown,actorId:number,version:number):Promise<ConfigRecord>{
 const parsed=advancedSchema.parse(raw);
 const current=await advancedConfig(chat.chat_id);
 for(const key of Object.keys(parsed) as (keyof AdvancedSettings)[]){
  if(JSON.stringify(parsed[key])!==JSON.stringify(current.settings[key])&&!hasFeature(chat,key as AdvancedFeature,actorId))throw Object.assign(new Error('Esta función requiere un nivel Premium superior.'),{statusCode:402});
 }
 if(parsed.silent.enabled && (!chat.settings.logs?.enabled || !chat.settings.logs.chatId))throw Object.assign(new Error('Configura un canal de registros antes de activar la moderación silenciosa.'),{statusCode:400});
 const saved=await withTransaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock($1)',[chat.chat_id]);
  const row=(await client.query('SELECT version FROM advanced_config WHERE chat_id=$1 FOR UPDATE',[chat.chat_id])).rows[0];
  if((row?.version??0)!==version)throw Object.assign(new Error('Otro administrador cambió estos ajustes. Recarga antes de guardar.'),{statusCode:409});
  const next=version+1;
  if(!version)await client.query('INSERT INTO advanced_history(chat_id,version,actor_id,settings) VALUES($1,0,$2,$3::jsonb) ON CONFLICT DO NOTHING',[chat.chat_id,actorId,JSON.stringify(ADVANCED_DEFAULTS)]);
  await client.query('INSERT INTO advanced_config(chat_id,settings,version,updated_by) VALUES($1,$2::jsonb,$3,$4) ON CONFLICT(chat_id) DO UPDATE SET settings=EXCLUDED.settings,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,updated_at=now()',[chat.chat_id,JSON.stringify(parsed),next,actorId]);
  await client.query('INSERT INTO advanced_history(chat_id,version,actor_id,settings) VALUES($1,$2,$3,$4::jsonb)',[chat.chat_id,next,actorId,JSON.stringify(parsed)]);
  return {settings:parsed,version:next,actorId};
 });invalidateAdvanced(chat.chat_id);return saved;
}
export async function trustedScopes(chatId:number,userId:number):Promise<string[]>{
 return cache.get('trust:'+chatId+':'+userId,5000,async()=>{const row=await one<{scopes:string[]}>('SELECT scopes FROM trusted_users WHERE chat_id=$1 AND user_id=$2 AND (expires_at IS NULL OR expires_at>now())',[chatId,userId]);return row?.scopes??[];},String(chatId));
}
