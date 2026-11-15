import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const oneMock = vi.hoisted(() => vi.fn(async () => null));
const manyMock = vi.hoisted(() => vi.fn(async () => []));
const queryMock = vi.hoisted(() => vi.fn(async () => ({ rows: [], rowCount: 1 })));
vi.mock("../src/config.js", () => ({
  config: {
    botMode: "webhook",
    webhookSecret: "w".repeat(32),
    schedulerMode: "external",
    internalCronSecret: "c".repeat(32),
    nodeEnv: "test",
    isProduction: true,
    ownerIds: new Set(),
    logLevel: "silent",
    databaseUrl: "",
    botToken: "test-token",
    devMode: false,
  },
}));
vi.mock("../src/db/pool.js", () => ({
  query: queryMock,
  one: oneMock,
  many: manyMock,
  withTransaction: vi.fn(),
  withSessionLock: async (_key: string, run: () => Promise<unknown>) => run(),
}));
vi.mock("../src/services/telegram-cache.js", () => ({
  withFreshTelegramReads: async (run: () => Promise<unknown>) => run(),
}));

import { buildServer } from "../src/server/app.js";
import { generateApiKey, hashApiKey } from "../src/services/api-access.js";

const secret = generateApiKey();
const chat = {
  chat_id: -1001,
  title: "Comunidad",
  username: "comunidad",
  type: "supergroup",
  premium_until: new Date(Date.now() + 86400000),
  premium_tier: "ultra",
  pro_license_id: null,
  active: true,
  settings: {},
} as never;

let app: FastifyInstance;
let scopes: string[];

beforeEach(async () => {
  scopes = ["read"];
  const bot = {
    api: {
      getChat: vi.fn(async () => ({ type: "supergroup", permissions: { can_restrict_members: true } })),
      getChatMember: vi.fn(async (_chatId: number, userId: number) => ({
        status: userId === 42 ? "creator" : userId === 999 ? "administrator" : "member",
        can_restrict_members: true,
        can_delete_messages: true,
        can_change_info: true,
        user: { id: userId, first_name: "Miembro" },
      })),
      banChatMember: vi.fn(async () => true),
      unbanChatMember: vi.fn(async () => true),
      restrictChatMember: vi.fn(async () => true),
    },
    botInfo: { id: 999, username: "test_bot" },
    handleUpdate: vi.fn(),
  };
  app = await buildServer(bot as never);
  oneMock.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM api_keys"))
      return {
        id: "66666666-6666-4666-8666-666666666666",
        chat_id: -1001,
        name: "Automatización",
        key_prefix: secret.prefix,
        key_hash: hashApiKey(secret.key),
        scopes,
        created_by: 42,
        created_at: new Date(0),
        last_used_at: null,
        requests_total: 0,
        revoked_at: null,
      };
    if (sql.includes("FROM chats")) return chat;
    if (sql.includes("sanction_versions")) return { version: 1 };
    return null;
  });
});

afterEach(async () => {
  await app?.close();
});

const bearer = (key = secret.key) => ({ authorization: `Bearer ${key}` });

describe("API pública v1", () => {
  it("publica la referencia sin exigir clave", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1" });
    expect(response.statusCode).toBe(200);
    expect(response.json().endpoints).toHaveLength(9);
  });

  it("exige una clave válida", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/me" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/me", headers: bearer("gbot_live_inventada") })).statusCode,
    ).toBe(401);
  });

  it("devuelve la identidad del grupo con una clave válida", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/me", headers: bearer() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ group: { id: -1001, title: "Comunidad" } });
  });

  it("no permite moderar con una clave de solo lectura", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/moderation",
      headers: bearer(),
      payload: { action: "ban", userId: 7 },
    });
    expect(response.statusCode).toBe(403);
  });

  it("aplica la sanción con una clave de moderación y la registra", async () => {
    scopes = ["read", "moderate"];
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/moderation",
      headers: bearer(),
      payload: { action: "ban", userId: 7, reason: "Regla de la API" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, action: "ban" });
    const logged = oneMock.mock.calls.filter((call) =>
      String(call[0]).includes("INSERT INTO moderation_log"),
    );
    expect(logged.length).toBeGreaterThan(0);
  });

  it("rechaza una acción fuera de la lista admitida", async () => {
    scopes = ["read", "moderate"];
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/moderation",
      headers: bearer(),
      payload: { action: "promote", userId: 7 },
    });
    expect(response.statusCode).toBe(400);
  });

  it("devuelve 404 si el grupo ya no está disponible", async () => {
    oneMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM api_keys"))
        return {
          id: "66666666-6666-4666-8666-666666666666",
          chat_id: -1001,
          name: "Automatización",
          key_prefix: secret.prefix,
          key_hash: hashApiKey(secret.key),
          scopes: ["read"],
          created_by: 42,
          created_at: new Date(0),
          last_used_at: null,
          requests_total: 0,
          revoked_at: null,
        };
      if (sql.includes("FROM chats")) return null;
      return null;
    });
    const response = await app.inject({ method: "GET", url: "/api/v1/me", headers: bearer() });
    expect(response.statusCode).toBe(404);
  });
});
