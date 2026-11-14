import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Bot } from "grammy";
import { z } from "zod";
import type { AppContext } from "../../bot/context.js";
import { getChat } from "../../db/repositories/chats.js";
import {
  countModerationLog,
  listModerationLog,
  logModeration,
} from "../../db/repositories/moderation.js";
import { getUser } from "../../db/repositories/users.js";
import {
  countTrackedMembers,
  getWarnCounts,
  listMembers,
} from "../../db/repositories/members.js";
import { getDailyStats, getTotals } from "../../db/repositories/stats.js";
import { settingsOf } from "../../services/chat-cache.js";
import { hasFeature } from "../../services/entitlements.js";
import {
  banUser,
  kickUser,
  ModerationError,
  muteUser,
  unbanUser,
  unmuteUser,
  warnUser,
  type ModerationContext,
  type TargetInfo,
} from "../../services/moderation.js";
import { displayName } from "../../utils/format.js";
import { getChatMemberSafe } from "../../utils/telegram.js";
import {
  API_RATE_LIMIT,
  checkKeyRate,
  hasScope,
  recordApiUse,
  verifyApiKey,
  type ApiKeyRow,
  type ApiScope,
} from "../../services/api-access.js";
import { ApiError, bodyOf, parseIntParam } from "../helpers.js";
import { serializeLog } from "../serializers.js";

const MODERATION_ACTIONS = ["ban", "unban", "mute", "unmute", "kick", "warn"] as const;
type ModerationAction = (typeof MODERATION_ACTIONS)[number];

const moderationSchema = z.object({
  action: z.enum(MODERATION_ACTIONS),
  userId: z.number().int().safe().positive(),
  reason: z.string().trim().max(500).optional(),
  durationSeconds: z.number().int().min(0).max(2_592_000).optional(),
});

const ENDPOINTS = [
  { method: "GET", path: "/api/v1", scope: null, description: "Referencia de la API." },
  { method: "GET", path: "/api/v1/me", scope: "read", description: "Identidad del grupo y de la clave." },
  { method: "GET", path: "/api/v1/members", scope: "read", description: "Miembros del grupo." },
  { method: "GET", path: "/api/v1/stats", scope: "read", description: "Actividad por día y totales." },
  { method: "GET", path: "/api/v1/settings", scope: "read", description: "Ajustes del grupo." },
  { method: "GET", path: "/api/v1/moderation/log", scope: "read", description: "Historial de moderación." },
  { method: "POST", path: "/api/v1/moderation", scope: "moderate", description: "Aplicar una sanción o una advertencia." },
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

  async function resolveTarget(chatId: number, userId: number): Promise<TargetInfo> {
    const member = await getChatMemberSafe(bot.api, chatId, userId);
    if (member)
      return {
        userId,
        name: displayName(member.user),
        username: member.user.username ?? null,
      };
    const user = await getUser(userId);
    if (user)
      return {
        userId,
        name: displayName({
          first_name: user.first_name,
          last_name: user.last_name,
          username: user.username,
        }),
        username: user.username,
      };
    throw new ApiError(404, "Ese usuario no existe o no está en el grupo.");
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
    const [rows, total, warns] = await Promise.all([
      listMembers(chat.chat_id, limit, search),
      countTrackedMembers(chat.chat_id),
      getWarnCounts(chat.chat_id),
    ]);
    return {
      ok: true,
      total,
      items: rows.map((member) => ({
        id: member.user_id,
        displayName:
          [member.first_name, member.last_name].filter(Boolean).join(" ").trim() ||
          member.username ||
          "Usuario",
        username: member.username,
        status: member.status,
        messages: Number(member.message_count ?? 0),
        warnings: warns.get(member.user_id) ?? 0,
        joinedAt: member.joined_at
          ? new Date(member.joined_at).toISOString()
          : null,
        lastMessageAt: member.last_message_at
          ? new Date(member.last_message_at).toISOString()
          : null,
      })),
    };
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
    const [daily, totals] = await Promise.all([
      getDailyStats(chat.chat_id, days),
      getTotals(chat.chat_id),
    ]);
    return {
      ok: true,
      days,
      totals: {
        messages: Number(totals.messages ?? 0),
        joins: Number(totals.joins ?? 0),
        leaves: Number(totals.leaves ?? 0),
        commands: Number(totals.commands ?? 0),
      },
      daily: daily.map((row) => ({
        date: row.date,
        messages: Number(row.messages ?? 0),
        joins: Number(row.joins ?? 0),
        leaves: Number(row.leaves ?? 0),
        commands: Number(row.commands ?? 0),
      })),
    };
  });

  app.get("/api/v1/settings", async (request) => {
    const { key, chat } = await authenticate(request);
    requireScope(key, "read");
    return { ok: true, settings: settingsOf(chat) };
  });

  app.get("/api/v1/moderation/log", async (request) => {
    const { key, chat } = await authenticate(request);
    requireScope(key, "read");
    const q = request.query as Record<string, unknown>;
    const limit = parseIntParam(q.limit, 30, 1, 100);
    const offset = parseIntParam(q.offset, 0, 0, 20_000);
    const action = typeof q.action === "string" ? q.action.trim().slice(0, 40) : "";
    const [items, total] = await Promise.all([
      listModerationLog(chat.chat_id, limit, offset, action),
      countModerationLog(chat.chat_id, action),
    ]);
    return {
      ok: true,
      total,
      hasMore: offset + limit < total,
      items: items.map(serializeLog),
    };
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
    const context: ModerationContext = {
      api: bot.api,
      chatId: chat.chat_id,
      chat,
      settings: settingsOf(chat),
      botId: bot.botInfo.id,
      actorId: key.created_by,
      actorName: `API · ${key.name}`,
      source: "api",
    };
    try {
      switch (body.action) {
        case "ban":
          await banUser(context, {
            target,
            reason: body.reason ?? "Regla de la API",
            durationSeconds: body.durationSeconds ?? null,
          });
          break;
        case "unban":
          await unbanUser(context, target);
          break;
        case "kick":
          await kickUser(context, {
            target,
            reason: body.reason ?? "Regla de la API",
          });
          break;
        case "mute":
          await muteUser(context, {
            target,
            reason: body.reason ?? "Regla de la API",
            durationSeconds: body.durationSeconds ?? 3_600,
          });
          break;
        case "unmute":
          await unmuteUser(context, target);
          break;
        case "warn": {
          const result = await warnUser(context, target, body.reason ?? null);
          await logModeration({
            chatId: chat.chat_id,
            actorId: key.created_by,
            targetId: target.userId,
            action: "api_warn",
            reason: body.reason ?? null,
            metadata: { keyId: key.id, keyName: key.name, count: result.count },
          });
          return {
            ok: true,
            action: body.action,
            warning: result,
            message: `Advertencia ${result.count}/${result.limit} para ${target.name}.`,
          };
        }
      }
    } catch (error) {
      if (error instanceof ModerationError)
        throw new ApiError(400, error.userMessage);
      throw error;
    }
    await logModeration({
      chatId: chat.chat_id,
      actorId: key.created_by,
      targetId: target.userId,
      action: `api_${body.action}`,
      reason: body.reason ?? null,
      durationSeconds: body.durationSeconds ?? null,
      metadata: { keyId: key.id, keyName: key.name },
    });
    return {
      ok: true,
      action: body.action,
      target,
      message: `${body.action}: ${target.name}.`,
    };
  });
}
