import type { Api } from "grammy";
import type { FastifyRequest } from "fastify";
import { config } from "../config.js";
import { getChat } from "../db/repositories/chats.js";
import type { ChatRow } from "../db/types.js";
import { getChatMemberSafe, isAdminStatus } from "../utils/telegram.js";
import { authFromRequest, type TelegramAuth } from "./auth.js";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function requireAuth(request: FastifyRequest): TelegramAuth {
  const auth = authFromRequest(request);
  if (!auth) {
    throw new ApiError(
      401,
      "Sesión de Telegram no válida o caducada. Abre el panel desde el bot.",
    );
  }
  return auth;
}

export async function requireChat(
  api: Api,
  chatId: number,
  auth: TelegramAuth,
): Promise<ChatRow> {
  const chat = await getChat(chatId);
  if (!chat || !chat.active) {
    throw new ApiError(404, "Grupo no encontrado o el bot ya no está en él.");
  }
  if (config.ownerIds.has(auth.user.id)) return chat;

  const member = await getChatMemberSafe(api, chatId, auth.user.id);
  if (!member || !isAdminStatus(member.status)) {
    throw new ApiError(403, "Solo los administradores del grupo pueden usar el panel.");
  }
  return chat;
}

export function parseChatId(value: unknown): number {
  const chatId = typeof value === "string" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(chatId) || chatId === 0) {
    throw new ApiError(400, "El identificador del grupo no es válido.");
  }
  return chatId;
}

export function parseIntParam(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "string" ? Number(value) : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function parseString(value: unknown, maxLength = 500): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function bodyOf(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    throw new ApiError(400, "El cuerpo de la petición no es válido.");
  }
  return request.body as Record<string, unknown>;
}

export function boolParam(value: unknown): boolean | null {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
}
