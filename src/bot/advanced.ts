import { tr } from "../services/bot-i18n.js";
import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { AppContext } from './context.js';
import { config } from '../config.js';
import { getChat } from '../db/repositories/chats.js';
import { one, query } from '../db/pool.js';
import { advancedConfig, saveAdvanced } from '../services/advanced-config.js';
import { hasFeature, ADVANCED_FEATURES, type AdvancedFeature } from '../services/entitlements.js';
import { advancedDataCache, deliverRichNote, getRichNote, verifyJoinGate } from '../services/advanced-engine.js';
import { assertActorRight } from '../services/moderation.js';
import { getChatMemberSafe, isAdminStatus } from '../utils/telegram.js';
import { ensureGroupAdmin, replyTemp } from './middleware.js';
import { showPanel } from './panel.js';
const commands:Record<string,AdvancedFeature>={antiraid:'raid',locks:'locks',trust:'trust',untrust:'trust',filters:'filters',night:'night',alliances:'alliances',topics:'topics',saverich:'richNotes',simulate:'observation',schedule:'scheduledPosts',nsfw:'nsfw'};
export function registerAdvancedBot(bot:Bot<AppContext>):void{
 bot.callbackQuery(/^jg:([a-f0-9]{24}):(ok|\d+)$/,async ctx=>{
  const result=await verifyJoinGate(ctx.api,ctx.match[1]!,ctx.from.id,ctx.match[2]!);
  await ctx.answerCallbackQuery({text:result.slice(0,190),show_alert:true});
  if(result.startsWith('✅'))await ctx.editMessageReplyMarkup({reply_markup:new InlineKeyboard()}).catch(()=>undefined);
 });
 bot.command('start',async(ctx,next)=>{
  const match=/^note_(-\d+)_([a-z0-9_]{1,32})$/.exec(String(ctx.match??''));if(!match||ctx.chat.type!=='private'||!ctx.from)return next();
  const chat=await getChat(Number(match[1]));if(!chat?.active){await ctx.reply(tr("Esta nota ya no está disponible."));return;}
  if(!config.ownerIds.has(ctx.from.id)){const member=await getChatMemberSafe(ctx.api,chat.chat_id,ctx.from.id);if(!member||!(['member','creator','administrator'].includes(member.status)||(member.status==='restricted'&&member.is_member))){await ctx.reply(tr("La nota solo está disponible para miembros de ese grupo."));return;}}
  const note=await getRichNote(chat,match[2]!);if(!note){await ctx.reply(tr("Nota no encontrada o función no disponible."));return;}
  await deliverRichNote(ctx.api,note,ctx.from.id);
 });
 bot.command(Object.keys(commands),async ctx=>{
  if(!(await ensureGroupAdmin(ctx)))return;
  const name=ctx.message!.text!.split(/[\s@]/)[0]!.slice(1).toLowerCase();const feature=commands[name]!;const chat=ctx.app.chatRow!;
  if(!hasFeature(chat,feature,ctx.from!.id)){await replyTemp(ctx,tr("👑 {0} requiere el nivel {1}. Abre /premium para consultar los niveles.", [tr(ADVANCED_FEATURES[feature].label),ADVANCED_FEATURES[feature].tier]));return;}
  if(name==='antiraid'&&/^(on|off)$/i.test(String(ctx.match??'').trim())){
   const context={api:ctx.api,chat,chatId:chat.chat_id,settings:ctx.app.settings,botId:ctx.app.botId,actorId:ctx.from!.id,actorName:ctx.app.actorName};await assertActorRight(context,'can_restrict_members');
   const c=await advancedConfig(chat.chat_id);const enabled=String(ctx.match).trim().toLowerCase()==='on';
   if(enabled){c.settings.raid.enabled=true;await saveAdvanced(chat,c.settings,ctx.from!.id,c.version);await query('INSERT INTO raid_state(chat_id,until_at) VALUES($1,now()+make_interval(secs=>$2)) ON CONFLICT(chat_id) DO UPDATE SET until_at=EXCLUDED.until_at',[chat.chat_id,c.settings.raid.durationSeconds]);}
   else await query('DELETE FROM raid_state WHERE chat_id=$1',[chat.chat_id]);
   await replyTemp(ctx,enabled?tr("🛡️ Antirraid temporal activado."):tr("✅ Antirraid temporal desactivado; la detección automática conserva su configuración."));return;
  }
  if(name==='saverich'){
   await assertActorRight({api:ctx.api,chat,chatId:chat.chat_id,settings:ctx.app.settings,botId:ctx.app.botId,actorId:ctx.from!.id,actorName:ctx.app.actorName},'can_change_info');
   const noteName=String(ctx.match??'').trim().toLowerCase();const reply=ctx.message?.reply_to_message;
   if(!/^[a-z0-9_]{1,32}$/.test(noteName)||!reply){await replyTemp(ctx,tr("Responde a una foto, vídeo, GIF, documento o texto con <code>/saverich nombre</code>. Los botones y la entrega privada se ajustan en el panel."));return;}
   const count=await one('SELECT COUNT(*)::int AS n FROM rich_notes WHERE chat_id=$1',[chat.chat_id]);if(count!.n>=100&&!await one('SELECT 1 FROM rich_notes WHERE chat_id=$1 AND name=$2',[chat.chat_id,noteName])){await replyTemp(ctx,tr("Máximo 100 notas enriquecidas."));return;}
   const media=reply.photo?.at(-1)?{type:'photo',id:reply.photo.at(-1)!.file_id}:reply.video?{type:'video',id:reply.video.file_id}:reply.animation?{type:'animation',id:reply.animation.file_id}:reply.document?{type:'document',id:reply.document.file_id}:null;
   const content=reply.text??reply.caption??'';if(content.length>1024||(!media&&!content)){await replyTemp(ctx,tr("Usa un medio compatible o texto de hasta 1.024 caracteres."));return;}
   await query('INSERT INTO rich_notes(chat_id,name,content,media_type,file_id,actor_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(chat_id,name) DO UPDATE SET content=EXCLUDED.content,media_type=EXCLUDED.media_type,file_id=EXCLUDED.file_id,actor_id=EXCLUDED.actor_id',[chat.chat_id,noteName,content,media?.type??null,media?.id??null,ctx.from!.id]);
   advancedDataCache.invalidate(String(chat.chat_id));const c=await advancedConfig(chat.chat_id);if(!c.settings.richNotes.enabled){c.settings.richNotes.enabled=true;await saveAdvanced(chat,c.settings,ctx.from!.id,c.version);}
   await replyTemp(ctx,tr("✅ Nota enriquecida guardada. Úsala con #")+noteName+'.');return;
  }
  await showPanel(ctx,chat.chat_id,'settings');
 });
}
