import { tr } from "./bot-i18n.js";
import type { Api } from "grammy";
import { z } from "zod";
import { many, one, query, withTransaction } from "../db/pool.js";
import { getChat } from "../db/repositories/chats.js";
import { config } from "../config.js";
import { hasFeature, chatTier } from "./entitlements.js";
import { assertActorRight, ModerationError } from "./moderation.js";
import { settingsOf } from "./chat-cache.js";
import { getChatMemberSafe } from "../utils/telegram.js";
import { onceOperation } from "./operations.js";
import { mapConcurrent } from "../utils/concurrency.js";
import { logModeration } from "../db/repositories/moderation.js";
import { apiIdentityForChat } from './branded-bots.js';

function failure(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}
const zone = z
  .string()
  .max(80)
  .refine((s) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: s });
      return true;
    } catch {
      return false;
    }
  }, tr("Zona horaria no válida"));
export const publicationSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    content: z.string().trim().min(1).max(4000),
    timezone: zone,
    localTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    recurrence: z.enum(["once", "daily", "weekly"]),
    threadId: z.number().int().min(0).max(2147483647).default(0),
    buttonLabel: z.string().max(50).default(""),
    buttonUrl: z
      .union([
        z.literal(""),
        z
          .string()
          .url()
          .max(1000)
          .refine((s) => new URL(s).protocol === "https:", tr("Usa HTTPS")),
      ])
      .default(""),
  })
  .refine(
    (v) => Boolean(v.buttonLabel) === Boolean(v.buttonUrl),
    tr("Completa el texto y enlace del botón"),
  );
export type PublicationInput = z.infer<typeof publicationSchema>;
export type Publication = {
  id: number;
  chat_id: number;
  actor_id: number;
  title: string;
  content: string;
  timezone: string;
  local_time: string;
  recurrence: PublicationInput["recurrence"];
  next_run_at: Date;
  thread_id: number;
  button_label: string | null;
  button_url: string | null;
  state: string;
  version: number;
  last_error: string | null;
};

function wallParts(date: Date, timezone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => p.find((x) => x.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function wallTimeCandidates(
  localTime: string,
  timezone: string,
): Date[] {
  const base = new Date(localTime + "Z");
  if (
    !Number.isFinite(base.getTime()) ||
    base.toISOString().slice(0, 16) !== localTime
  )
    failure(tr("Fecha u hora no válida."));
  const offsets = new Set<number>();
  for (const hours of [-36, 0, 36]) {
    const sample = new Date(base.getTime() + hours * 3600000);
    offsets.add(
      new Date(wallParts(sample, timezone) + "Z").getTime() - sample.getTime(),
    );
  }
  return [...offsets]
    .map((o) => new Date(base.getTime() - o))
    .filter((d) => wallParts(d, timezone) === localTime)
    .sort((a, b) => a.getTime() - b.getTime());
}
export function firstPublicationTime(
  localTime: string,
  timezone: string,
  now = new Date(),
): Date {
  const dates = wallTimeCandidates(localTime, timezone);
  if (dates.length !== 1)
    failure(
      dates.length
        ? tr("La hora se repite por el cambio horario. Elige otra hora.")
        : tr("La hora no existe por el cambio horario. Elige otra hora."),
    );
  const date = dates[0]!;
  if (
    date.getTime() < now.getTime() + 30000 ||
    date.getTime() > now.getTime() + 366 * 86400000
  )
    failure(tr("Programa entre 30 segundos y un año a partir de ahora."));
  return date;
}
export function nextPublicationTime(
  post: Pick<Publication, "local_time" | "timezone" | "recurrence">,
  now: Date,
): Date | null {
  if (post.recurrence === "once") return null;
  const today = wallParts(now, post.timezone).slice(0, 10),
    clock = post.local_time.slice(11);
  const anchor = new Date(
    post.local_time.slice(0, 10) + "T12:00:00Z",
  ).getUTCDay();
  for (let days = 0; days <= 15; days++) {
    const calendar = new Date(today + "T12:00:00Z");
    calendar.setUTCDate(calendar.getUTCDate() + days);
    if (post.recurrence === "weekly" && calendar.getUTCDay() !== anchor)
      continue;
    const options = wallTimeCandidates(
      calendar.toISOString().slice(0, 10) + "T" + clock,
      post.timezone,
    );
    // Only one occurrence of a repeated wall-clock time is sent.
    if (options[0] && options[0].getTime() > now.getTime() + 1000)
      return options[0];
  }
  return null;
}
export async function savePublication(
  chatId: number,
  actorId: number,
  input: unknown,
  id?: number,
  version?: number,
  operationId?: string,
) {
  const v = publicationSchema.parse(input),
    next = firstPublicationTime(v.localTime, v.timezone);
  return withTransaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock($1)", [chatId]);
    const chat = await getChat(chatId);
    if (!chat || !hasFeature(chat, "scheduledPosts", actorId))
      failure(tr("Publicaciones programadas requiere Pro."), 402);
    const createKey =
      chatId + ":" + actorId + ":" + z.string().uuid().parse(operationId);
    if (!id) {
      const existing = (
        await c.query("SELECT * FROM scheduled_posts WHERE create_key=$1", [
          createKey,
        ])
      ).rows[0];
      if (existing) return existing;
    }
    if (id) {
      const current = (
        await c.query(
          "SELECT * FROM scheduled_posts WHERE id=$1 AND chat_id=$2 FOR UPDATE",
          [id, chatId],
        )
      ).rows[0];
      if (!current) failure(tr("Programación no encontrada."), 404);
      if (current.version !== version || current.state === "posting")
        failure(
          tr("La programación cambió o se está enviando. Recarga antes de editar."),
          409,
        );
    } else if (!config.ownerIds.has(actorId)) {
      const n = (
        await c.query(
          "SELECT COUNT(*)::int AS n FROM scheduled_posts WHERE chat_id=$1 AND state<>'archived'",
          [chatId],
        )
      ).rows[0].n;
      if (n >= (chatTier(chat) === "ultra" ? 100 : 20))
        failure(
          tr("Límite de programaciones: Pro 20; Ultra 100. Archiva una para liberar espacio."),
          402,
        );
    }
    const params = [
      chatId,
      actorId,
      v.title,
      v.content,
      v.timezone,
      v.localTime,
      v.recurrence,
      next,
      v.threadId,
      v.buttonLabel || null,
      v.buttonUrl || null,
    ];
    if (id)
      return (
        await c.query(
          "UPDATE scheduled_posts SET actor_id=$2,title=$3,content=$4,timezone=$5,local_time=$6,recurrence=$7,next_run_at=$8,thread_id=$9,button_label=$10,button_url=$11,state='active',last_error=NULL,version=version+1,updated_at=now() WHERE chat_id=$1 AND id=$12 RETURNING *",
          [...params, id],
        )
      ).rows[0];
    return (
      await c.query(
        "INSERT INTO scheduled_posts(chat_id,actor_id,title,content,timezone,local_time,recurrence,next_run_at,thread_id,button_label,button_url,create_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
        [...params, createKey],
      )
    ).rows[0];
  });
}
export async function publicationState(
  chatId: number,
  id: number,
  version: number,
  action: "pause" | "archive",
) {
  const row = await one(
    "UPDATE scheduled_posts SET state=$4,version=version+1,updated_at=now() WHERE chat_id=$1 AND id=$2 AND version=$3 AND state<>'posting' RETURNING id",
    [chatId, id, version, action === "pause" ? "paused" : "archived"],
  );
  if (!row) failure(tr("La programación cambió o se está enviando. Recarga."), 409);
}
export async function runPublications(
  fallbackApi: Api,
  fallbackBotId: number,
  now = new Date(),
): Promise<void> {
  await query(
    "UPDATE scheduled_posts SET state='review',last_error='El envío quedó interrumpido. Revisa Telegram antes de reprogramar.',version=version+1,updated_at=now() WHERE state='posting' AND updated_at<now()-interval '3 minutes'",
  );
  const posts = await withTransaction(async (c) => {
    const rows = (
      await c.query<Publication>(
        "SELECT * FROM scheduled_posts WHERE state='active' AND next_run_at<=$1 ORDER BY next_run_at LIMIT 12 FOR UPDATE SKIP LOCKED",
        [now],
      )
    ).rows;
    for (const p of rows)
      await c.query(
        "UPDATE scheduled_posts SET state='posting',updated_at=now() WHERE id=$1",
        [p.id],
      );
    return rows;
  });
  await mapConcurrent(posts, 2, async (p) => {
    const {api,botId}=await apiIdentityForChat(p.chat_id,fallbackApi,fallbackBotId);
    let state = "paused",
      detail = "",
      messageId: number | null = null;
    try {
      const chat = await getChat(p.chat_id);
      if (!chat?.active || !hasFeature(chat, "scheduledPosts", p.actor_id))
        throw new Error(tr("Grupo inactivo o plan Pro no disponible."));
      await assertActorRight(
        {
          api,
          botId,
          chat,
          chatId: p.chat_id,
          settings: settingsOf(chat),
          actorId: p.actor_id,
          actorName: tr("Programación"),
        },
        "can_change_info",
      );
      const bot = await getChatMemberSafe(api, p.chat_id, botId);
      if (
        !bot ||
        !["administrator", "creator"].includes(bot.status) ||
        (chat.type === "channel" &&
          bot.status === "administrator" &&
          !bot.can_post_messages)
      )
        throw new Error(tr("El bot necesita permisos para publicar."));
      if (now.getTime() - p.next_run_at.getTime() > 86400000)
        throw new Error(
          tr("La programación venció hace más de un día; revisa antes de publicar."),
        );
      const result = await onceOperation(
        `publication:${p.chat_id}:${p.id}:${p.version}:${p.next_run_at.toISOString()}`,
        () =>
          api.sendMessage(p.chat_id, p.content, {
            message_thread_id: p.thread_id || undefined,
            link_preview_options: { is_disabled: true },
            reply_markup: p.button_url
              ? {
                  inline_keyboard: [
                    [{ text: p.button_label!, url: p.button_url }],
                  ],
                }
              : undefined,
          }),
      );
      messageId = result.message_id;
      state = "sent";
    } catch (error) {
      const known = [
        tr("Grupo inactivo o plan Pro no disponible."),
        tr("El bot necesita permisos para publicar."),
        tr("La programación venció hace más de un día; revisa antes de publicar."),
      ];
      detail =
        error instanceof Error && known.includes(error.message)
          ? error.message
          : error instanceof ModerationError
            ? tr("El autor ya no tiene permisos para programar.")
            : tr("Respuesta incierta de Telegram. Revisa el chat antes de reprogramar.");
      if (!known.includes(detail) && !(error instanceof ModerationError))
        state = "review";
    }
    const next =
      state === "sent"
        ? nextPublicationTime(p, new Date(Math.max(now.getTime(), Date.now())))
        : null;
    await withTransaction(async (c) => {
      await c.query(
        "INSERT INTO publication_runs(post_id,chat_id,scheduled_at,state,message_id,detail) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
        [
          p.id,
          p.chat_id,
          p.next_run_at,
          state,
          messageId,
          detail.slice(0, 300) || null,
        ],
      );
      await c.query(
        "UPDATE scheduled_posts SET state=$2,next_run_at=COALESCE($3,next_run_at),last_error=$4,version=version+1,updated_at=now() WHERE id=$1",
        [
          p.id,
          state === "sent" ? (next ? "active" : "completed") : state,
          next,
          detail.slice(0, 300) || null,
        ],
      );
    });
    if (messageId)
      await logModeration({
        chatId: p.chat_id,
        actorId: p.actor_id,
        action: "scheduled_post",
        reason: p.title,
        metadata: { postId: p.id, messageId },
      });
  });
}
export async function listPublications(chatId: number) {
  return {
    posts: await many(
      "SELECT * FROM scheduled_posts WHERE chat_id=$1 AND state<>'archived' ORDER BY next_run_at LIMIT 200",
      [chatId],
    ),
    runs: await many(
      "SELECT r.*,p.title FROM publication_runs r JOIN scheduled_posts p ON p.id=r.post_id WHERE r.chat_id=$1 ORDER BY r.id DESC LIMIT 50",
      [chatId],
    ),
  };
}
