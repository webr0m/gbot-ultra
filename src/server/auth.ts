import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { User } from "grammy/types";
import { config } from "../config.js";

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

export interface TelegramAuth {
  user: User;
  authDate: number;
  queryId?: string;
  startParam?: string;
  dev: boolean;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseUser(raw: string | null): User | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as User;
    if (!value || typeof value !== "object") return null;
    if (!Number.isSafeInteger(value.id) || value.id <= 0) return null;
    if (typeof value.first_name !== "string") return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Valida la firma de `Telegram.WebApp.initData` según la documentación de
 * Telegram: HMAC-SHA256 con la clave secreta derivada del token del bot.
 */
export function verifyInitData(initData: string): TelegramAuth | null {
  if (!initData || initData.length > 16_384) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(config.botToken).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!safeEqual(computed, hash.toLowerCase())) return null;

  const authDate = Number(params.get("auth_date") ?? "0");
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return null;
  if (Math.floor(Date.now() / 1_000) - authDate > MAX_AUTH_AGE_SECONDS) return null;

  const user = parseUser(params.get("user"));
  if (!user) return null;

  return {
    user,
    authDate,
    queryId: params.get("query_id") ?? undefined,
    startParam: params.get("start_param") ?? undefined,
    dev: false,
  };
}

export function authFromRequest(request: FastifyRequest): TelegramAuth | null {
  const header = request.headers["x-telegram-init-data"];
  const rawHeader = Array.isArray(header) ? header[0] : header;
  if (rawHeader) {
    const auth = verifyInitData(rawHeader);
    if (auth) return auth;
  }

  const query = request.query as Record<string, unknown> | undefined;
  if (query && typeof query.initData === "string") {
    const auth = verifyInitData(query.initData);
    if (auth) return auth;
  }

  // Modo desarrollo local: permite probar la API sin Telegram.
  if (config.devMode && config.nodeEnv !== "production") {
    const devHeader = request.headers["x-dev-user"];
    const rawDev = Array.isArray(devHeader) ? devHeader[0] : devHeader;
    const id = Number(rawDev);
    if (Number.isSafeInteger(id) && id > 0) {
      return {
        user: {
          id,
          is_bot: false,
          first_name: `Dev ${id}`,
          username: `dev_${id}`,
          language_code: "es",
        },
        authDate: Math.floor(Date.now() / 1_000),
        dev: true,
      };
    }
  }

  return null;
}

/** Token de corta duración para servir avatares sin exponer initData en la URL. */
export function avatarToken(chatId: number, userId: number, ttlSeconds = 3_600): string {
  const expires = Math.floor(Date.now() / 1_000) + ttlSeconds;
  const signature = createHmac("sha256", config.botToken)
    .update(`avatar:${chatId}:${userId}:${expires}`)
    .digest("base64url");
  return `${expires}.${signature}`;
}

export function verifyAvatarToken(chatId: number, userId: number, token: string): boolean {
  const [expiresRaw, signature] = token.split(".");
  if (!expiresRaw || !signature) return false;
  const expires = Number(expiresRaw);
  if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1_000)) return false;
  const expected = createHmac("sha256", config.botToken)
    .update(`avatar:${chatId}:${userId}:${expires}`)
    .digest("base64url");
  return safeEqual(expected, signature);
}

export function avatarUrl(chatId: number, userId: number): string {
  return `/api/avatar/${userId}?chat_id=${chatId}&t=${encodeURIComponent(avatarToken(chatId, userId))}`;
}
