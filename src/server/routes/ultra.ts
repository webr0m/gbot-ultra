import type { FastifyInstance } from "fastify";
import type { Bot } from "grammy";
import { z } from "zod";
import type { AppContext } from "../../bot/context.js";
import { config } from "../../config.js";
import {
  requireAuth,
  requireChat,
  parseChatId,
  bodyOf,
  ApiError,
} from "../helpers.js";
import { hasFeature } from "../../services/entitlements.js";
import { assertActorRight } from "../../services/moderation.js";
import { settingsOf } from "../../services/chat-cache.js";
import { aiSummary, saveAI, askAI } from "../../services/ai-assistant.js";
import {
  brandSummary,
  inspectBrandToken,
  saveBrand,
  changeBrandState,
} from "../../services/branded-bots.js";
import { logModeration } from "../../db/repositories/moderation.js";
const version = z.number().int().min(0),
  token = z.string().trim().min(30).max(200);
export function registerUltraRoutes(
  app: FastifyInstance,
  bot: Bot<AppContext>,
  primary: Bot<AppContext>,
) {
  async function access(
    request: Parameters<typeof requireAuth>[0],
    chatId: number,
    feature?: "ai" | "branding",
    creator = false,
  ) {
    const auth = requireAuth(request),
      chat = await requireChat(primary.api, chatId, auth);
    if (feature && !hasFeature(chat, feature, auth.user.id))
      throw new ApiError(402, "Esta función requiere Ultra.");
    if (request.method !== "GET")
      await assertActorRight(
        {
          api: primary.api,
          botId: primary.botInfo.id,
          chatId,
          chat,
          settings: settingsOf(chat),
          actorId: auth.user.id,
          actorName: auth.user.first_name,
        },
        "can_change_info",
      );
    if (creator && !config.ownerIds.has(auth.user.id)) {
      const member = await primary.api
        .getChatMember(chatId, auth.user.id)
        .catch(() => null);
      if (member?.status !== "creator")
        throw new ApiError(
          403,
          "La conexión debe autorizarla el creador del grupo.",
        );
    }
    return { auth, chat };
  }
  app.get("/api/ultra", async (request) => {
    const { chat, auth } = await access(
      request,
      parseChatId((request.query as Record<string, unknown>).chat_id),
    );
    const [ai, branding] = await Promise.all([
      aiSummary(chat.chat_id),
      brandSummary(chat.chat_id),
    ]);
    return {
      ok: true,
      allowed: hasFeature(chat, "ai", auth.user.id),
      ai,
      branding,
    };
  });
  app.post("/api/ultra/ai", async (request) => {
    const b = bodyOf(request),
      { chat, auth } = await access(
        request,
        parseChatId(b.chatId),
        (b.settings as { enabled?: unknown })?.enabled === false
          ? undefined
          : "ai",
      );
    const result = await saveAI(
      chat.chat_id,
      auth.user.id,
      b.settings,
      version.parse(b.version),
    );
    await logModeration({
      chatId: chat.chat_id,
      actorId: auth.user.id,
      action: "ai_settings",
      reason: result.enabled ? "Asistente activado" : "Asistente desactivado",
    });
    return { ok: true, config: result };
  });
  app.post("/api/ultra/ask", async (request) => {
    const b = bodyOf(request),
      { chat, auth } = await access(request, parseChatId(b.chatId), "ai");
    try {
      return {
        ok: true,
        ...(await askAI(chat.chat_id, auth.user.id, b.question)),
      };
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 503)
        throw new ApiError(503, (error as Error).message);
      throw error;
    }
  });
  app.post("/api/ultra/brand", async (request) => {
    const b = bodyOf(request),
      action = z.enum(["inspect", "save", "activate", "pause"]).parse(b.action),
      { chat, auth } = await access(
        request,
        parseChatId(b.chatId),
        action === "pause" ? undefined : "branding",
        true,
      );
    try {
      if (action === "inspect") {
        const result = await inspectBrandToken(token.parse(b.token));
        return {
          ok: true,
          bot: {
            id: result.info.id,
            username: result.info.username,
            name: result.info.first_name,
          },
          hasWebhook: result.hasWebhook,
        };
      }
      if (action === "save") {
        const result = await saveBrand(
          chat.chat_id,
          auth.user.id,
          token.parse(b.token),
          z.string().trim().min(1).max(64).parse(b.name),
          z.string().trim().max(512).parse(b.description),
          version.parse(b.version),
        );
        return { ok: true, bot: result };
      }
      const result = await changeBrandState(
        chat.chat_id,
        version.parse(b.version),
        action === "activate",
        b.replaceWebhook === true,
        auth.user.id,
      );
      await logModeration({
        chatId: chat.chat_id,
        actorId: auth.user.id,
        action: "brand_" + action,
        reason: "Bot con marca propia",
      });
      return result;
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode) throw error;
      throw new ApiError(
        502,
        "Telegram no pudo completar la conexión. Revisa el estado antes de reintentar.",
      );
    }
  });
}
