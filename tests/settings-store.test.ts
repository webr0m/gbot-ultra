import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sql: vi.fn(), row: { chat_id: -1001, active: true, settings: {} } as any, queue: Promise.resolve() as Promise<unknown> }));
vi.mock("../src/config.js", () => ({ config: { captchaTimeoutSeconds: 300 } }));
vi.mock("../src/db/repositories/chats.js", () => ({ getChat: vi.fn(), updateChatSettings: vi.fn(), upsertChat: vi.fn() }));
vi.mock("../src/db/pool.js", () => ({ withTransaction: (fn: Function) => {
  const task = mocks.queue.then(() => fn({ query: mocks.sql }));
  mocks.queue = task.catch(() => {});
  return task;
} }));
import { patchChatSettings } from "../src/services/chat-cache.js";

beforeEach(() => {
  vi.clearAllMocks(); mocks.queue = Promise.resolve(); mocks.row = { chat_id: -1001, active: true, settings: {} };
  mocks.sql.mockImplementation(async (sql: string, values: any[]) => {
    if (sql.startsWith("SELECT")) return { rows: [structuredClone(mocks.row)] };
    mocks.row.settings = JSON.parse(values[1]);
    return { rows: [structuredClone(mocks.row)] };
  });
});

describe("shared Telegram and Mini App settings", () => {
  it("merges concurrent edits against a locked current row", async () => {
    await Promise.all([
      patchChatSettings(-1001, { welcome: { enabled: false } }, true),
      patchChatSettings(-1001, { rules: { text: "Updated rules" } }, true),
    ]);
    expect(mocks.row.settings.welcome.enabled).toBe(false);
    expect(mocks.row.settings.rules.text).toBe("Updated rules");
    expect(mocks.sql.mock.calls.filter(([sql]) => sql.startsWith("SELECT")).every(([sql]) => sql.includes("FOR UPDATE"))).toBe(true);
  });
  it("evaluates a toggle against the latest settings", async () => {
    await patchChatSettings(-1001, { welcome: { enabled: false } }, true);
    await patchChatSettings(-1001, current => ({ welcome: { enabled: !current.welcome.enabled } }), true);
    expect(mocks.row.settings.welcome.enabled).toBe(true);
  });
  it("rejects Premium changes without writing, while privileged callers can apply them", async () => {
    const patch = { logs: { enabled: true, chatId: -1002 } };
    expect((await patchChatSettings(-1001, patch, false)).ok).toBe(false);
    expect(mocks.sql.mock.calls).toHaveLength(1);
    expect((await patchChatSettings(-1001, patch, true)).ok).toBe(true);
    expect(mocks.row.settings.logs.enabled).toBe(true);
  });
});
