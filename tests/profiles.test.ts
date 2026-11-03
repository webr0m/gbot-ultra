import { describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn(async (_sql: string, values: unknown[]) => ({ user_id: values[0], username: values[1] })));
vi.mock("../src/db/pool.js", () => ({ one: query }));
import { upsertUser } from "../src/db/repositories/users.js";

describe("user profile writes", () => {
  it("coalesces repeated profile writes without delaying a changed username", async () => {
    const user = { id: 991, first_name: "Test", username: "before" };
    await Promise.all(Array.from({ length: 10 }, () => upsertUser(user)));
    expect(query).toHaveBeenCalledTimes(1);
    expect((await upsertUser({ ...user, username: "after" })).username).toBe("after");
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("refreshes last_seen after the TTL", async () => {
    vi.useFakeTimers();
    try {
      const user = { id: 992, first_name: "Test" };
      await upsertUser(user);
      const before = query.mock.calls.length;
      await upsertUser(user);
      expect(query).toHaveBeenCalledTimes(before);
      vi.advanceTimersByTime(60_001);
      await upsertUser(user);
      expect(query).toHaveBeenCalledTimes(before + 1);
    } finally { vi.useRealTimers(); }
  });
});
