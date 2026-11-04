import type { FastifyInstance } from "fastify";
import type { Bot } from "grammy";
import { z } from "zod";
import type { AppContext } from "../../bot/context.js";
import {
  requireAuth,
  requireChat,
  bodyOf,
  parseChatId,
  ApiError,
} from "../helpers.js";
import {
  hasFeature,
  chatTier,
  type AdvancedFeature,
} from "../../services/entitlements.js";
import { assertActorRight } from "../../services/moderation.js";
import { settingsOf } from "../../services/chat-cache.js";
import {
  publicationSchema,
  firstPublicationTime,
  savePublication,
  publicationState,
  listPublications,
} from "../../services/publications.js";
import {
  saveVisualConfig,
  visualSummary,
} from "../../services/visual-moderation.js";
import { query } from "../../db/pool.js";
import { logModeration } from "../../db/repositories/moderation.js";
import { config } from "../../config.js";
const id = z.number().int().safe().positive(),
  version = z.number().int().min(0);
export function registerAutomationRoutes(
  app: FastifyInstance,
  bot: Bot<AppContext>,
) {
  async function access(
    request: Parameters<typeof requireAuth>[0],
    chatId: number,
    feature?: AdvancedFeature,
    right = "can_change_info",
  ) {
    const auth = requireAuth(request),
      chat = await requireChat(bot.api, chatId, auth);
    if (feature && !hasFeature(chat, feature, auth.user.id))
      throw new ApiError(402, "Esta función requiere Pro o Ultra.");
    if (request.method !== "GET")
      await assertActorRight(
        {
          api: bot.api,
          chatId,
          chat,
          settings: settingsOf(chat),
          botId: bot.botInfo.id,
          actorId: auth.user.id,
          actorName: auth.user.first_name,
          source: "miniapp",
        },
        right,
      );
    return { chat, auth };
  }
  app.get("/api/automations", async (request) => {
    const { chat, auth } = await access(
      request,
      parseChatId((request.query as Record<string, unknown>).chat_id),
    );
    const [publications, visual] = await Promise.all([
      listPublications(chat.chat_id),
      visualSummary(chat.chat_id),
    ]);
    const unlimited = config.ownerIds.has(auth.user.id);
    return {
      ok: true,
      ...publications,
      visual,
      tier: chatTier(chat, auth.user.id),
      features: {
        publications: hasFeature(chat, "scheduledPosts", auth.user.id),
        visual: hasFeature(chat, "nsfw", auth.user.id),
      },
      limits: {
        posts: unlimited
          ? null
          : chatTier(chat, auth.user.id) === "ultra"
            ? 100
            : 20,
        photos: unlimited
          ? null
          : chatTier(chat, auth.user.id) === "ultra"
            ? 300
            : 100,
      },
    };
  });
  app.post("/api/automations/publication", async (request) => {
    const b = bodyOf(request),
      action = z.enum(["preview", "save", "pause", "archive"]).parse(b.action);
    // Pausing and archiving remain possible after a plan expires.
    const { chat, auth } = await access(
      request,
      parseChatId(b.chatId),
      action === "pause" || action === "archive" ? undefined : "scheduledPosts",
    );
    if (action === "pause" || action === "archive") {
      await publicationState(
        chat.chat_id,
        id.parse(b.id),
        version.parse(b.version),
        action,
      );
      return { ok: true };
    }
    const input = publicationSchema.parse(b.input),
      first = firstPublicationTime(input.localTime, input.timezone);
    if (action === "preview")
      return {
        ok: true,
        input,
        firstRun: first.toISOString(),
        notice:
          (input.article ? "Artículo enriquecido. " : "Texto sin formato. ") + "El cron de respaldo del hosting puede tardar hasta cinco minutos.",
      };
    const post = await savePublication(
      chat.chat_id,
      auth.user.id,
      input,
      b.id === undefined ? undefined : id.parse(b.id),
      b.version === undefined ? undefined : version.parse(b.version),
      z.string().uuid().parse(b.operationId),
    );
    await logModeration({
      chatId: chat.chat_id,
      actorId: auth.user.id,
      action: "publication_saved",
      reason: post.title,
      metadata: { postId: post.id },
    });
    return { ok: true, post };
  });
  app.post("/api/automations/visual", async (request) => {
    const b = bodyOf(request);
    // Disabling stays available even when a subscription has ended.
    const { chat, auth } = await access(
      request,
      parseChatId(b.chatId),
      (b.settings as { enabled?: unknown })?.enabled === false
        ? undefined
        : "nsfw",
      "can_delete_messages",
    );
    const settings = await saveVisualConfig(
      chat.chat_id,
      auth.user.id,
      b.settings,
      version.parse(b.version),
    );
    await logModeration({
      chatId: chat.chat_id,
      actorId: auth.user.id,
      action: "visual_settings",
      reason: settings.enabled
        ? "Filtro visual activado: " + settings.mode
        : "Filtro visual desactivado",
    });
    return { ok: true, config: settings };
  });
  app.post("/api/automations/visual/review", async (request) => {
    const b = bodyOf(request),
      { chat,auth } = await access(
        request,
        parseChatId(b.chatId),
        undefined,
        "can_delete_messages",
      );
    // Acknowledgement only; deletion, warnings and bans are never implied by review.
    await query(
      "WITH reviewed AS (UPDATE visual_jobs SET state='reviewed',updated_at=now() WHERE chat_id=$1 AND id=$2 AND state IN ('review','unavailable') RETURNING chat_id,id) INSERT INTO inbox_decisions(chat_id,kind,source_ref,state,decision,actor_id,resolved_at) SELECT chat_id,'visual',id::text,'resolved','acknowledge',$3,now() FROM reviewed ON CONFLICT(chat_id,kind,source_ref) DO UPDATE SET state='resolved',decision='acknowledge',actor_id=EXCLUDED.actor_id,resolved_at=now(),version=inbox_decisions.version+1",
      [chat.chat_id, id.parse(b.id),auth.user.id],
    );
    return { ok: true };
  });
}
