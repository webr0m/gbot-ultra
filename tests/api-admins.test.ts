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
    version: "2.13.0",
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

const BOT_ID = 999;
const CREATOR_ID = 42;

let app: FastifyInstance;
let scopes: string[];
let actorStatus: string;
let actorRights: Record<string, unknown>;
let promoteChatMember: ReturnType<typeof vi.fn>;
let setChatAdministratorCustomTitle: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  scopes = ["read"];
  actorStatus = "creator";
  actorRights = { can_promote_members: true, can_restrict_members: true };
  promoteChatMember = vi.fn(async () => true);
  setChatAdministratorCustomTitle = vi.fn(async () => true);
  const bot = {
    api: {
      getChat: vi.fn(async () => ({
        type: "supergroup",
        permissions: { can_restrict_members: true, can_promote_members: true },
      })),
      getChatMember: vi.fn(async (_chatId: number, userId: number) => {
        if (userId === 5150) throw new Error("User not found");
        if (userId === BOT_ID)
          return {
            status: "administrator",
            can_restrict_members: true,
            can_promote_members: true,
            can_delete_messages: true,
            user: { id: userId, first_name: "Bot" },
          };
        if (userId === CREATOR_ID)
          return {
            status: actorStatus,
            ...actorRights,
            user: { id: userId, first_name: "Creador" },
          };
        return {
          status: userId === 77 ? "administrator" : "member",
          can_restrict_members: true,
          can_promote_members: true,
          user: { id: userId, first_name: "Miembro" },
        };
      }),
      getChatAdministrators: vi.fn(async () => [
        {
          status: "creator",
          is_anonymous: false,
          user: { id: CREATOR_ID, first_name: "Creador" },
        },
        {
          status: "administrator",
          can_be_edited: false,
          is_anonymous: false,
          can_manage_chat: true,
          can_delete_messages: true,
          can_manage_video_chats: false,
          can_restrict_members: true,
          can_promote_members: false,
          can_change_info: false,
          can_invite_users: true,
          can_pin_messages: true,
          custom_title: "Moderación",
          user: { id: 77, first_name: "Vicesa", username: "vicesa" },
        },
      ]),
      promoteChatMember,
      setChatAdministratorCustomTitle,
      banChatMember: vi.fn(async () => true),
      unbanChatMember: vi.fn(async () => true),
      restrictChatMember: vi.fn(async () => true),
    },
    botInfo: { id: BOT_ID, username: "test_bot" },
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
        created_by: CREATOR_ID,
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

const MODERN = "2026-07-28";

function mcp(method: string, params: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: { ...bearer(), "mcp-protocol-version": MODERN },
    payload: {
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MODERN,
          "io.modelcontextprotocol/clientInfo": { name: "Test", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
  });
}

function loggedActions(): string[] {
  return oneMock.mock.calls
    .filter((call) => String(call[0]).includes("INSERT INTO moderation_log"))
    .map((call) => String((call[1] as unknown[])[3]));
}

describe("Gestión de administradores por API y MCP", () => {
  it("publica los dos puntos nuevos en la referencia", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1" });
    expect(response.statusCode).toBe(200);
    const paths = response.json().endpoints.map((entry: { path: string }) => entry.path);
    expect(paths).toContain("/api/v1/admins");
    expect(response.json().endpoints).toHaveLength(9);
  });

  it("lista los administradores con sus permisos", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admins",
      headers: bearer(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(2);
    const owner = body.items.find((item: { id: number }) => item.id === CREATOR_ID);
    expect(owner.isOwner).toBe(true);
    expect(owner.rights.can_promote_members).toBe(true);
    const vice = body.items.find((item: { id: number }) => item.id === 77);
    expect(vice.customTitle).toBe("Moderación");
    expect(vice.rights.can_promote_members).toBe(false);
  });

  it("exige una clave válida para listar administradores", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/admins" })).statusCode).toBe(401);
  });

  it("no permite promover con una clave de solo lectura", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admins",
      headers: bearer(),
      payload: { action: "promote", userId: 7 },
    });
    expect(response.statusCode).toBe(403);
    expect(promoteChatMember).not.toHaveBeenCalled();
  });

  it("promueve a un miembro y lo registra", async () => {
    scopes = ["read", "moderate"];
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admins",
      headers: bearer(),
      payload: { action: "promote", userId: 7, preset: "full", customTitle: "Soporte" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, action: "promote", preset: "full" });
    expect(promoteChatMember).toHaveBeenCalledTimes(1);
    expect(setChatAdministratorCustomTitle).toHaveBeenCalledWith(-1001, 7, "Soporte");
    expect(loggedActions()).toContain("api_promote");
  });

  it("degrada a un administrador y lo registra", async () => {
    scopes = ["read", "moderate"];
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admins",
      headers: bearer(),
      payload: { action: "demote", userId: 77 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, action: "demote" });
    expect(loggedActions()).toContain("api_demote");
  });

  it("rechaza una acción fuera de la lista admitida", async () => {
    scopes = ["read", "moderate"];
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admins",
      headers: bearer(),
      payload: { action: "lock", userId: 7 },
    });
    expect(response.statusCode).toBe(400);
  });

  it("devuelve 404 si el usuario no existe", async () => {
    scopes = ["read", "moderate"];
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admins",
      headers: bearer(),
      payload: { action: "promote", userId: 5150 },
    });
    expect(response.statusCode).toBe(404);
  });

  it("no promueve cuando el actor no tiene permiso de promoción", async () => {
    scopes = ["read", "moderate"];
    actorStatus = "administrator";
    actorRights = { can_promote_members: false, can_restrict_members: true };
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admins",
      headers: bearer(),
      payload: { action: "promote", userId: 7 },
    });
    expect(response.statusCode).toBe(400);
    expect(promoteChatMember).not.toHaveBeenCalled();
  });

  it("ofrece las herramientas de administración según el ámbito", async () => {
    const readOnly = await mcp("tools/list");
    const readNames = readOnly.json().result.tools.map((tool: { name: string }) => tool.name);
    expect(readNames).toContain("list_admins");
    expect(readNames).not.toContain("manage_admin");

    scopes = ["read", "moderate"];
    const full = await mcp("tools/list");
    const names = full.json().result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("manage_admin");
    expect(names).toHaveLength(7);
  });

  it("lista los administradores desde MCP", async () => {
    const response = await mcp("tools/call", { name: "list_admins", arguments: {} });
    expect(response.statusCode).toBe(200);
    const result = response.json().result;
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text).total).toBe(2);
  });

  it("promueve desde MCP y lo registra", async () => {
    scopes = ["read", "moderate"];
    const response = await mcp("tools/call", {
      name: "manage_admin",
      arguments: { action: "promote", userId: 7, preset: "moderator" },
    });
    expect(response.statusCode).toBe(200);
    const result = response.json().result;
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text).action).toBe("promote");
    expect(loggedActions()).toContain("mcp_promote");
  });

  it("no deja administrar desde MCP con una clave de solo lectura", async () => {
    const response = await mcp("tools/call", {
      name: "manage_admin",
      arguments: { action: "promote", userId: 7 },
    });
    expect(response.statusCode).toBe(403);
  });

  it("devuelve un error de herramienta con una acción no admitida", async () => {
    scopes = ["read", "moderate"];
    const response = await mcp("tools/call", {
      name: "manage_admin",
      arguments: { action: "lock", userId: 7 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.isError).toBe(true);
  });

  it("devuelve un error de herramienta cuando el usuario no existe", async () => {
    scopes = ["read", "moderate"];
    const response = await mcp("tools/call", {
      name: "manage_admin",
      arguments: { action: "promote", userId: 5150 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.isError).toBe(true);
  });

  it("publica las herramientas de administración en la referencia MCP", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/mcp" });
    expect(response.statusCode).toBe(200);
    const names = response.json().tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("list_admins");
    expect(names).toContain("manage_admin");
    expect(response.json().tools).toHaveLength(7);
  });
});
