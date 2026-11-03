import type { FastifyInstance } from "fastify";
import type { Bot,Api } from "grammy";
import type { AppContext } from "../../bot/context.js";
import { config } from "../../config.js";
import { fileUrlForApi } from '../../services/media-bridge.js';
import { runtimeForChat } from '../../services/branded-bots.js';
import { listCustomCommands, listNotes } from "../../db/repositories/commands.js";
import { listBlacklist } from "../../db/repositories/filters.js";
import { listMembers } from "../../db/repositories/members.js";
import { listModerationLog } from "../../db/repositories/moderation.js";
import { getPaymentHistory, getPremiumStatus } from "../../services/premium.js";
import { getChartData, getGroupStats } from "../../services/stats.js";
import { settingsOf } from "../../services/chat-cache.js";
import { many } from "../../db/pool.js";
import type { WarningRow } from "../../db/types.js";
import { verifyAvatarToken } from "../auth.js";
import {
  ApiError,
  parseChatId,
  requireAuth,
  requireChat,
} from "../helpers.js";
import { serializeLog, serializeMember, serializePayment } from "../serializers.js";

interface AvatarEntry {buffer:Buffer;contentType:string;expiresAt:number;}
const avatarCache=new Map<string,AvatarEntry>();
const avatarPending=new Map<string,Promise<AvatarEntry|null>>();
const AVATAR_TTL_MS=1800000,AVATAR_MAX_BYTES=16*1024*1024,AVATAR_FILE_MAX=2*1024*1024;
let avatarBytes=0;
function rememberAvatar(key:string,entry:AvatarEntry){
  const previous=avatarCache.get(key);if(previous){avatarBytes-=previous.buffer.length;avatarCache.delete(key);}
  for(const [id,value]of avatarCache){if(value.expiresAt>Date.now()&&avatarCache.size<500&&avatarBytes+entry.buffer.length<=AVATAR_MAX_BYTES)break;avatarBytes-=value.buffer.length;avatarCache.delete(id);}
  avatarCache.set(key,entry);avatarBytes+=entry.buffer.length;
}
async function fetchAvatar(api:Api,entityId:number):Promise<AvatarEntry|null>{
  let fileId:string|undefined;
  if(entityId<0){const chat=await api.getChat(entityId);fileId=chat.photo?.small_file_id;}
  else fileId=(await api.getUserProfilePhotos(entityId,{limit:1})).photos[0]?.[0]?.file_id;
  if(!fileId)return null;
  const file=await api.getFile(fileId);if(!file.file_path||(file.file_size??0)>AVATAR_FILE_MAX)return null;
  const response=await fetch(fileUrlForApi(api,file.file_path),{signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!response.ok||Number(response.headers.get('content-length')??0)>AVATAR_FILE_MAX)return null;
  const contentType=(response.headers.get('content-type')??'image/jpeg').split(';')[0]!.trim();
  if(!['image/jpeg','image/png','image/webp','application/octet-stream'].includes(contentType))return null;
  const reader=response.body?.getReader();if(!reader)return null;let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>AVATAR_FILE_MAX)return null;chunks.push(r.value);}}finally{await reader.cancel().catch(()=>undefined);}
  if(!size)return null;
  const buffer=Buffer.concat(chunks);
  // Telegram serves image files as application/octet-stream. Validate their
  // signatures and return an image MIME type instead of trusting that header.
  const imageType=buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff?'image/jpeg':buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP'?'image/webp':null;
  if(!imageType)return null;
  return {buffer,contentType:imageType,expiresAt:Date.now()+AVATAR_TTL_MS};
}

export function registerAssetRoutes(
  app: FastifyInstance,
  bot: Bot<AppContext>,
): void {
  app.get("/api/avatar/:userId", async (request, reply) => {
    const params = request.params as Record<string, string>;
    const q = request.query as Record<string, unknown>;
    const userId = Number(params.userId);
    const chatId = Number(q.chat_id);
    const token = typeof q.t === "string" ? q.t : "";

    if(!Number.isSafeInteger(userId)||!userId)throw new ApiError(400,'Identificador de imagen no válido.');
    if(!Number.isSafeInteger(chatId)||chatId===0||(userId<0&&userId!==chatId)||!verifyAvatarToken(chatId,userId,token))throw new ApiError(403,'Enlace de avatar no válido o caducado.');
    reply.header('Cache-Control','private, max-age=300');
    try{
      const runtime=await runtimeForChat(chatId),api=runtime?.bot.api??bot.api;
      const key=(runtime?.bot.botInfo.id??Number(config.botToken.split(':')[0]))+':'+userId;
      let entry=avatarCache.get(key);
      if(entry&&entry.expiresAt<=Date.now()){avatarBytes-=entry.buffer.length;avatarCache.delete(key);entry=undefined;}
      if(!entry){
        let pending=avatarPending.get(key);
        if(!pending){pending=fetchAvatar(api,userId);avatarPending.set(key,pending);}
        try{entry=await pending??undefined;if(entry)rememberAvatar(key,entry);}finally{if(avatarPending.get(key)===pending)avatarPending.delete(key);}
      }
      if(!entry)return reply.header('Cache-Control','no-store').code(404).send({ok:false,error:'Sin imagen disponible.'});
      return reply.header('Content-Type',entry.contentType).send(entry.buffer);
    }catch{return reply.header('Cache-Control','no-store').code(404).send({ok:false,error:'Sin imagen disponible.'});}
  });

  app.get("/api/export", async (request, reply) => {
    const auth = requireAuth(request);
    const q = request.query as Record<string, unknown>;
    const chatId = parseChatId(q.chat_id ?? q.chatId);
    const chat = await requireChat(bot.api, chatId, auth);
    if (!getPremiumStatus(chat).active && !config.ownerIds.has(auth.user.id)) {
      throw new ApiError(402, "La exportación de datos requiere GBot Ultra Premium.");
    }

    const [stats, chart, members, warnings, logs, payments, commands, notes, blacklist] =
      await Promise.all([
        getGroupStats(bot.api, chatId),
        getChartData(chatId, 90),
        listMembers(chatId, 5_000, ""),
        many<WarningRow>(
          "SELECT * FROM warnings WHERE chat_id = $1 ORDER BY created_at DESC",
          [chatId],
        ),
        listModerationLog(chatId, 5_000),
        getPaymentHistory(chatId, 1_000),
        listCustomCommands(chatId),
        listNotes(chatId),
        listBlacklist(chatId),
      ]);

    const payload = {
      generatedAt: new Date().toISOString(),
      version: 1,
      chat: {
        id: chat.chat_id,
        title: chat.title,
        username: chat.username,
        type: chat.type,
        description: chat.description,
        createdAt: chat.created_at.toISOString(),
      },
      settings: settingsOf(chat),
      stats,
      chart,
      members: members.map((member) => serializeMember(member, chatId)),
      warnings: warnings.map((warning) => ({
        id: warning.id,
        userId: warning.user_id,
        adminId: warning.admin_id,
        reason: warning.reason,
        createdAt: warning.created_at.toISOString(),
      })),
      moderation: logs.map(serializeLog),
      payments: payments.map(serializePayment),
      commands,
      notes,
      blacklist,
    };

    const filename = `gbot-export-${chatId}-${new Date().toISOString().slice(0, 10)}.json`;
    return reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(JSON.stringify(payload, null, 2));
  });
}
