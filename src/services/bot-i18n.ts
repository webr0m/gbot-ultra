import {AsyncLocalStorage} from 'node:async_hooks';
import messages from '../i18n/bot-messages.json' with {type:'json'};

export const BOT_LANGUAGES=['es','en','pt','fr','de','it','ru','tr','ar','zh'] as const;
export type BotLanguage=typeof BOT_LANGUAGES[number];
const context=new AsyncLocalStorage<BotLanguage>();
const catalog=messages as Record<string,Record<string,string>>;
export function normalizeBotLanguage(value:string|undefined|null):BotLanguage{
 const code=(value||'es').toLowerCase().split(/[-_]/)[0];return BOT_LANGUAGES.includes(code as BotLanguage)?code as BotLanguage:'es';
}
export const botLanguage=()=>context.getStore()??'es';
export function withBotLanguage<T>(language:string|undefined|null,run:()=>T):T{return context.run(normalizeBotLanguage(language),run);}
/** Only explicit static message keys enter the catalog. Interpolated/user content is never translated. */
export function tr(message:string,values:unknown[]=[],language:string=botLanguage()):string{
 const translated=catalog[normalizeBotLanguage(language)]?.[message]??message;
 return translated.replace(/\{(\d+)\}/g,(placeholder,index)=>Number(index)<values.length?String(values[Number(index)]):placeholder);
}
