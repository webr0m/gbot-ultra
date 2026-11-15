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

let app: FastifyInstance;
let scopes: string[];

beforeEach(async () => {
  scopes = ["read"];
  const bot = {
    api: {
      getChat: vi.fn(async () => ({ type: "supergroup", permissions: { can_restrict_members: true } })),
      getChatMember: vi.fn(async (_chatId: number, userId: number) => {
        if (userId === 5150) throw new Error("User not found");
        return {
          status: userId === 42 ? "creator" : userId === 999 ? "administrator" : "member",
          can_restrict_members: true,
          can_delete_messages: true,
          can_change_info: true,
          user: { id: userId, first_name: "Miembro" },
        };
      }),
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

const MODERN = "2026-07-28";

function call(
  method: string,
  params: Record<string, unknown> = {},
  version: string | null = MODERN,
) {
  const headers: Record<string, string> = { ...bearer() };
  if (version) headers["mcp-protocol-version"] = version;
  const body: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: {
      ...params,
      ...(version
        ? {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": version,
              "io.modelcontextprotocol/clientInfo": { name: "Test", version: "1.0.0" },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          }
        : {}),
    },
  };
  return app.inject({ method: "POST", url: "/mcp", headers, payload: body });
}

describe("Servidor MCP", () => {
  it("explica sus versiones y capacidades en server/discover", async () => {
    const response = await call("server/discover");
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.result.resultType).toBe("complete");
    expect(body.result.supportedVersions).toContain(MODERN);
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("GBot Ultra");
  });

  it("responde al saludo clásico de los clientes antiguos", async () => {
    const response = await call("initialize", {}, "2025-06-18");
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.serverInfo.version).toBe("2.13.0");
  });

  it("acepta una notificación sin cuerpo", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...bearer(), "mcp-protocol-version": MODERN },
      payload: { jsonrpc: "2.0", method: "notifications/initialized" },
    });
    expect(response.statusCode).toBe(202);
    expect(response.body).toBe("");
  });

  it("exige una clave válida", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MODERN },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe(-32001);
  });

  it("rechaza una versión de protocolo no admitida", async () => {
    const response = await call("tools/list", {}, "1999-01-01");
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe(-32022);
    expect(response.json().error.data.supported).toContain(MODERN);
  });

  it("rechaza una cabecera de versión que no coincide con el cuerpo", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...bearer(), "mcp-protocol-version": "2025-06-18" },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN } },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe(-32020);
  });

  it("devuelve un método desconocido con el código del protocolo", async () => {
    const response = await call("resources/list");
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe(-32601);
  });

  it("solo ofrece herramientas del ámbito que tiene la clave", async () => {
    const response = await call("tools/list");
    expect(response.statusCode).toBe(200);
    const names = response.json().result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("list_members");
    expect(names).not.toContain("moderate_user");
  });

  it("ofrece la herramienta de moderación con una clave de moderación", async () => {
    scopes = ["read", "moderate"];
    const response = await call("tools/list");
    const names = response.json().result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("moderate_user");
  });

  it("ejecuta una herramienta de lectura y devuelve su contenido", async () => {
    const response = await call("tools/call", { name: "list_members", arguments: {} });
    expect(response.statusCode).toBe(200);
    const result = response.json().result;
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text).ok).toBe(true);
  });

  it("no deja moderar con una clave de solo lectura", async () => {
    const response = await call("tools/call", {
      name: "moderate_user",
      arguments: { action: "ban", userId: 7 },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe(-32602);
  });

  it("aplica la sanción y la registra cuando el ámbito lo permite", async () => {
    scopes = ["read", "moderate"];
    const response = await call("tools/call", {
      name: "moderate_user",
      arguments: { action: "ban", userId: 7, reason: "Regla del agente" },
    });
    expect(response.statusCode).toBe(200);
    const result = response.json().result;
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text).action).toBe("ban");
    const logged = oneMock.mock.calls.filter((call) =>
      String(call[0]).includes("INSERT INTO moderation_log"),
    );
    expect(logged.length).toBeGreaterThan(0);
  });

  it("devuelve un error de herramienta cuando el usuario no existe", async () => {
    scopes = ["read", "moderate"];
    const response = await call("tools/call", {
      name: "moderate_user",
      arguments: { action: "ban", userId: 5150 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.isError).toBe(true);
  });

  it("rechaza una acción de moderación fuera de la lista admitida", async () => {
    scopes = ["read", "moderate"];
    const response = await call("tools/call", {
      name: "moderate_user",
      arguments: { action: "promote", userId: 7 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.isError).toBe(true);
  });

  it("no admite GET en el punto MCP", async () => {
    const response = await app.inject({ method: "GET", url: "/mcp" });
    expect(response.statusCode).toBe(405);
  });

  it("publica la referencia del servidor MCP en la API", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/mcp" });
    expect(response.statusCode).toBe(200);
    expect(response.json().tools.length).toBeGreaterThan(0);
  });
});
