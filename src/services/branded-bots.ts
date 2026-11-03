import { tr } from "./bot-i18n.js";
import { randomUUID, createHash } from "node:crypto";
import { Api, InlineKeyboard, type Bot } from "grammy";
import type { Update } from "grammy/types";
import type { AppContext } from "../bot/context.js";
import type { ChatRow } from "../db/types.js";
import { config } from "../config.js";
import { one, query, withTransaction } from "../db/pool.js";
import { hasFeature } from "./entitlements.js";
import { ReadCache } from "./read-cache.js";
import {
  encryptBotToken,
  decryptBotToken,
  brandedWebhookSecret,
  vaultConfigured,
} from "./bot-vault.js";
import { type Runtime, primaryBot, rememberBotToken } from "./bot-runtime.js";
import { invalidateAdminCache } from "../utils/telegram.js";
import {withBotLanguage,BOT_LANGUAGES} from './bot-i18n.js';
type Brand = {
  id: string;
  chat_id: number;
  owner_id: number;
  bot_id: number;
  username: string;
  name: string;
  description: string;
  token_ciphertext: string;
  token_fingerprint: string;
  state: string;
  version: number;
  last_error: string | null;
};
const bindings = new ReadCache(2000),
  instances = new Map<
    string,
    { runtime: Runtime; version: number; used: number }
  >();
const loading=new Map<string,Promise<Runtime>>();
const failure = (message: string, statusCode = 400): never => {
  throw Object.assign(new Error(message), { statusCode });
};
export function brandPublic(row: Brand | null) {
  if (!row) return null;
  const { token_ciphertext, token_fingerprint, ...safe } = row;
  return safe;
}
export async function brandRow(chatId: number): Promise<Brand | null> {
  return bindings.get(
    String(chatId),
    5000,
    () => one<Brand>("SELECT * FROM branded_bots WHERE chat_id=$1", [chatId]),
    String(chatId),
  );
}
export function invalidateBrand(chatId: number, id?: string) {
  bindings.invalidate(String(chatId));
  invalidateAdminCache(chatId);
  if (id) instances.delete(id);
}
export async function inspectBrandToken(token: string) {
  if (!/^\d{8,12}:[A-Za-z0-9_-]{30,}$/.test(token))
    failure(tr("El token de BotFather no tiene un formato válido."));
  if (token.split(":")[0] === config.botToken.split(":")[0])
    failure(tr("El bot principal no puede registrarse como bot con marca propia."));
  const api = new Api(
    token,
    {timeoutSeconds:10,...(config.telegramApiUrl?{apiRoot:config.telegramApiUrl}:{})},
  );
  try {
    const info = await api.getMe(),
      webhook = await api.getWebhookInfo();
    if (!info.is_bot || !info.username)
      failure(tr("La credencial no corresponde a un bot válido."));
    return { info, hasWebhook: Boolean(webhook.url) };
  } catch {
    return failure(
      tr("Telegram no pudo validar el token. Compruébalo en BotFather."),
    );
  }
}
export async function saveBrand(
  chatId: number,
  ownerId: number,
  token: string,
  name: string,
  description: string,
  version: number,
) {
  if (!vaultConfigured())
    failure(tr("El almacén privado de bots no está configurado."), 503);
  const { info } = await inspectBrandToken(token);
  const result = await withTransaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock($1)", [chatId]);
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "brand:" + info.id,
    ]);
    const current = (
      await c.query<Brand>(
        "SELECT * FROM branded_bots WHERE chat_id=$1 FOR UPDATE",
        [chatId],
      )
    ).rows[0];
    if ((current?.version ?? 0) !== version)
      failure(tr("Otro administrador cambió el bot. Recarga."), 409);
    if (current?.state === "active")
      failure(tr("Pausa el bot antes de cambiar sus credenciales."), 409);
    if (
      (
        await c.query(
          "SELECT 1 FROM branded_bots WHERE bot_id=$1 AND chat_id<>$2",
          [info.id, chatId],
        )
      ).rowCount
    )
      failure(tr("Este bot ya está asociado a otro grupo."), 409);
    const id = current?.id ?? randomUUID(),
      encrypted = encryptBotToken(token, id),
      fingerprint = createHash("sha256").update(token).digest("hex");
    return (
      await c.query<Brand>(
        "INSERT INTO branded_bots(id,chat_id,owner_id,bot_id,username,name,description,token_ciphertext,token_fingerprint,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(chat_id) DO UPDATE SET owner_id=EXCLUDED.owner_id,bot_id=EXCLUDED.bot_id,username=EXCLUDED.username,name=EXCLUDED.name,description=EXCLUDED.description,token_ciphertext=EXCLUDED.token_ciphertext,token_fingerprint=EXCLUDED.token_fingerprint,state='paused',version=EXCLUDED.version,last_error=NULL,updated_at=now() RETURNING *",
        [
          id,
          chatId,
          ownerId,
          info.id,
          info.username,
          name,
          description,
          encrypted,
          fingerprint,
          version + 1,
        ],
      )
    ).rows[0]!;
  });
  invalidateBrand(chatId, result.id);
  return brandPublic(result);
}
export async function activeBrand(chatId: number): Promise<Brand | null> {
  const row = await brandRow(chatId);
  if (!row || row.state !== "active") return null;
  const chat = await one<ChatRow>("SELECT * FROM chats WHERE chat_id=$1", [
    chatId,
  ]);
  return chat?.active && hasFeature(chat, "branding", row.owner_id)
    ? row
    : null;
}
export async function brandRuntime(row:Brand):Promise<Runtime>{
  const key=row.id+':'+row.version,existing=loading.get(key);if(existing)return existing;
  const promise=buildBrandRuntime(row);loading.set(key,promise);try{return await promise;}finally{if(loading.get(key)===promise)loading.delete(key);}
}
async function buildBrandRuntime(row: Brand): Promise<Runtime> {
  const old = instances.get(row.id);
  if (old && old.version === row.version) {
    old.used = Date.now();
    return old.runtime;
  }
  const token = decryptBotToken(row.token_ciphertext, row.id),
    { createBot } = await import("../bot/index.js");
  const bot = createBot(token, row.chat_id);
  await bot.init();
  const runtime = { bot, token, chatId: row.chat_id, id: row.id };
  for (const [id, v] of instances)
    if (v.used < Date.now() - 1800000) instances.delete(id);
  if (instances.size >= 100) instances.delete(instances.keys().next().value!);
  instances.set(row.id, { runtime, version: row.version, used: Date.now() });
  return runtime;
}
export async function runtimeForChat(chatId: number): Promise<Runtime | null> {
  const row = await activeBrand(chatId);
  if(!row)return null;
  try{return await brandRuntime(row);}catch{
    await query("UPDATE branded_bots SET state='paused',last_error='Telegram no pudo verificar esta conexión. Revisa la credencial y vuelve a activarla.',version=version+1,updated_at=now() WHERE id=$1 AND version=$2",[row.id,row.version]);
    invalidateBrand(chatId,row.id);return null;
  }
}
export async function apiIdentityForChat(
  chatId: number,
  api: Api,
  botId: number,
) {
  const runtime = await runtimeForChat(chatId);
  return runtime
    ? { api: runtime.bot.api, botId: runtime.bot.botInfo.id }
    : { api, botId };
}
export function routedTelegramApi(fallback: Api): Api {
  return new Proxy(fallback, {
    get(target, key) {
      const method = Reflect.get(target, key);
      if (
        typeof method !== "function" ||
        typeof key !== "string" ||
        key === "toJSON"
      )
        return method;
      return async (...args: unknown[]) => {
        const chatId = Number(args[0]);
        const runtime =
          Number.isSafeInteger(chatId) && chatId < 0
            ? await runtimeForChat(chatId)
            : null;
        const api = runtime?.bot.api ?? target;
        return (
          Reflect.get(api, key) as (...values: unknown[]) => unknown
        ).apply(api, args);
      };
    },
  });
}
export async function changeBrandState(
  chatId: number,
  version: number,
  enabled: boolean,
  replaceWebhook = false,
  actorId?: number,
) {
  const row = await one<Brand>("SELECT * FROM branded_bots WHERE chat_id=$1", [
    chatId,
  ]);
  if (!row) failure(tr("Conecta primero tu bot."));
  return withTransaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock($1)", [chatId]);
    const current = (
      await c.query<Brand>(
        "SELECT * FROM branded_bots WHERE chat_id=$1 FOR UPDATE",
        [chatId],
      )
    ).rows[0]!;
    if (current.version !== version)
      failure(tr("La conexión cambió. Recarga."), 409);
    if (enabled) {
      const pending = await c.query(
        "SELECT 1 FROM captcha_pending WHERE chat_id=$1 UNION ALL SELECT 1 FROM join_challenges WHERE chat_id=$1 AND state IN ('pending','approving') UNION ALL SELECT 1 FROM night_state WHERE chat_id=$1 UNION ALL SELECT 1 FROM chat_locks WHERE chat_id=$1 UNION ALL SELECT 1 FROM scheduled_posts WHERE chat_id=$1 AND state='posting' LIMIT 1",
        [chatId],
      );
      if (pending.rowCount)
        failure(
          tr("Resuelve los captchas y envíos pendientes, y abre los cierres horarios antes de cambiar de bot."),
          409,
        );
      const runtime = await brandRuntime(current),
        api = runtime.bot.api,
        botMember = await api
          .getChatMember(chatId, current.bot_id)
          .catch(() => null);
      if (
        botMember?.status !== "administrator" ||
        !botMember.can_delete_messages ||
        !botMember.can_restrict_members
      )
        failure(
          tr("Añade tu bot al grupo como administrador con permisos para eliminar y restringir."),
        );
      const group=await one<ChatRow>('SELECT * FROM chats WHERE chat_id=$1',[chatId]);
      const destination=group?.settings?.logs;
      if(destination?.enabled&&destination.chatId){
        const logBot=await api.getChatMember(destination.chatId,current.bot_id).catch(()=>null);
        if(logBot?.status!=='administrator'||('can_post_messages'in logBot&&!logBot.can_post_messages))failure(tr("Añade también tu bot como administrador del destino de registros antes de activarlo."));
      }
      const webhook = await api.getWebhookInfo(),
        url = new URL("/telegram/brand/" + current.id, config.webappUrl).href;
      if (webhook.url && webhook.url !== url && !replaceWebhook)
        failure(
          tr("El bot tiene otro webhook. Confirma que deseas reemplazar esa conexión."),
          409,
        );
      await api.setWebhook(url, {
        secret_token: brandedWebhookSecret(current.id),
        allowed_updates: [
          "message",
          "edited_message",
          "callback_query",
          "my_chat_member",
          "chat_member",
          "chat_join_request",
        ],
        drop_pending_updates: false,
      });
      await api.setMyName(current.name);
      await api.setMyDescription(current.description);
      await api.setMyShortDescription(Array.from(current.description).slice(0,120).join(''));
      const commands=withBotLanguage('es',()=>[
        { command: "start", description: tr("Abrir el menú de la comunidad") },
        { command: "panel", description: tr("Administrar en el panel central") },
        { command: "ia", description: tr("Consultar al asistente de IA") },
        { command: "help", description: tr("Ayuda de administración") },
        { command: "ban", description: tr("Banear a un miembro") },
        { command: "mute", description: tr("Silenciar a un miembro") },
        { command: "warn", description: tr("Advertir a un miembro") },
        { command: "rules", description: tr("Ver normas del grupo") },
        {command:'setup',description:tr('Asistente de instalación y permisos')},
        {command:'inbox',description:tr('Bandeja de revisiones pendientes (Pro)')},
  {command:'quality',description:tr("Calidad de reglas")},
  {command:'undo',description:tr("Deshacer sanciones")},
        {command:'language',description:tr('Elegir el idioma de las respuestas')},
      ]);
      await api.setMyCommands(commands);
      for(const language of BOT_LANGUAGES)await api.setMyCommands(commands.map(c=>({...c,description:tr(c.description,[],language)})),{language_code:language});
    }
    // Pausing is local and immediate: never deletes a foreign webhook or leaves the group.
    await c.query(
      "UPDATE branded_bots SET state=$2,owner_id=CASE WHEN $4 THEN $3 ELSE owner_id END,version=version+1,last_error=NULL,updated_at=now() WHERE chat_id=$1",
      [
        chatId,
        enabled ? "active" : "paused",
        actorId ?? current.owner_id,
        enabled,
      ],
    );
    invalidateBrand(chatId, current.id);
    return { ok: true };
  });
}
export function updateChatId(update: Update): number | null {
  return (
    (
      update.message ??
      update.edited_message ??
      update.channel_post ??
      update.my_chat_member ??
      update.chat_member ??
      update.chat_join_request
    )?.chat.id ??
    update.callback_query?.message?.chat.id ??
    null
  );
}
export async function brandMessageGate(
  ctx: AppContext,
  next: () => Promise<void>,
  boundChat?: number,
) {
  const chatId = ctx.chat?.id;
  const note=/^\/start(?:@\w+)?\s+note_(-\d+)_[a-z0-9_]{1,32}$/.exec(ctx.message?.text??'');
  if(boundChat&&chatId&&chatId>0&&note&&Number(note[1])===boundChat&&(await activeBrand(boundChat))?.bot_id===ctx.me.id)return next();
  // Existing challenges finish with the bot that created their buttons.
  if(boundChat&&ctx.callbackQuery?.data?.startsWith('cap:')&&chatId===boundChat)return next();
  if(boundChat&&ctx.callbackQuery?.data?.startsWith('jg:')){
    const token=ctx.callbackQuery.data.split(':')[1];
    if(await one('SELECT 1 FROM join_challenges WHERE token=$1 AND chat_id=$2 AND user_id=$3',[token,boundChat,ctx.from?.id]))return next();
    return;
  }
  if (boundChat && (!chatId || chatId > 0)) {
    const language=await bindings.get('language:'+boundChat,10000,async()=>
      (await one<{language:string}>("SELECT settings->>'language' AS language FROM chats WHERE chat_id=$1",[boundChat]))?.language??ctx.from?.language_code??'es',String(boundChat));
    return withBotLanguage(language,async()=>{
    if (ctx.callbackQuery) {
      await ctx
        .answerCallbackQuery({
          text: tr("Administra este bot desde el panel central."),
        })
        .catch(() => undefined);
      return;
    }
    if (ctx.message?.text) {
      const parent = primaryBot().botInfo.username;
      await ctx.reply(
        tr("{0}\n\nPara administrar este grupo y sus funciones Ultra, abre el panel central. En el grupo puedes consultar /ia y usar los comandos de moderación.", [ctx.me.first_name]),
        {
          reply_markup: new InlineKeyboard().url(
            tr("Abrir administración"),
            `https://t.me/${parent}?start=panel_${boundChat}`,
          ),
        },
      );
    }
    return;
    });
  }
  if (!chatId || chatId > 0) return next();
  if (boundChat && chatId !== boundChat) return;
  const row = await activeBrand(chatId);
  if (boundChat && row?.bot_id !== ctx.me.id) return;
  if (!boundChat && row && ctx.update.my_chat_member === undefined) return;
  const known = await brandRow(chatId);
  if (known) {
    const m = ctx.update.message ?? ctx.update.edited_message,
      member = ctx.update.chat_member;
    const key = m
      ? (ctx.update.edited_message ? "edit:" : "message:") +
        m.message_id +
        ":" +
        (m.edit_date ?? 0)
      : member
        ? "member:" +
          member.new_chat_member.user.id +
          ":" +
          member.date +
          ":" +
          member.old_chat_member.status +
          ":" +
          member.new_chat_member.status
        : null;
    if (
      key &&
      !(
        await query(
          "INSERT INTO group_update_receipts(chat_id,event_key,bot_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_key",
          [chatId, key, ctx.me.id],
        )
      ).rowCount
    )
      return;
  }
  if (
    boundChat &&
    ctx.update.my_chat_member &&
    ["left", "kicked"].includes(
      ctx.update.my_chat_member.new_chat_member.status,
    )
  ) {
    await query(
      "UPDATE branded_bots SET state='paused',last_error='El bot salió del grupo.',version=version+1 WHERE chat_id=$1",
      [chatId],
    );
    invalidateBrand(chatId, known?.id);
    return;
  }
  return next();
}
export async function brandWebhookRow(id: string) {
  return one<Brand>("SELECT * FROM branded_bots WHERE id=$1", [id]);
}
export async function brandSummary(chatId: number) {
  return {
    configured: vaultConfigured(),
    bot: brandPublic(await brandRow(chatId)),
    scope:
      tr("Un bot independiente por grupo Ultra; administración y compras en la Mini App central."),
  };
}
export async function cleanupBrands() {
  await query(
    "DELETE FROM branded_update_receipts WHERE created_at<now()-interval '7 days'",
  );
  await query(
    "DELETE FROM group_update_receipts WHERE created_at<now()-interval '7 days'",
  );
}
