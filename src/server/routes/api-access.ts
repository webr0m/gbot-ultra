import type { FastifyInstance } from "fastify";
import type { Bot } from "grammy";
import { z } from "zod";
import type { AppContext } from "../../bot/context.js";
import { hasFeature } from "../../services/entitlements.js";
import { assertActorRight, ModerationError } from "../../services/moderation.js";
import { settingsOf } from "../../services/chat-cache.js";
import { displayName } from "../../utils/format.js";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  summarizeApiKey,
  API_SCOPES,
} from "../../services/api-access.js";
import { logModeration } from "../../db/repositories/moderation.js";
import {
  ApiError,
  bodyOf,
  parseChatId,
  requireAuth,
  requireChat,
} from "../helpers.js";

const createSchema = z.object({
  chatId: z.number().int().safe(),
  name: z.string().trim().min(2).max(48),
  scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length),
});

const revokeSchema = z.object({
  chatId: z.number().int().safe(),
  id: z.string().uuid(),
});

export function registerApiAccessRoutes(
  app: FastifyInstance,
  bot: Bot<AppContext>,
): void {
  async function access(request: Parameters<typeof requireAuth>[0], chatId: number) {
    const auth = requireAuth(request);
    const chat = await requireChat(bot.api, chatId, auth);
    if (!hasFeature(chat, "apiAccess", auth.user.id))
      throw new ApiError(402, "La API para automatizaciones requiere Ultra.");
    return { auth, chat };
  }

  app.get("/api/access/keys", async (request) => {
    const chatId = parseChatId(
      (request.query as Record<string, unknown>).chat_id ??
        (request.query as Record<string, unknown>).chatId,
    );
    const { chat } = await access(request, chatId);
    const rows = await listApiKeys(chat.chat_id);
    return { ok: true, keys: rows.map(summarizeApiKey) };
  });

  app.post("/api/access/keys", async (request) => {
    const parsed = createSchema.safeParse(bodyOf(request));
    if (!parsed.success)
      throw new ApiError(400, "Datos de la clave no válidos.", {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    const body = parsed.data;
    const { auth, chat } = await access(request, body.chatId);
    try {
      await assertActorRight(
        {
          api: bot.api,
          chatId: chat.chat_id,
          chat,
          settings: settingsOf(chat),
          botId: bot.botInfo.id,
          actorId: auth.user.id,
          actorName: displayName(auth.user),
          source: "miniapp",
        },
        "can_change_info",
      );
    } catch (error) {
      if (error instanceof ModerationError)
        throw new ApiError(403, error.userMessage);
      throw error;
    }
    const row = await createApiKey(
      chat.chat_id,
      auth.user.id,
      body.name,
      body.scopes,
    );
    await logModeration({
      chatId: chat.chat_id,
      actorId: auth.user.id,
      action: "api_key_created",
      reason: row.name,
      metadata: { scopes: row.scopes, keyId: row.id },
    });
    return {
      ok: true,
      key: summarizeApiKey(row),
      // The plain secret exists only in this response; the panel shows it once.
      secret: row.key,
    };
  });

  app.post("/api/access/keys/revoke", async (request) => {
    const parsed = revokeSchema.safeParse(bodyOf(request));
    if (!parsed.success) throw new ApiError(400, "Clave no válida.");
    const body = parsed.data;
    const { auth, chat } = await access(request, body.chatId);
    try {
      await assertActorRight(
        {
          api: bot.api,
          chatId: chat.chat_id,
          chat,
          settings: settingsOf(chat),
          botId: bot.botInfo.id,
          actorId: auth.user.id,
          actorName: displayName(auth.user),
          source: "miniapp",
        },
        "can_change_info",
      );
    } catch (error) {
      if (error instanceof ModerationError)
        throw new ApiError(403, error.userMessage);
      throw error;
    }
    const revoked = await revokeApiKey(chat.chat_id, body.id);
    if (!revoked) throw new ApiError(404, "Esa clave no existe o ya estaba anulada.");
    await logModeration({
      chatId: chat.chat_id,
      actorId: auth.user.id,
      action: "api_key_revoked",
      reason: body.id,
      metadata: { keyId: body.id },
    });
    return { ok: true, revoked: true };
  });
}
