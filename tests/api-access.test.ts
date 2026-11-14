import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/config.js", () => ({
  config: {
    ownerIds: new Set([900000001]),
    logLevel: "silent",
    botToken: "test-token",
    databaseUrl: "",
    botMode: "webhook",
  },
}));

const queryMock = vi.hoisted(() => vi.fn(async () => ({ rows: [], rowCount: 1 })));
const oneMock = vi.hoisted(() => vi.fn(async () => null));
const manyMock = vi.hoisted(() => vi.fn(async () => []));
vi.mock("../src/db/pool.js", () => ({
  query: queryMock,
  one: oneMock,
  many: manyMock,
  withTransaction: async (run: (client: unknown) => Promise<unknown>) =>
    run({ query: vi.fn(async () => ({ rows: [], rowCount: 1 })) }),
  withSessionLock: async (_key: string, run: () => Promise<unknown>) => run(),
}));

import {
  API_RATE_LIMIT,
  checkKeyRate,
  createApiKey,
  generateApiKey,
  hasScope,
  hashApiKey,
  listApiKeys,
  recordApiUse,
  revokeApiKey,
  summarizeApiKey,
  verifyApiKey,
} from "../src/services/api-access.js";
import { hasFeature } from "../src/services/entitlements.js";

const ultra = {
  chat_id: -1001,
  premium_until: new Date(Date.now() + 86400000),
  premium_tier: "ultra",
  pro_license_id: null,
} as never;

beforeEach(() => {
  queryMock.mockClear();
  queryMock.mockImplementation(async () => ({ rows: [], rowCount: 1 }));
  oneMock.mockReset();
  oneMock.mockResolvedValue(null);
  manyMock.mockReset();
  manyMock.mockResolvedValue([]);
});

describe("Claves de la API", () => {
  it("genera una clave con prefijo reconocible y guarda solo su hash", async () => {
    oneMock.mockImplementation(async (sql: string) =>
      sql.includes("INSERT INTO api_keys")
        ? {
            rows: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                chat_id: -1001,
                name: "Automatización",
                key_prefix: "abc123",
                key_hash: "hash",
                scopes: ["read"],
                created_by: 42,
                created_at: new Date(0),
                last_used_at: null,
                requests_total: 0,
                revoked_at: null,
              },
            ],
            rowCount: 1,
          }
        : { rows: [], rowCount: 1 },
    );
    const row = await createApiKey(-1001, 42, "Automatización", ["read"]);
    expect(row.key.startsWith("gbot_live_")).toBe(true);
    expect(row.key.length).toBeGreaterThan(40);
    const insert = oneMock.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO api_keys"),
    );
    const params = insert![1] as unknown[];
    expect(params[4]).toBe(hashApiKey(row.key));
    expect(params).not.toContain(row.key);
  });

  it("devuelve el mismo prefijo que se guarda para buscar la clave", () => {
    const secret = generateApiKey();
    expect(secret.key.startsWith("gbot_live_")).toBe(true);
    expect(secret.prefix).toHaveLength(12);
    expect(secret.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(secret.hash).not.toContain(secret.key);
  });

  it("acepta la clave correcta y rechaza cualquier otra", async () => {
    const secret = generateApiKey();
    oneMock.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      chat_id: -1001,
      name: "Automatización",
      key_prefix: secret.prefix,
      key_hash: secret.hash,
      scopes: ["read", "moderate"],
      created_by: 42,
      created_at: new Date(0),
      last_used_at: null,
      requests_total: 0,
      revoked_at: null,
    });
    const found = await verifyApiKey(secret.key);
    expect(found?.chat_id).toBe(-1001);
    const tampered = secret.key.slice(0, -1) + (secret.key.endsWith("a") ? "b" : "a");
    oneMock.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      chat_id: -1001,
      name: "Automatización",
      key_prefix: secret.prefix,
      key_hash: secret.hash,
      scopes: ["read"],
      created_by: 42,
      created_at: new Date(0),
      last_used_at: null,
      requests_total: 0,
      revoked_at: null,
    });
    expect(await verifyApiKey(tampered)).toBeNull();
    expect(await verifyApiKey("no-es-una-clave")).toBeNull();
  });

  it("rechaza una clave anulada", async () => {
    const secret = generateApiKey();
    oneMock.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      chat_id: -1001,
      name: "Automatización",
      key_prefix: secret.prefix,
      key_hash: secret.hash,
      scopes: ["read"],
      created_by: 42,
      created_at: new Date(0),
      last_used_at: null,
      requests_total: 0,
      revoked_at: new Date(),
    });
    expect(await verifyApiKey(secret.key)).toBeNull();
  });

  it("anula la clave del grupo y no expone el hash en el resumen", async () => {
    oneMock.mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444" });
    expect(await revokeApiKey(-1001, "44444444-4444-4444-8444-444444444444")).toBe(true);
    const summary = summarizeApiKey({
      id: "44444444-4444-4444-8444-444444444444",
      chat_id: -1001,
      name: "Automatización",
      key_prefix: "abc123",
      key_hash: "secreto",
      scopes: ["read"],
      created_by: 42,
      created_at: new Date(0),
      last_used_at: null,
      requests_total: 3,
      revoked_at: null,
    } as never);
    expect(summary).not.toHaveProperty("key_hash");
    expect(summary.requests).toBe(3);
    expect(summary.revoked).toBe(false);
  });

  it("registra el uso de la clave", async () => {
    await recordApiUse("55555555-5555-4555-8555-555555555555");
    const update = oneMock.mock.calls.find((call) =>
      String(call[0]).includes("requests_total = requests_total + 1"),
    );
    expect(update).toBeTruthy();
  });

  it("limita las peticiones por clave y por minuto", () => {
    const id = "clave-de-prueba";
    let allowed = 0;
    for (let i = 0; i < API_RATE_LIMIT + 5; i += 1) {
      if (checkKeyRate(id, 1_000).allowed) allowed += 1;
    }
    expect(allowed).toBe(API_RATE_LIMIT);
    expect(checkKeyRate(id, 1_000).allowed).toBe(false);
    expect(checkKeyRate(id, 120_000).allowed).toBe(true);
  });
});

describe("Ámbitos y nivel", () => {
  it("exige el ámbito correspondente para cada operación", () => {
    const read = { scopes: ["read"] } as never;
    const moderate = { scopes: ["read", "moderate"] } as never;
    expect(hasScope(read, "read")).toBe(true);
    expect(hasScope(read, "moderate")).toBe(false);
    expect(hasScope(moderate, "moderate")).toBe(true);
  });

  it("reserva la API para Ultra", () => {
    expect(
      hasFeature(
        { premium_until: new Date(Date.now() + 86400000), premium_tier: "pro" },
        "apiAccess",
      ),
    ).toBe(false);
    expect(
      hasFeature(
        {
          premium_until: new Date(Date.now() + 86400000),
          premium_tier: "ultra",
        },
        "apiAccess",
      ),
    ).toBe(true);
    expect(hasFeature(null, "apiAccess", 900000001)).toBe(true);
  });

  it("devuelve solo las claves del grupo consultado", async () => {
    await listApiKeys(-1001);
    expect(manyMock.mock.calls[0][1]).toEqual([-1001]);
  });
});
