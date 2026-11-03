import { tr } from "../services/bot-i18n.js";
import {InlineKeyboard,type Bot} from 'grammy';
import type {AppContext} from './context.js';
import {ensureGroupAdmin,notify} from './middleware.js';
import {getChat} from '../db/repositories/chats.js';
import {getChatMemberSafe,isAdminStatus} from '../utils/telegram.js';
import {config,webappUrlForChat} from '../config.js';
import {hasFeature} from '../services/entitlements.js';
import {primaryBot} from '../services/bot-runtime.js';
import {withBotLanguage} from '../services/bot-i18n.js';
import {SUPPORTED_LANGUAGES} from '../i18n/index.js';
import {savePrivateLanguage} from '../services/language-preferences.js';

export function registerWorkspaceBot(bot:Bot<AppContext>){
 async function open(ctx:AppContext,tool:'setup'|'inbox'|'quality'|'undo',chatId?:number){
  const title=tool==='setup'?tr("Asistente de instalación"):tool==='inbox'?tr("Bandeja unificada"):tool==='quality'?tr("Calidad de reglas"):tr("Deshacer sanciones");
  const feature=tool==='quality'?'ruleQuality':tool==='undo'?'undoSanctions':tool==='inbox'?'inbox':null;
  const denied=()=>tool==='quality'?tr("Calidad de reglas requiere Ultra."):tool==='undo'?tr("Deshacer sanciones requiere Pro o Ultra."):tr("La bandeja unificada requiere Pro o Ultra.");
  if(ctx.chat?.type!=='private'){
   if(!(await ensureGroupAdmin(ctx)))return;
   if(feature&&!hasFeature(ctx.app.chatRow,feature,ctx.from!.id)){await notify(ctx,denied());return;}
   const username=primaryBot().botInfo.username;
   await ctx.reply(title+tr("\n\nAbre esta herramienta en el panel privado del grupo."),{reply_markup:new InlineKeyboard().url(tr("Abrir herramienta"),`https://t.me/${username}?start=workspace_${tool}_${ctx.chat!.id}`)});return;
  }
  if(!chatId){await ctx.reply(tr("Elige el grupo desde /panel y abre la herramienta en Ajustes o Moderación."));return;}
  if(ctx.me.id!==primaryBot().botInfo.id){
    await ctx.reply(title,{reply_markup:new InlineKeyboard().url(tr('Abrir herramienta'),`https://t.me/${primaryBot().botInfo.username}?start=workspace_${tool}_${chatId}`)});return;
  }
  const chat=await getChat(chatId),member=ctx.app.isOwner?null:await getChatMemberSafe(ctx.api,chatId,ctx.from!.id);
  if(!chat?.active||!ctx.app.isOwner&&(!member||!isAdminStatus(member.status))){await notify(ctx,tr("No tienes acceso a ese grupo."));return;}
  if(feature&&!hasFeature(chat,feature,ctx.from!.id)){await notify(ctx,denied());return;}
  const url=new URL(webappUrlForChat(chatId,tool==='quality'||tool==='undo'?'moderation':'settings'));url.searchParams.set('tool',tool);
  await ctx.reply(title+tr("\n\nComprueba el grupo y revisa los cambios antes de confirmar."),{reply_markup:new InlineKeyboard().webApp(tr("Abrir herramienta"),url.href)});
 }
 bot.command('quality',ctx=>open(ctx,'quality',ctx.chat?.type==='private'?undefined:ctx.chat?.id));
 bot.command('undo',ctx=>open(ctx,'undo',ctx.chat?.type==='private'?undefined:ctx.chat?.id));
 bot.command('setup',ctx=>open(ctx,'setup',ctx.chat?.type==='private'?undefined:ctx.chat?.id));
 bot.command('inbox',ctx=>open(ctx,'inbox',ctx.chat?.type==='private'?undefined:ctx.chat?.id));
 bot.command('start',async(ctx,next)=>{const match=String(ctx.match??'').match(/^workspace_(setup|inbox|quality|undo)_(-\d+)$/);if(!match)return next();return open(ctx,match[1] as 'setup'|'inbox'|'quality'|'undo',Number(match[2]));});
 bot.callbackQuery(/^private_lang:(es|en|pt|fr|de|it|ru|tr|ar|zh)$/,async ctx=>{
  if(ctx.chat?.type!=='private'){await ctx.answerCallbackQuery();return;}
  const code=ctx.match[1];await savePrivateLanguage(ctx,code);
  await withBotLanguage(code,async()=>{await ctx.answerCallbackQuery({text:tr("Idioma actualizado.")});await ctx.reply(tr("El idioma de tus respuestas privadas se ha actualizado. Los grupos conservan su propio idioma."));});
 });
 bot.command('language',async(ctx,next)=>{
  if(ctx.chat?.type!=='private')return next();
  const keyboard=new InlineKeyboard();for(const lang of SUPPORTED_LANGUAGES)keyboard.text(lang.flag+' '+lang.name,'private_lang:'+lang.code).row();
  await ctx.reply(tr("Elige el idioma de tus respuestas privadas. Para cambiar un grupo, usa su selector de idioma en el panel."),{reply_markup:keyboard});
 });
}
