import { one } from "../pool.js";
import type { UserRow } from "../types.js";
import { ReadCache } from "../../services/read-cache.js";

const profileCache = new ReadCache(5000);
const profiles = new Map<number, string>();

export interface UserUpsertInput {
  id: number;
  username?: string | null;
  first_name: string;
  last_name?: string | null;
  language_code?: string | null;
  is_bot?: boolean;
}

export async function upsertUser(input: UserUpsertInput): Promise<UserRow> {
  const values = [input.id, input.username ?? null, input.first_name ?? "", input.last_name ?? null, input.language_code ?? null, input.is_bot ?? false];
  const fingerprint = JSON.stringify(values);
  const key = String(input.id);
  if (profiles.get(input.id) !== fingerprint) {
    profileCache.invalidate(key);
    profiles.delete(input.id);
    if (profiles.size >= 5000) profiles.delete(profiles.keys().next().value!);
    profiles.set(input.id, fingerprint);
  }
  return profileCache.get(key, 60_000, async () => {
    const row = await one<UserRow>(
    `INSERT INTO users (user_id, username, first_name, last_name, language_code, is_bot, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (user_id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       language_code = COALESCE(EXCLUDED.language_code, users.language_code),
       is_bot = EXCLUDED.is_bot,
       last_seen_at = now()
     RETURNING *`,
    values,
  );
    return row!;
  }, key);
}

export async function getUser(userId: number): Promise<UserRow | null> {
  return one<UserRow>("SELECT * FROM users WHERE user_id = $1", [userId]);
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  return one<UserRow>("SELECT * FROM users WHERE lower(username) = lower($1) LIMIT 1", [
    username.replace(/^@/, ""),
  ]);
}

export async function countUsers(): Promise<number> {
  const row = await one<{ total: number }>("SELECT COUNT(*)::int AS total FROM users");
  return row?.total ?? 0;
}
