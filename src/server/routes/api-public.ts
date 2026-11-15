import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Bot } from "grammy";
import { z } from "zod";
import type { AppContext } from "../../bot/context.js";
import { getChat } from "../../db/repositories/chats.js";
import { hasFeature } from "../../services/entitlements.js";
import { ModerationError } from "../../services/moderation.js";
import {
  API_RATE_LIMIT,
  checkKeyRate,
  hasScope,
  recordApiUse,
  verifyApiKey,
  type ApiKeyRow,
  type ApiScope,
} from "../../services/api-access.js";
import {
  ADMIN_ACTIONS,
  ADMIN_PRESETS,
  ApiTargetNotFoundError,
  MODERATION_ACTIONS,
  apiModerationContext,
  applyApiAdminChange,
  applyApiModeration,
  readApiAdmins,
  readApiMembers,
  readApiModerationLog,
  readApiSettings,
  readApiStats,
  resolveApiTarget,
  type AdminAction,
  type ModerationAction,
} from "../api-actions.js";
import { ApiError, bodyOf, parseIntParam } from "../helpers.js";

const moderationSchema = z.object({
  action: z.enum(MODERATION_ACTIONS),
  userId: z.number().int().safe().positive(),
  reason: z.string().trim().max(500).optional(),
  durationSeconds: z.number().int().min(0).max(2_592_000).optional(),
});

const adminSchema = z.object({
  action: z.enum(ADMIN_ACTIONS),
  userId: z.number().int().safe().positive(),
  preset: z.enum(ADMIN_PRESETS).optional(),
  customTitle: z.string().trim().max(16).optional(),
});

const ENDPOINTS = [
  { method: "GET", path: "/api/v1", scope: null, description: "Referencia de la API." },
  { method: "GET", path: "/api/v1/me", scope: "read", description: "Identidad del grupo y de la clave." },
  { method: "GET", path: "/api/v1/members", scope: "read", description: "Miembros del grupo." },
  { method: "GET", path: "/api/v1/admins", scope: "read", description: "Administradores del grupo y sus permisos." },
  { method: "GET", path: "/api/v1/stats", scope: "read", description: "Actividad por día y totales." },
  { method: "GET", path: "/api/v1/settings", scope: "read", description: "Ajustes del grupo." },
  { method: "GET", path: "/api/v1/moderation/log", scope: "read", description: "Historial de moderación." },
  { method: "POST", path: "/api/v1/moderation", scope: "moderate", description: "Aplicar una sanción o una advertencia." },
  { method: "POST", path: "/api/v1/admins", scope: "moderate", description: "Promover o degradar a un administrador." },
] as const;

function bearerToken(request: { headers: Record<string, unknown> }): string {
  const header = request.headers.authorization;
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== "string") return "";
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1]!.trim() : "";
}

export function registerApiPublicRoutes(
  app: FastifyInstance,
  bot: Bot<AppContext>,
): void {
  async function authenticate(request: FastifyRequest) {
    const token = bearerToken(request);
    if (!token) {
      throw new ApiError(
        401,
        "Falta la cabecera Authorization: Bearer <clave>.",
      );
    }
    const key = await verifyApiKey(token);
    if (!key) throw new ApiError(401, "La clave no es válida o está anulada.");
    const limit = checkKeyRate(key.id);
    if (!limit.allowed)
      throw new ApiError(429, "Demasiadas peticiones. Espera un minuto.");
    const chat = await getChat(key.chat_id);
    if (!chat || !chat.active)
      throw new ApiError(404, "El grupo ya no está disponible.");
    if (!hasFeature(chat, "apiAccess", key.created_by))
      throw new ApiError(402, "Esta función requiere Ultra.");
    await recordApiUse(key.id);
    return { key, chat };
  }

  function requireScope(key: ApiKeyRow, scope: ApiScope): void {
    if (!hasScope(key, scope))
      throw new ApiError(403, `La clave no tiene el ámbito ${scope}.`);
  }

  async function resolveTarget(chatId: number, userId: number) {
    try {
      return await resolveApiTarget(bot.api, chatId, userId);
    } catch (error) {
      if (error instanceof ApiTargetNotFoundError)
        throw new ApiError(404, "Ese usuario no existe o no está en el grupo.");
      throw error;
    }
  }

  app.get("/api/v1", async () => ({
    ok: true,
    service: "GBot Ultra API",
    version: 1,
    authentication: "Authorization: Bearer <clave>",
    rateLimit: { requestsPerMinute: API_RATE_LIMIT },
    scopes: ["read", "moderate"],
    endpoints: ENDPOINTS,
  }));

  app.get("/api/v1/me", async (request) => {
    const { key, chat } = await authenticate(request);
    requireScope(key, "read");
    return {
      ok: true,
      group: {
        id: chat.chat_id,
        title: chat.title,
        username: chat.username,
        type: chat.type,
      },
      key: { name: key.name, scopes: key.scopes },
    };
  });

  app.get("/api/v1/members", async (request) => {
    const { key, chat } = await authenticate(request);
    requireScope(key, "read");
    const q = request.query as Record<string, unknown>;
    const limit = parseIntParam(q.limit, 50, 1, 200);
    const search = typeof q.search === "string" ? q.search.trim().slice(0, 64) : "";
    return readApiMembers(chat, limit, search);
  });

  app.get("/api/v1/admins", async (request) => {
    const { key, chat } = await authenticate(request);
    requireScope(key, "read");
    return readApiAdmins(bot.api, chat.chat_id);
  });

  app.get("/api/v1/stats", async (request) => {
    const { key, chat } = await authenticate(request);
    requireScope(key, "read");
    const days = parseIntParam(
      (request.query as Record<string, unknown>).days,
      7,
      1,
      90,
    );
    return readApiStats(chat, days);
  });

  app.get("/api/v1/settings", async (request) => {
    const { key, chat } = await authenticate(request);
    requireScope(key, "read");
    return readApiSettings(chat);
  });

  app.get("/api/v1/moderation/log", async (request) => {
    const { key, chat } = await authenticate(request);
    requireScope(key, "read");
    const q = request.query as Record<string, unknown>;
    const limit = parseIntParam(q.limit, 30, 1, 100);
    const offset = parseIntParam(q.offset, 0, 0, 20_000);
    const action = typeof q.action === "string" ? q.action.trim().slice(0, 40) : "";
    return readApiModerationLog(chat, limit, offset, action);
  });

  app.post("/api/v1/moderation", async (request) => {
    const parsed = moderationSchema.safeParse(bodyOf(request));
    if (!parsed.success)
      throw new ApiError(400, "Datos de moderación no válidos.", {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    const body = parsed.data;
    const { key, chat } = await authenticate(request);
    requireScope(key, "moderate");
    const target = await resolveTarget(chat.chat_id, body.userId);
    const context = apiModerationContext(
      bot.api,
      chat,
      bot.botInfo.id,
      key,
      "API",
    );
    try {
      return await applyApiModeration(
        context,
        body.action as ModerationAction,
        target,
        body.reason ?? null,
        body.durationSeconds ?? null,
        key,
        "api",
        "Regla de la API",
      );
    } catch (error) {
      if (error instanceof ModerationError)
        throw new ApiError(400, error.userMessage);
      throw error;
    }
  });

  app.post("/api/v1/admins", async (request) => {
    const parsed = adminSchema.safeParse(bodyOf(request));
    if (!parsed.success)
      throw new ApiError(400, "Datos de administrador no válidos.", {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    const body = parsed.data;
    const { key, chat } = await authenticate(request);
    requireScope(key, "moderate");
    const target = await resolveTarget(chat.chat_id, body.userId);
    const context = apiModerationContext(
      bot.api,
      chat,
      bot.botInfo.id,
      key,
      "API",
    );
    try {
      return await applyApiAdminChange(
        context,
        body.action as AdminAction,
        target,
        body.preset ?? "moderator",
        body.customTitle ?? null,
        key,
        "api",
      );
    } catch (error) {
      if (error instanceof ModerationError)
        throw new ApiError(400, error.userMessage);
      throw error;
    }
  });
}
