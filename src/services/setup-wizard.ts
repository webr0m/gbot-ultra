import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {Api} from 'grammy';
import {config} from '../config.js';
import {withTransaction} from '../db/pool.js';
import type {ChatRow,GroupSettings} from '../db/types.js';
import {advancedConfig,ADVANCED_DEFAULTS,normalizeAdvanced,invalidateAdvanced,type AdvancedSettings} from './advanced-config.js';
import {settingsOf,primeChat} from './chat-cache.js';
import {applySettingsPatch,mergeSettings,type SettingsPatch} from './settings.js';
import {hasFeature} from './entitlements.js';
import {assertActorRight} from './moderation.js';
import {getChatMemberSafe} from '../utils/telegram.js';

const fail=(message:string,statusCode=400):never=>{throw Object.assign(new Error(message),{statusCode});};
export const SETUP_PROFILES=[
 {id:'balanced',name:'Protección equilibrada',tier:'free',description:'Captcha de botón, antienlaces con borrado y antiflood moderado.'},
 {id:'community',name:'Comunidad activa',tier:'pro',description:'Más margen para conversar, antirraids y bloqueo de invitaciones.'},
 {id:'strict',name:'Acceso vigilado',tier:'pro',description:'Umbrales de spam más bajos y bloqueo de reenvíos e invitaciones. Revisa posibles falsos positivos.'},
] as const;
type Profile=typeof SETUP_PROFILES[number]['id'];
export function setupTarget(settings:GroupSettings,advanced:AdvancedSettings,profile:Profile){
 const patch:SettingsPatch={captcha:{enabled:true,mode:'button'},antilink:{enabled:true,action:'delete'},antiflood:{enabled:true,limit:profile==='community'?12:profile==='strict'?5:8,windowSeconds:10,muteSeconds:600},reports:{enabled:true},warnings:{enabled:true}};
 const next=applySettingsPatch(settings,patch,true);if(!next.settings)fail('No se pudo preparar el perfil.');
 const target=structuredClone(advanced);
 if(profile!=='balanced'){
  target.raid={...target.raid,enabled:true,threshold:profile==='strict'?10:30,windowSeconds:60,action:'captcha'};
  target.locks={...target.locks,enabled:true,types:[...new Set([...target.locks.types,...(profile==='strict'?['invite','forward'] as const:['invite'] as const)])],action:'delete'};
 }
 return {settings:next.settings!,advanced:target};
}
export function setupDiff(before:unknown,after:unknown,prefix=''): {path:string;before:unknown;after:unknown}[]{
 if(JSON.stringify(before)===JSON.stringify(after))return [];
 if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after))return Object.keys(after).flatMap(k=>setupDiff((before as Record<string,unknown>)[k],(after as Record<string,unknown>)[k],prefix?prefix+'.'+k:k));
 return [{path:prefix,before,after}];
}
const fingerprint=(settings:GroupSettings,advanced:AdvancedSettings,version:number)=>createHash('sha256').update(JSON.stringify({settings,advanced,version})).digest('hex');
const sign=(value:string)=>createHmac('sha256',config.botToken).update('setup-v1:'+value).digest('base64url');
function parseToken(token:string){
 const [data,signature]=token.split('.'),expected=sign(data||'');
 if(!signature||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return fail('La vista previa no es válida.',403);
 try{const value=JSON.parse(Buffer.from(data,'base64url').toString());if(!value.expires||value.expires<Date.now())fail('La vista previa venció. Revisa el perfil nuevamente.',409);return value as {chatId:number;actorId:number;profile:Profile;hash:string;expires:number};}catch(error){if((error as {statusCode?:number}).statusCode)throw error;return fail('La vista previa no es válida.');}
}
function profileAccess(chat:ChatRow,actorId:number,profile:string){
 if(!SETUP_PROFILES.some(p=>p.id===profile))fail('Perfil no válido.');
 if(profile!=='balanced'&&!hasFeature(chat,'setupProfiles',actorId))fail('Los perfiles avanzados requieren Pro o Ultra.',402);
}
export async function setupDiagnostics(api:Api,botId:number,chat:ChatRow,actorId:number){
 const member=await getChatMemberSafe(api,chat.chat_id,botId),rights=member as unknown as Record<string,unknown>|null;
 const checks=[['administrator','Administrador del grupo',member?.status==='administrator'||member?.status==='creator'],['can_delete_messages','Eliminar mensajes',rights?.can_delete_messages===true||member?.status==='creator'],['can_restrict_members','Restringir miembros',rights?.can_restrict_members===true||member?.status==='creator'],['can_invite_users','Gestionar solicitudes',rights?.can_invite_users===true||member?.status==='creator']].map(([id,label,ok])=>({id,label,ok}));
 return {checks,profiles:SETUP_PROFILES.map(p=>({...p,allowed:p.tier==='free'||hasFeature(chat,'setupProfiles',actorId)})),language:settingsOf(chat).language};
}
export async function setupPreview(chat:ChatRow,actorId:number,profile:Profile){
 profileAccess(chat,actorId,profile);
 const advanced=await advancedConfig(chat.chat_id),settings=settingsOf(chat),target=setupTarget(settings,advanced.settings,profile);
 const data=Buffer.from(JSON.stringify({chatId:chat.chat_id,actorId,profile,hash:fingerprint(settings,advanced.settings,advanced.version),expires:Date.now()+10*60000})).toString('base64url');
 return {profile,diff:setupDiff({settings,advanced:advanced.settings},target),token:data+'.'+sign(data),notice:'Se conservan tus textos, multimedia, listas permitidas, destinos de registros, temas y horarios. IA y NSFW no se activan con estos perfiles.'};
}
export async function applySetup(api:Api,botId:number,chat:ChatRow,actorId:number,token:string){
 const preview=parseToken(token);
 if(preview.chatId!==chat.chat_id||preview.actorId!==actorId)fail('La vista previa pertenece a otra sesión o grupo.',403);
 profileAccess(chat,actorId,preview.profile);
 const context={api,botId,chatId:chat.chat_id,chat,settings:settingsOf(chat),actorId,actorName:'Administrador'};
 for(const right of ['can_change_info','can_delete_messages','can_restrict_members'])await assertActorRight(context,right);
 const diagnostics=await setupDiagnostics(api,botId,chat,actorId);
 if(diagnostics.checks.slice(0,3).some(c=>!c.ok))fail('Faltan permisos del bot. Corrígelos en Telegram antes de aplicar.',409);
 const result=await withTransaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock($1)',[chat.chat_id]);
  const current=(await client.query<ChatRow>('SELECT * FROM chats WHERE chat_id=$1 FOR UPDATE',[chat.chat_id])).rows[0];if(!current?.active)fail('El grupo no está disponible.',404);
  profileAccess(current,actorId,preview.profile);
  const tokenHash=createHash('sha256').update(token).digest('hex');
  if((await client.query('SELECT 1 FROM setup_applications WHERE token_hash=$1',[tokenHash])).rowCount)return {row:current,repeated:true};
  const a=(await client.query('SELECT * FROM advanced_config WHERE chat_id=$1 FOR UPDATE',[chat.chat_id])).rows[0],settings=settingsOf(current),advanced=normalizeAdvanced(a?.settings),version=a?.version??0;
  if(fingerprint(settings,advanced,version)!==preview.hash)fail('Otro administrador cambió los ajustes. Genera otra vista previa.',409);
  const target=setupTarget(settings,advanced,preview.profile),nextVersion=version+1;
  const row=(await client.query<ChatRow>('UPDATE chats SET settings=$2::jsonb,updated_at=now() WHERE chat_id=$1 RETURNING *',[chat.chat_id,JSON.stringify(target.settings)])).rows[0];
  if(JSON.stringify(target.advanced)!==JSON.stringify(advanced)){
   if(!version)await client.query('INSERT INTO advanced_history(chat_id,version,actor_id,settings) VALUES($1,0,$2,$3::jsonb) ON CONFLICT DO NOTHING',[chat.chat_id,actorId,JSON.stringify(ADVANCED_DEFAULTS)]);
   await client.query('INSERT INTO advanced_config(chat_id,settings,version,updated_by) VALUES($1,$2::jsonb,$3,$4) ON CONFLICT(chat_id) DO UPDATE SET settings=EXCLUDED.settings,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,updated_at=now()',[chat.chat_id,JSON.stringify(target.advanced),nextVersion,actorId]);
   await client.query('INSERT INTO advanced_history(chat_id,version,actor_id,settings) VALUES($1,$2,$3,$4::jsonb)',[chat.chat_id,nextVersion,actorId,JSON.stringify(target.advanced)]);
  }
  await client.query('INSERT INTO setup_applications(token_hash,chat_id,actor_id,profile) VALUES($1,$2,$3,$4)',[tokenHash,chat.chat_id,actorId,preview.profile]);
  await client.query("INSERT INTO moderation_log(chat_id,actor_id,action,reason,metadata) VALUES($1,$2,'setup_profile',$3,$4::jsonb)",[chat.chat_id,actorId,preview.profile,JSON.stringify({changes:setupDiff({settings,advanced},target).map(d=>d.path)})]);
  return {row,repeated:false};
 });
 primeChat(result.row);invalidateAdvanced(chat.chat_id);return {ok:true,repeated:result.repeated};
}
