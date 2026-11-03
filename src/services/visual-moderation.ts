import { createHash } from "node:crypto";
import type { Api } from "grammy";
import type { Message, User } from "grammy/types";
import { z } from "zod";
import { config, telegramFileUrl } from "../config.js";
import { many, one, query, withTransaction } from "../db/pool.js";
import type { ChatRow } from "../db/types.js";
import { getChat } from "../db/repositories/chats.js";
import { logModeration } from "../db/repositories/moderation.js";
import { ReadCache } from "./read-cache.js";
import { hasFeature, chatTier } from "./entitlements.js";
import { onceOperation } from "./operations.js";
import { getChatMemberSafe, isAdminStatus } from "../utils/telegram.js";
import { runtimeAdvanced } from "./advanced-engine.js";
import { fileUrlForApi } from './media-bridge.js';
import { apiIdentityForChat } from './branded-bots.js';

const MODEL = "omni-moderation-latest";
export const visualSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(["review", "delete"]),
    threshold: z.number().min(0.7).max(0.99),
    consent: z.boolean(),
  })
  .refine(
    (v) => !v.enabled || v.consent,
    "Confirma el envío de fotos a OpenAI antes de activar.",
  );
export type VisualSettings = z.infer<typeof visualSchema>;
type VisualConfig = VisualSettings & { actor_id: number; version: number };
type Job = {
  id: number;
  chat_id: number;
  message_id: number;
  user_id: number;
  file_id: string;
  cache_key: string;
};
export type VisualVerdict = { sexual: boolean; score: number };
const settingsCache = new ReadCache(2000),
  resultCache = new ReadCache(5000);
let pausedUntil = 0,
  lastStatus = "not_checked",
  running = false;
export function visualHealth() {
  return {
    configured: Boolean(config.moderationApiKey),
    provider: "OpenAI Moderation",
    model: MODEL,
    paused: pausedUntil > Date.now(),
    status: lastStatus,
    price: "Endpoint gratuito de moderación",
    scope: "Fotos; no analiza vídeo ni identifica la edad de las personas",
  };
}
export async function visualConfig(chatId: number,force=false): Promise<VisualConfig> {
  if(force)settingsCache.invalidate(String(chatId));
  return settingsCache.get(
    String(chatId),
    10000,
    async () =>
      (await one<VisualConfig>("SELECT * FROM visual_config WHERE chat_id=$1", [
        chatId,
      ])) ?? {
        enabled: false,
        mode: "review",
        threshold: 0.9,
        consent: false,
        actor_id: 0,
        version: 0,
      },
    String(chatId),
  );
}
export async function saveVisualConfig(
  chatId: number,
  actorId: number,
  raw: unknown,
  version: number,
) {
  const v = visualSchema.parse(raw);
  if (v.enabled && !config.moderationApiKey)
    throw Object.assign(
      new Error(
        "El proveedor NSFW aún no está configurado.",
      ),
      { statusCode: 503 },
    );
  const result = await withTransaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock($1)", [chatId]);
    const previous = (
      await c.query(
        "SELECT version FROM visual_config WHERE chat_id=$1 FOR UPDATE",
        [chatId],
      )
    ).rows[0];
    if ((previous?.version ?? 0) !== version)
      throw Object.assign(
        new Error("Otro administrador cambió el filtro. Recarga."),
        { statusCode: 409 },
      );
    return (
      await c.query(
        "INSERT INTO visual_config(chat_id,actor_id,enabled,mode,threshold,consent,version) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(chat_id) DO UPDATE SET actor_id=EXCLUDED.actor_id,enabled=EXCLUDED.enabled,mode=EXCLUDED.mode,threshold=EXCLUDED.threshold,consent=EXCLUDED.consent,version=EXCLUDED.version,updated_at=now() RETURNING *",
        [
          chatId,
          actorId,
          v.enabled,
          v.mode,
          v.threshold,
          v.consent,
          version + 1,
        ],
      )
    ).rows[0];
  });
  settingsCache.invalidate(String(chatId));
  return result;
}
export function parseVisualResponse(body: unknown): VisualVerdict | null {
  if (!body || typeof body !== "object") return null;
  const r = (
    body as {
      results?: {
        categories?: Record<string, unknown>;
        category_scores?: Record<string, unknown>;
      }[];
    }
  ).results?.[0];
  const sexual = r?.categories?.sexual,
    score = r?.category_scores?.sexual;
  return typeof sexual === "boolean" &&
    typeof score === "number" &&
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 1
    ? { sexual, score }
    : null;
}
export function requiresLocalReview(caption: string): boolean {
  const text = caption.normalize("NFKC").toLowerCase();
  return (
    /\bcsam\b/.test(text) ||
    (/\b(?:menores?|niñ[oa]s?|child(?:ren)?|kids?|underage)\b/u.test(text) &&
      /porn|sexual|desnud|nude|naked/i.test(text))
  );
}
export async function enqueueVisual(
  chat: ChatRow,
  message: Message,
  user: User,
): Promise<boolean> {
  if (
    !message.photo?.length ||
    message.sender_chat ||
    config.ownerIds.has(user.id)
  )
    return false;
  const v = await visualConfig(chat.chat_id);
  if (
    !v.enabled ||
    !v.consent ||
    !hasFeature(chat, "nsfw", v.actor_id) ||
    !config.moderationApiKey
  )
    return false;
  const photo = [...message.photo]
    .reverse()
    .find((p) => (p.file_size ?? 0) <= 3 * 1024 * 1024);
  if (!photo) return false;
  const cacheKey = createHash("sha256")
    .update(MODEL + ":" + photo.file_unique_id)
    .digest("hex");
  const review = requiresLocalReview(message.caption ?? "");
  const inserted = await query(
    "INSERT INTO visual_jobs(chat_id,message_id,user_id,file_id,cache_key,state,detail) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE (SELECT COUNT(*) FROM visual_jobs WHERE chat_id=$1 AND state IN ('pending','processing'))<50 ON CONFLICT(chat_id,message_id) DO NOTHING RETURNING id",
    [
      chat.chat_id,
      message.message_id,
      user.id,
      review ? "" : photo.file_id,
      cacheKey,
      review ? "review" : "pending",
      review ? "Revisión local: no se envió al proveedor." : null,
    ],
  );
  return Boolean(inserted.rowCount) && !review;
}
async function claimQuota(chat: ChatRow, actorId: number): Promise<boolean> {
  return withTransaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock($1)", [749302612]);
    const usage = (
      await c.query(
        "SELECT COALESCE(SUM(calls),0)::int AS total,COALESCE(SUM(CASE WHEN chat_id=$1 THEN calls ELSE 0 END),0)::int AS group_calls FROM visual_usage WHERE day=(now() AT TIME ZONE 'UTC')::date",
        [chat.chat_id],
      )
    ).rows[0];
    if (
      usage.total >= 4500 ||
      (!config.ownerIds.has(actorId) &&
        usage.group_calls >= (chatTier(chat) === "ultra" ? 300 : 100))
    )
      return false;
    await c.query(
      "INSERT INTO visual_usage(day,chat_id,calls) VALUES((now() AT TIME ZONE 'UTC')::date,$1,1) ON CONFLICT(day,chat_id) DO UPDATE SET calls=visual_usage.calls+1",
      [chat.chat_id],
    );
    return true;
  });
}
async function downloadPhoto(api: Api, fileId: string): Promise<string | null> {
  const file = await api.getFile(fileId);
  if (!file.file_path || (file.file_size ?? 0) > 3 * 1024 * 1024) return null;
  // Download privately: the Telegram bot token is NEVER sent as an image URL.
  const response = await fetch(fileUrlForApi(api,file.file_path), {
    signal: AbortSignal.timeout(6000),
    redirect: "error",
  });
  if (
    !response.ok ||
    Number(response.headers.get("content-length") ?? 0) > 3 * 1024 * 1024
  )
    return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 3 * 1024 * 1024) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  return "data:image/jpeg;base64," + bytes.toString("base64");
}
export async function classifyPhoto(
  api: Api,
  job: Job,
  chat: ChatRow,
  actorId: number,
): Promise<VisualVerdict | null> {
  if (!config.moderationApiKey || pausedUntil > Date.now()) return null;
  return resultCache.get(
    job.cache_key,
    60000,
    async () => {
      const cached = await one<{ sexual: boolean; score: string }>(
        "SELECT sexual,score FROM visual_cache WHERE cache_key=$1 AND expires_at>now()",
        [job.cache_key],
      );
      if (cached) return { sexual: cached.sexual, score: Number(cached.score) };
      try {
        const data = await downloadPhoto(api, job.file_id);
        if (!data) return null;
        if (!(await claimQuota(chat, actorId))) return null;
        const response = await fetch("https://api.openai.com/v1/moderations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + config.moderationApiKey,
          },
          body: JSON.stringify({
            model: MODEL,
            input: [{ type: "image_url", image_url: { url: data } }],
          }),
          signal: AbortSignal.timeout(8000),
          redirect: "error",
        });
        const verdict = parseVisualResponse(
          await response.json().catch(() => null),
        );
        if (!response.ok || !verdict) {
          lastStatus = "unavailable";
          pausedUntil = Date.now() + 60000;
          return null;
        }
        await query(
          "INSERT INTO visual_cache(cache_key,sexual,score,expires_at) VALUES($1,$2,$3,now()+interval '7 days') ON CONFLICT(cache_key) DO UPDATE SET sexual=EXCLUDED.sexual,score=EXCLUDED.score,expires_at=EXCLUDED.expires_at",
          [job.cache_key, verdict.sexual, verdict.score],
        );
        lastStatus = "ok";
        return verdict;
      } catch {
        lastStatus = "unavailable";
        pausedUntil = Date.now() + 60000;
        return null;
      }
    },
    job.cache_key,
    (v) => v !== null,
  );
}
export async function runVisualJobs(fallbackApi: Api, fallbackBotId: number): Promise<void> {
  if (running || !config.moderationApiKey || pausedUntil > Date.now()) return;
  running = true;
  try {
    await query(
      "UPDATE visual_jobs SET state='pending',updated_at=now() WHERE state='processing' AND updated_at<now()-interval '3 minutes'",
    );
    await query(
      "UPDATE visual_jobs SET state='unavailable',file_id='',detail='Análisis vencido; no se aplicó sanción.',updated_at=now() WHERE state='pending' AND created_at<now()-interval '1 day'",
    );
    const jobs = await withTransaction(async (c) => {
      const rows = (
        await c.query<Job>(
          "SELECT * FROM visual_jobs WHERE state='pending' ORDER BY id LIMIT 6 FOR UPDATE SKIP LOCKED",
        )
      ).rows;
      for (const j of rows)
        await c.query(
          "UPDATE visual_jobs SET state='processing',updated_at=now() WHERE id=$1",
          [j.id],
        );
      return rows;
    });
    for (const j of jobs) {
      const {api,botId}=await apiIdentityForChat(j.chat_id,fallbackApi,fallbackBotId);
      let state = "skipped",
        detail = "",
        score: number | null = null;
      try {
        const chat = await getChat(j.chat_id),
          settings = await visualConfig(j.chat_id);
        const member = await getChatMemberSafe(api, j.chat_id, j.user_id);
        if (
          !chat?.active ||
          !settings.enabled ||
          !settings.consent ||
          !hasFeature(chat, "nsfw", settings.actor_id) ||
          config.ownerIds.has(j.user_id) ||
          !member ||
          isAdminStatus(member.status)
        ) {
          detail =
            "Protección desactivada, permisos no verificables o usuario exceptuado.";
        } else {
          const verdict = await classifyPhoto(api, j, chat, settings.actor_id);
          score = verdict?.score ?? null;
          if (!verdict) {
            state = "unavailable";
            detail =
              "Proveedor, cuota o descarga no disponible; no se aplicó sanción.";
          } else if (
            !verdict.sexual ||
            verdict.score < Number(settings.threshold)
          ) {
            state = "clear";
            detail = "Sin coincidencia por encima del umbral.";
          } else if (
            settings.mode === "review" ||
            (await runtimeAdvanced(chat)).observation.enabled
          ) {
            state = "review";
            detail = "Posible contenido sexual; requiere revisión local.";
          } else {
            const current = await visualConfig(j.chat_id,true),
              target = await getChatMemberSafe(api, j.chat_id, j.user_id),
              bot = await getChatMemberSafe(api, j.chat_id, botId);
            if (
              !current.enabled ||
              current.mode !== "delete" ||
              current.version !== settings.version ||
              !target ||
              isAdminStatus(target.status) ||
              bot?.status !== "administrator" ||
              !bot.can_delete_messages
            ) {
              state = "skipped";
              detail =
                "La protección o los permisos cambiaron antes de borrar.";
            } else {
              await onceOperation(`visual:${j.chat_id}:${j.message_id}`, () =>
                api.deleteMessage(j.chat_id, j.message_id),
              );
              state = "deleted";
              detail =
                "Foto borrada por la regla NSFW; no se baneó al usuario.";
            }
          }
          if (verdict?.sexual && verdict.score >= Number(settings.threshold))
            await logModeration({
              chatId: j.chat_id,
              actorId: botId,
              targetId: j.user_id,
              action: "visual_" + state,
              reason: detail,
              metadata: {
                messageId: j.message_id,
                score,
                provider: "OpenAI Moderation",
              },
            });
        }
      } catch {
        state = "review";
        detail = "Resultado incierto; comprueba el mensaje antes de actuar.";
      }
      await query(
        "UPDATE visual_jobs SET state=$2,score=$3,detail=$4,file_id='',updated_at=now() WHERE id=$1",
        [j.id, state, score, detail],
      );
    }
    await query("DELETE FROM visual_cache WHERE expires_at<now()");
    await query(
      "DELETE FROM visual_jobs WHERE created_at<now()-interval '30 days'",
    );
    await query(
      "DELETE FROM visual_usage WHERE day<(now() AT TIME ZONE 'UTC')::date-8",
    );
  } finally {
    running = false;
  }
}
export async function visualSummary(chatId: number) {
  return {
    config: await visualConfig(chatId),
    provider: visualHealth(),
    jobs: await many(
      "SELECT id,message_id,user_id,state,score,detail,created_at FROM visual_jobs WHERE chat_id=$1 ORDER BY id DESC LIMIT 50",
      [chatId],
    ),
    usage: await one(
      "SELECT calls FROM visual_usage WHERE day=(now() AT TIME ZONE 'UTC')::date AND chat_id=$1",
      [chatId],
    ),
  };
}
