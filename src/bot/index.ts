import { observeSanctionChange } from "../services/sanction-journal.js";
import { tr } from "../services/bot-i18n.js";
import {BOT_LANGUAGES,withBotLanguage} from '../services/bot-i18n.js';
import { Bot } from "grammy";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { createTelegramApiCache } from "../services/telegram-cache.js";
import { invalidateAdminCache } from "../utils/telegram.js";
import { registerCallbacks } from "./handlers/callbacks.js";
import { registerContent } from "./handlers/content.js";
import { registerGeneral } from "./handlers/general.js";
import { registerModeration } from "./handlers/moderation.js";
import { registerOwner } from "./handlers/owner.js";
import { registerPremium } from "./handlers/premium.js";
import { registerSettings } from "./handlers/settings.js";
import { registerEvents } from "./events.js";
import { attachContext, redirectGroupConfig } from "./middleware.js";
import { registerMessages } from "./messages.js";
import type { AppContext } from "./context.js";
import { registerAdvancedBot } from './advanced.js';
import { brandMessageGate } from '../services/branded-bots.js';
import { rememberBotToken } from '../services/bot-runtime.js';
import { rememberMedia,mediaBridge } from '../services/media-bridge.js';
import { askAI } from '../services/ai-assistant.js';
import { registerWorkspaceBot } from './workspace.js';
import {ZodError} from 'zod';

const PRIVATE_COMMANDS = [
  {command:'setup',description:tr("Asistente de instalación y permisos")},
  {command:'inbox',description:tr("Bandeja de revisiones pendientes (Pro)")},
  {command:'quality',description:tr("Calidad de reglas")},
  {command:'undo',description:tr("Deshacer sanciones")},
  {command:'language',description:tr("Elegir el idioma de las respuestas")},
  { command: "start", description: tr("Iniciar el bot y abrir el menú") },
  { command: "panel", description: tr("Abrir el panel de control (Mini App)") },
  { command: "config", description: tr("Abrir los ajustes de tus grupos") },
  { command: "estado", description: tr("Revisar permisos y estado del grupo") },
  { command: "premium", description: tr("Planes y ventajas de GBot Ultra Premium") },
  { command: "redeem", description: tr("Canjear un código Premium") },
  { command: "help", description: tr("Ayuda y lista de comandos") },
  { command: "info", description: tr("Tu información de Telegram") },
  { command: "id", description: tr("Ver tu ID y el del chat") },
];

const GROUP_COMMANDS = [
  {command:'setup',description:tr("Asistente de instalación y perfiles de protección")},
  {command:'inbox',description:tr("Revisar reportes, solicitudes y fotos (Pro)")},
  {command:'quality',description:tr("Calidad de reglas")},
  {command:'undo',description:tr("Deshacer sanciones")},
  {command:'language',description:tr("Cambiar el idioma del grupo")},
  {command:'ia',description:tr("Consultar al asistente de IA del grupo (Ultra)")},
  { command:'schedule',description:tr("Publicaciones programadas y recurrentes (Pro)") },
  { command:'nsfw',description:tr("Filtro visual de fotos, revisión y eliminación (Pro)") },
  { command:'antiraid',description:tr("Protección contra ingresos masivos (Premium)") },
  { command:'locks',description:tr("Bloqueos por contenido (Premium)") },
  { command:'trust',description:tr("Excepciones de confianza (Premium)") },
  { command:'filters',description:tr("Respuestas por frases (Pro)") },
  { command:'night',description:tr("Horarios del grupo (Pro)") },
  { command:'alliances',description:tr("Alianzas y casos compartidos (Ultra)") },
  { command:'topics',description:tr("Gestión de temas (Pro)") },
  { command:'saverich',description:tr("Guardar nota con multimedia (Pro)") },
  { command: "panel", description: tr("Abrir el panel privado de este grupo") },
  { command: "estado", description: tr("Diagnóstico de permisos y protección") },
  { command: "config", description: tr("Abrir los ajustes de este grupo") },
  { command: "help", description: tr("Ayuda y lista de comandos") },
  { command: "settings", description: tr("Panel de ajustes del grupo") },
  { command: "welcome", description: tr("Configurar la bienvenida") },
  { command: "captcha", description: tr("Verificación de nuevos miembros") },
  { command: "antilink", description: tr("Bloquear enlaces no permitidos") },
  { command: "antiflood", description: tr("Protección contra spam") },
  { command: "blacklist", description: tr("Palabras prohibidas") },
  { command: "warn", description: tr("Advertir a un miembro") },
  { command: "mute", description: tr("Silenciar a un miembro") },
  { command: "unmute", description: tr("Quitar el silencio de un miembro") },
  { command: "ban", description: tr("Banear a un miembro") },
  { command: "unban", description: tr("Quitar el baneo de un miembro") },
  { command: "lock", description: tr("Cerrar temporalmente el grupo") },
  { command: "unlock", description: tr("Restaurar los permisos anteriores del grupo") },
  { command: "kick", description: tr("Expulsar a un miembro") },
  { command: "purge", description: tr("Borrar mensajes en masa") },
  { command: "pin", description: tr("Fijar un mensaje") },
  { command: "rules", description: tr("Mostrar las normas del grupo") },
  { command: "stats", description: tr("Estadísticas del grupo") },
  { command: "top", description: tr("Miembros más activos") },
  { command: "report", description: tr("Reportar un mensaje a los admins") },
  { command: "premium", description: tr("Mejorar el grupo con Premium") },
  { command: "save", description: tr("Guardar una nota") },
  { command: "get", description: tr("Mostrar una nota") },
  { command: "addcmd", description: tr("Crear un comando personalizado") },
  { command: "cmds", description: tr("Listar comandos personalizados") },
  { command: "notes", description: tr("Listar notas guardadas") },
  { command: "id", description: tr("Ver IDs de usuarios y del chat") },
  { command: "admins", description: tr("Listar administradores") },
];

export function createBot(token=config.botToken,boundChat?:number): Bot<AppContext> {
  const bot = new Bot<AppContext>(
    token,
    {client:{timeoutSeconds:20,...(config.telegramApiUrl?{apiRoot:config.telegramApiUrl}:{})}},
  );

  const cache = createTelegramApiCache(invalidateAdminCache);
  bot.api.config.use(cache.transformer);
  rememberBotToken(bot.api,token);
  bot.api.config.use(mediaBridge(bot.api,Number(token.split(':')[0])));
  bot.use((ctx,next)=>brandMessageGate(ctx,next,boundChat));
  bot.use(async(ctx,next)=>{const m=ctx.message;if(m&&(m.photo||m.video||m.animation||m.document||m.reply_to_message)){await rememberMedia(m,ctx.me.id,ctx.chat!.id);await rememberMedia(m.reply_to_message,ctx.me.id,ctx.chat!.id);}return next();});
  // Membership changes must invalidate permissions before attachContext reads them.
  bot.use(async (ctx, next) => {
    const change = ctx.update.chat_member || ctx.update.my_chat_member;
    const message = ctx.message;
    if (change) {
      cache.invalidateChat(change.chat.id);
      if(ctx.update.chat_member)await observeSanctionChange(ctx.api,ctx.me.id,change.chat.id,change.new_chat_member.user.id,change.from.id,change.new_chat_member);
    } else if (message && (message.new_chat_members || message.left_chat_member || message.new_chat_title)) {
      cache.invalidateChat(message.chat.id);
    }
    await next();
  });

  bot.catch(async (err) => {
    logger.error(
      {
        err: err.error,
        updateId: err.ctx.update.update_id,
        chatId: err.ctx.chat?.id,
        userId: err.ctx.from?.id,
      },
      tr("Error procesando una actualización"),
    );
    if(err.ctx.message?.successful_payment)throw err.error;
    if (err.ctx.callbackQuery) {
      await withBotLanguage(err.ctx.app?.language??err.ctx.from?.language_code,()=>err.ctx
        .answerCallbackQuery({ text: tr("⚠️ Ha ocurrido un error. Inténtalo de nuevo.") })
        .catch(() => undefined));
    }
  });

  bot.use(attachContext);
  bot.use(redirectGroupConfig);
  registerWorkspaceBot(bot);
  registerAdvancedBot(bot);
  registerMessages(bot);
  bot.command('ia',async ctx=>{
    if(!ctx.app.chatRow||!ctx.from){await ctx.reply(tr("Usa /ia seguido de tu consulta dentro de un grupo con el asistente activado."));return;}
    try{const result=await askAI(ctx.chat.id,ctx.from.id,String(ctx.match??''));await ctx.reply(tr("🤖 IA · respuesta orientativa\n\n")+result.answer,{reply_parameters:{message_id:ctx.message!.message_id,allow_sending_without_reply:true},link_preview_options:{is_disabled:true}});}catch(error){await ctx.reply(error instanceof ZodError?tr('Usa /ia seguido de tu consulta dentro de un grupo con el asistente activado.'):(error as Error).message).catch(()=>undefined);}
  });
  registerGeneral(bot);
  registerModeration(bot);
  registerSettings(bot);
  registerContent(bot);
  registerPremium(bot);
  registerOwner(bot);
  registerCallbacks(bot);
  registerEvents(bot);

  return bot;
}

/** Configura comandos, descripción y botón de menú en Telegram. */
export async function configureBot(bot: Bot<AppContext>): Promise<void> {
  const safe = async (name: string, task: () => Promise<unknown>): Promise<void> => {
    try {
      await task();
    } catch (error) {
      logger.warn({ err: error, task: name }, tr("No se pudo configurar el bot en Telegram"));
    }
  };

  await safe("commands-private", () =>
    bot.api.setMyCommands(PRIVATE_COMMANDS, { scope: { type: "default" } }),
  );
  await safe("commands-group", () =>
    bot.api.setMyCommands(GROUP_COMMANDS, { scope: { type: "all_group_chats" } }),
  );
  for(const language of BOT_LANGUAGES){
    await safe('commands-private-'+language,()=>bot.api.setMyCommands(PRIVATE_COMMANDS.map(c=>({...c,description:tr(c.description,[],language).slice(0,256)})),{scope:{type:'default'},language_code:language}));
    await safe('commands-group-'+language,()=>bot.api.setMyCommands(GROUP_COMMANDS.map(c=>({...c,description:tr(c.description,[],language).slice(0,256)})),{scope:{type:'all_group_chats'},language_code:language}));
  }

  await safe("description", () =>
    bot.api.setMyDescription(
      tr("GBot Ultra: administración completa para tus grupos de Telegram. Moderación automática, captcha, bienvenidas, estadísticas y planes con Telegram Stars.")+(config.casEnabled?tr(" Powered by CAS: https://cas.chat"):''),
    ),
  );
  await safe("short-description", () =>
    bot.api.setMyShortDescription(tr("Administración y protección completa para grupos de Telegram.")),
  );
  for(const language of BOT_LANGUAGES){
    await safe('description-'+language,()=>bot.api.setMyDescription(tr('GBot Ultra: administración completa para tus grupos de Telegram. Moderación automática, captcha, bienvenidas, estadísticas y planes con Telegram Stars.',[],language)+(config.casEnabled?tr(' Powered by CAS: https://cas.chat',[],language):''),{language_code:language}));
    await safe('short-description-'+language,()=>bot.api.setMyShortDescription(tr('Administración y protección completa para grupos de Telegram.',[],language),{language_code:language}));
  }

  if (config.hasWebapp) {
    await safe("menu-button", () =>
      bot.api.setChatMenuButton({
        menu_button: {
          type: "web_app",
          text: tr("Abrir panel"),
          web_app: { url: config.webappUrl },
        },
      }),
    );
  }
}
