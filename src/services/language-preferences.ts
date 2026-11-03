import {one,query} from '../db/pool.js';
import {ReadCache} from './read-cache.js';
import type {AppContext} from '../bot/context.js';
import {getChat} from '../db/repositories/chats.js';
import {normalizeBotLanguage} from './bot-i18n.js';

const cache=new ReadCache(5000);
export async function contextLanguage(ctx:AppContext):Promise<string>{
 if(ctx.app.chatRow)return ctx.app.settings.language;
 const payload=ctx.callbackQuery?.data??ctx.message?.text??'';
 const join=payload.match(/^jg:([a-f0-9]{24}):/);
 if(join&&ctx.from){const row=await one<{language:string}>("SELECT c.settings->>'language' AS language FROM join_challenges j JOIN chats c ON c.chat_id=j.chat_id WHERE j.token=$1 AND j.user_id=$2",[join[1],ctx.from.id]);if(row?.language)return row.language;}
 const chat=payload.match(/(?:^|[_:])(-\d{5,})(?:$|[:_])/);
 if(chat){const row=await getChat(Number(chat[1]));if(row)return row.settings.language??'es';}
 if(!ctx.from)return 'es';
 const saved=await cache.get(String(ctx.from.id),60000,async()=>one<{bot_language:string|null}>('SELECT bot_language FROM users WHERE user_id=$1',[ctx.from!.id]),String(ctx.from.id));
 return normalizeBotLanguage(saved?.bot_language??ctx.from.language_code);
}
export async function savePrivateLanguage(ctx:AppContext,language:string){
 if(!ctx.from||ctx.chat?.type!=='private')return;
 await query("INSERT INTO users(user_id,first_name,bot_language) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET bot_language=EXCLUDED.bot_language",[ctx.from.id,ctx.from.first_name,normalizeBotLanguage(language)]);cache.invalidate(String(ctx.from.id));
}
