import { describe,it,expect,vi } from 'vitest';
vi.mock('../src/config.js',()=>({config:{ownerIds:new Set([900000001]),captchaTimeoutSeconds:300,logLevel:'silent',databaseUrl:''}}));
import { ADVANCED_DEFAULTS, advancedSchema, effectiveAdvanced } from '../src/services/advanced-config.js';
import { chatTier, hasFeature } from '../src/services/entitlements.js';
import { contentMatch, contentRule, isNight, responseMatches } from '../src/services/advanced-engine.js';
import { contentExample } from '../src/services/message-content.js';
import { articleExtrasSchema, articleMessage } from '../src/services/rich-articles.js';
import { getPlan, getPremiumStatus } from '../src/services/premium.js';
import { premiumStatusText } from '../src/bot/texts.js';
import { antispamHits } from '../src/services/antispam.js';
import { DEFAULT_SETTINGS } from '../src/services/settings.js';
const active=(tier?:string)=>({premium_until:new Date(Date.now()+86400000),premium_tier:tier}) as never;
describe('Premium entitlements',()=>{
 it('publishes Pro lifetime for ten groups and Ultra monthly at 135 Stars',()=>{expect(getPlan('pro')).toMatchObject({stars:135,groups:10,days:0,kind:'license'});expect(getPlan('ultra')).toMatchObject({stars:135,groups:1,days:30,tier:'ultra'});});
 it('preserves all advanced rights of active legacy subscriptions',()=>{expect(chatTier(active())).toBe('ultra');expect(hasFeature(active(),'alliances')).toBe(true);});
 it.each(['premium','pro','ultra'])('does not accept an expired %s subscription',tier=>{expect(chatTier({premium_until:new Date(0),premium_tier:tier})).toBe('free');});
 it('requires the proper feature tier and exempts the Developer',()=>{expect(hasFeature(active('premium'),'raid')).toBe(true);expect(hasFeature(active('premium'),'night')).toBe(false);expect(hasFeature(active('pro'),'night')).toBe(true);expect(hasFeature(active('pro'),'alliances')).toBe(false);expect(hasFeature(null,'alliances',900000001)).toBe(true);});
 it('disables stored automations after a downgrade while keeping their configuration',()=>{const raw=structuredClone(ADVANCED_DEFAULTS);raw.night.enabled=true;raw.raid.enabled=true;const effective=effectiveAdvanced(active('premium'),raw);expect(effective.raid.enabled).toBe(true);expect(effective.night.enabled).toBe(false);expect(raw.night.enabled).toBe(true);});
 it('permits Developer-managed rules in a free test group',()=>{const raw=structuredClone(ADVANCED_DEFAULTS);raw.raid.enabled=true;expect(effectiveAdvanced({premium_until:null} as never,raw,900000001).raid.enabled).toBe(true);});
 it('gives the Developer permanent complete access without any subscription or license',()=>{const chat={premium_until:new Date(0),premium_tier:'free',pro_license_id:null};for(const feature of ['raid','night','alliances','observation'] as const)expect(hasFeature(chat,feature,900000001)).toBe(true);expect(chatTier(chat,900000001)).toBe('ultra');});
 it('keeps a permanent Pro license without a subscription and falls back to it when a subscription expires',()=>{const pro={premium_until:null,premium_tier:null,pro_license_id:7} as never;expect(chatTier(pro)).toBe('pro');expect(hasFeature(pro,'night')).toBe(true);expect(hasFeature(pro,'alliances')).toBe(false);expect(chatTier({premium_until:new Date(0),premium_tier:'ultra',pro_license_id:7} as never)).toBe('pro');expect(chatTier({premium_until:new Date(Date.now()+86400000),premium_tier:'premium',pro_license_id:7} as never)).toBe('pro');expect(getPremiumStatus({premium_until:null,premium_plan:null,pro_license_id:7} as never)).toMatchObject({active:true,plan:'pro',until:null,daysLeft:0});});
 it('does not show a zero-day countdown for permanent Pro licenses',()=>{const text=premiumStatusText('Grupo',true,'Pro permanente · 10 grupos','—',0);expect(text).toContain('Sin vencimiento');expect(text).not.toContain('Quedan');});
});
describe('Shared text rules',()=>{
 const enabled=()=>{const s=structuredClone(DEFAULT_SETTINGS) as any;s.blacklist.enabled=true;s.antilink.enabled=true;s.antiflood.enabled=true;return s;};
 const message=(text:string)=>({text,entities:[]}) as never;
 const rows=[{pattern:'spam',is_regex:false}] as never;
 it('reports blacklist, antilink and antiflood in application order',()=>{expect(antispamHits(message('spam https://evil.example'),enabled(),rows,99).map(h=>h.rule)).toEqual(['blacklist','antilink','antiflood']);});
 it('ignores whitelisted domains and disabled rules',()=>{const s=enabled();s.antilink.whitelist=['example.org'];expect(antispamHits(message('https://www.example.org/x'),s,[],0)).toEqual([]);s.antiflood.enabled=false;expect(antispamHits(message('hola'),s,[],999)).toEqual([]);});
 it('triggers antiflood exactly at the configured limit',()=>{const s=enabled();s.blacklist.enabled=false;s.antilink.enabled=false;expect(antispamHits(message('hola'),s,[],s.antiflood.limit-1)).toEqual([]);expect(antispamHits(message('hola'),s,[],s.antiflood.limit)[0]).toMatchObject({rule:'antiflood',action:'mute'});});
});
describe('Rule evaluation',()=>{
 it('evaluates individual forwarding actions without treating a hidden author as a bot',()=>{
  const s=structuredClone(ADVANCED_DEFAULTS);s.forwarding.actions={bot:'delete',channel:'warn',person:'mute'};
  for(const [origin,action] of [['bot','delete'],['channel','warn'],['person','mute']] as const){
   const type=contentMatch(contentExample('Texto','forward',origin),s);
   expect(type).toBe('forward:'+origin);
   expect(contentRule(s,type!).action).toBe(action);
  }
  expect(contentMatch(contentExample('Texto','forward','hidden_user'),s)).toBeNull();
 });
 it('matches AND terms, treats regex punctuation literally and counts visible Unicode text',()=>{
  const s=structuredClone(ADVANCED_DEFAULTS);s.textLimits.patterns='foo*bar && sale+\notro';
  expect(contentMatch({text:'SALE+ ahora FOO...BAR'},s)).toBe('text_pattern');
  expect(contentMatch({text:'SALE ahora FOO...BAR'},s)).toBeNull();
  expect(contentMatch({text:'SALE+ ahora FOO...BAR'},s,true)).toBeNull();
  s.textLimits.maxLength=3;
  expect(contentMatch({text:'🧉🧉🧉'},s)).toBeNull();
  expect(contentMatch(contentExample('🧉🧉🧉🧉','rich_message'),s)).toBe('text_length');
 });
 it('keeps the added fields disabled when reading a previous release configuration',()=>{
  const {probation,forwarding,textLimits,richArticles,discussion,...legacy}=ADVANCED_DEFAULTS;
  expect(advancedSchema.parse(legacy)).toEqual(ADVANCED_DEFAULTS);
 });
 it('builds native rich message blocks from validated plain values',()=>{
  const extras=articleExtrasSchema.parse({heading:'Agenda',table:[['Hora','Actividad'],['9','Inicio']],gallery:['https://example.org/photo.jpg']});
  expect(articleMessage('<strong>literal</strong>',extras).blocks).toMatchObject([
   {type:'heading',text:'Agenda'},{type:'paragraph',text:'<strong>literal</strong>'},
   {type:'table',cells:[[{text:'Hora',is_header:true},{text:'Actividad',is_header:true}],[{text:'9'},{text:'Inicio'}]]},
   {type:'collage',blocks:[{type:'photo',photo:{media:'https://example.org/photo.jpg'}}]},
  ]);
  expect(articleExtrasSchema.safeParse({table:[['a','b'],['c']]}).success).toBe(false);
  expect(articleExtrasSchema.safeParse({gallery:['https://user:secret@example.org/photo.jpg']}).success).toBe(false);
 });
 it.each([['sticker',{sticker:{}}],['gif',{animation:{}}],['voice',{voice:{}}],['forward',{forward_origin:{}}],['anonymous',{sender_chat:{}}],['invite',{text:'https://t.me/+invite'}]] as const)('detects %s content without API calls',(type,message)=>{const s=structuredClone(ADVANCED_DEFAULTS);s.locks.enabled=true;s.locks.types=[type];expect(contentMatch(message as never,s)).toBe(type);});
 it('does not block unmatched types or disabled rules',()=>{const s=structuredClone(ADVANCED_DEFAULTS);s.locks.types=['photo'];expect(contentMatch({photo:[]} as never,s)).toBeNull();s.locks.enabled=true;expect(contentMatch({text:'Hola'},s)).toBeNull();});
 it('uses word boundaries, normalized case and exact/prefix distinctions',()=>{expect(responseMatches({mode:'word',trigger:'hola'},'¡HOLA!')).toBe(true);expect(responseMatches({mode:'word',trigger:'hola'},'holanda')).toBe(false);expect(responseMatches({mode:'exact',trigger:'horario'},'horario hoy')).toBe(false);expect(responseMatches({mode:'prefix',trigger:'horario'},'HORARIO hoy')).toBe(true);});
 it('rejects unknown keys, invalid timezones and ambiguous all-day schedules',()=>{expect(advancedSchema.safeParse({...ADVANCED_DEFAULTS,unexpected:true}).success).toBe(false);const s=structuredClone(ADVANCED_DEFAULTS);s.night.timezone='Invalid/Zone';expect(advancedSchema.safeParse(s).success).toBe(false);s.night.timezone='UTC';s.night.enabled=true;s.night.end=s.night.start;expect(advancedSchema.safeParse(s).success).toBe(false);});
});
describe('Night schedules',()=>{
 const n={enabled:true,timezone:'UTC',start:'23:00',end:'07:00',days:[1]};
 it('attributes an overnight interval to its starting weekday',()=>{expect(isNight(n,new Date('2026-11-02T23:15:00Z'))).toBe(true);expect(isNight(n,new Date('2026-11-03T06:59:00Z'))).toBe(true);expect(isNight(n,new Date('2026-11-03T07:00:00Z'))).toBe(false);expect(isNight(n,new Date('2026-11-02T06:00:00Z'))).toBe(false);});
 it('uses the actual timezone across a repeated DST hour',()=>{const s={...n,timezone:'America/New_York',days:[0],start:'01:00',end:'02:00'};expect(isNight(s,new Date('2026-11-01T05:30:00Z'))).toBe(true);expect(isNight(s,new Date('2026-11-01T06:30:00Z'))).toBe(true);expect(isNight(s,new Date('2026-11-01T07:00:00Z'))).toBe(false);});
});
