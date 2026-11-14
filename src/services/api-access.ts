import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { many, one } from "../db/pool.js";

export const API_SCOPES = ["read", "moderate"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

const KEY_PREFIX = "gbot_live_";
const SECRET_BYTES = 32;
const LOOKUP_CHARS = 12;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 60;

export interface ApiKeyRow {
  id: string;
  chat_id: number;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  created_by: number;
  created_at: Date;
  last_used_at: Date | null;
  requests_total: number;
  revoked_at: Date | null;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdAt: string;
  lastUsedAt: string | null;
  requests: number;
  revoked: boolean;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function lookupPrefix(key: string): string {
  return key.slice(KEY_PREFIX.length, KEY_PREFIX.length + LOOKUP_CHARS);
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const key = `${KEY_PREFIX}${secret}`;
  return { key, prefix: lookupPrefix(key), hash: hashApiKey(key) };
}

function safeHashEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeScopes(scopes: readonly string[]): ApiScope[] {
  const wanted = API_SCOPES.filter((scope) => scopes.includes(scope));
  return wanted.length ? wanted : ["read"];
}

export async function createApiKey(
  chatId: number,
  actorId: number,
  name: string,
  scopes: readonly string[],
): Promise<ApiKeyRow & { key: string }> {
  const secret = generateApiKey();
  const row = await one<ApiKeyRow>(
    `INSERT INTO api_keys (id, chat_id, name, key_prefix, key_hash, scopes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      randomUUID(),
      chatId,
      name,
      secret.prefix,
      secret.hash,
      normalizeScopes(scopes),
      actorId,
    ],
  );
  return { ...row!, key: secret.key };
}

export async function listApiKeys(chatId: number): Promise<ApiKeyRow[]> {
  return many<ApiKeyRow>(
    `SELECT * FROM api_keys
      WHERE chat_id = $1
      ORDER BY created_at DESC`,
    [chatId],
  );
}

export async function revokeApiKey(chatId: number, id: string): Promise<boolean> {
  const result = await one<{ id: string }>(
    `UPDATE api_keys
        SET revoked_at = now()
      WHERE id = $1 AND chat_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [id, chatId],
  );
  return Boolean(result);
}

export async function verifyApiKey(key: string): Promise<ApiKeyRow | null> {
  if (typeof key !== "string" || !key.startsWith(KEY_PREFIX) || key.length > 120)
    return null;
  const row = await one<ApiKeyRow>(
    "SELECT * FROM api_keys WHERE key_prefix = $1 LIMIT 1",
    [lookupPrefix(key)],
  );
  if (!row || row.revoked_at) return null;
  if (!safeHashEqual(row.key_hash, hashApiKey(key))) return null;
  return row;
}

export async function recordApiUse(id: string): Promise<void> {
  await one(
    `UPDATE api_keys
        SET last_used_at = now(), requests_total = requests_total + 1
      WHERE id = $1
      RETURNING id`,
    [id],
  );
}

export function hasScope(row: ApiKeyRow, scope: ApiScope): boolean {
  return row.scopes.includes(scope);
}

export function summarizeApiKey(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.key_prefix,
    scopes: normalizeScopes(row.scopes),
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
    requests: Number(row.requests_total ?? 0),
    revoked: Boolean(row.revoked_at),
  };
}

interface RateEntry {
  count: number;
  resetAt: number;
}

const rate = new Map<string, RateEntry>();

export function checkKeyRate(
  id: string,
  now = Date.now(),
): { allowed: boolean; remaining: number } {
  const entry = rate.get(id);
  if (!entry || entry.resetAt <= now) {
    if (rate.size > 5_000) rate.clear();
    rate.set(id, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, remaining: RATE_MAX_REQUESTS - 1 };
  }
  entry.count += 1;
  if (entry.count > RATE_MAX_REQUESTS) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: RATE_MAX_REQUESTS - entry.count };
}

export const API_RATE_LIMIT = RATE_MAX_REQUESTS;
