import { describe, expect, it, vi } from "vitest";
import { ReadCache } from "../src/services/read-cache.js";
import { createTelegramApiCache } from "../src/services/telegram-cache.js";
import { mapConcurrent } from "../src/utils/concurrency.js";

describe("read cache", () => {
  it("coalesces simultaneous reads and returns independent values", async () => {
    const cache = new ReadCache();
    const load = vi.fn(async () => ({ admins: [1] }));
    const values = await Promise.all(Array.from({ length: 10 }, () => cache.get("admins", 1000, load)));
    values[0]!.admins.push(2);
    expect(values[1]!.admins).toEqual([1]);
    expect((await cache.get("admins", 1000, load)).admins).toEqual([1]);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("expires reads and evicts entries at the configured memory limit", async () => {
    let now = 0;
    const cache = new ReadCache(2, () => now);
    const load = vi.fn(async () => 1);
    await cache.get("a", 10, load);
    await cache.get("b", 10, load);
    await cache.get("c", 10, load);
    await cache.get("a", 10, load);
    expect(load).toHaveBeenCalledTimes(4);
    now = 11;
    await cache.get("a", 10, load);
    expect(load).toHaveBeenCalledTimes(5);
  });
  it("does not repopulate stale permissions from an invalidated in-flight read", async () => {
    const cache = new ReadCache();
    let finish!: (value: string) => void;
    const old = cache.get("role", 1000, () => new Promise<string>(resolve => { finish = resolve; }), "chat");
    await Promise.resolve();
    cache.invalidate("chat");
    expect(await cache.get("role", 1000, async () => "member", "chat")).toBe("member");
    finish("administrator");
    await old;
    expect(await cache.get("role", 1000, async () => "wrong", "chat")).toBe("member");
  });
  it("retries failures and rejected API results", async () => {
    const cache = new ReadCache();
    await expect(cache.get("a", 100, async () => { throw new Error("network"); })).rejects.toThrow("network");
    expect(await cache.get("a", 100, async () => 2)).toBe(2);
    const load = vi.fn(async () => ({ ok: false }));
    await cache.get("b", 100, load, undefined, value => value.ok);
    await cache.get("b", 100, load, undefined, value => value.ok);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("Telegram API caching", () => {
  it("isolates users and chats and invalidates permissions after a mutation", async () => {
    const invalidated = vi.fn();
    const { transformer, invalidateChat } = createTelegramApiCache(invalidated);
    const next = vi.fn(async () => ({ ok: true, result: { status: "administrator" } }));
    const call = (method: string, payload: object) => transformer(next as never, method as never, payload as never);
    await Promise.all(Array.from({ length: 10 }, () => call("getChatMember", { chat_id: -1, user_id: 1 })));
    expect(next).toHaveBeenCalledTimes(1);
    await call("getChatMember", { chat_id: -1, user_id: 2 });
    await call("getChatMember", { chat_id: -2, user_id: 1 });
    expect(next).toHaveBeenCalledTimes(3);
    await call("banChatMember", { chat_id: -1, user_id: 1 });
    await call("getChatMember", { chat_id: -1, user_id: 1 });
    expect(next).toHaveBeenCalledTimes(5);
    expect(invalidated).toHaveBeenCalledWith(-1);
    invalidateChat(-2);
    await call("getChatMember", { chat_id: -2, user_id: 1 });
    expect(next).toHaveBeenCalledTimes(6);
  });
  it("never caches writes or unsuccessful responses", async () => {
    const { transformer } = createTelegramApiCache();
    const next = vi.fn(async () => ({ ok: false, error_code: 429, description: "retry" }));
    const call = (method: string) => transformer(next as never, method as never, { chat_id: -1 } as never);
    await call("getChat"); await call("getChat");
    await call("sendMessage"); await call("sendMessage");
    expect(next).toHaveBeenCalledTimes(4);
  });
});

it("limits concurrent discovery requests and preserves output order", async () => {
  let active = 0, peak = 0;
  const result = await mapConcurrent(Array.from({ length: 30 }, (_, index) => index), 5, async value => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return value * 2;
  });
  expect(peak).toBe(5);
  expect(result).toEqual(Array.from({ length: 30 }, (_, index) => index * 2));
});
