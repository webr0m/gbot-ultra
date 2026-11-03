import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  sql: vi.fn(), release: vi.fn(), cleanup: vi.fn(), expire: vi.fn(), premium: vi.fn(),
}));
vi.mock("../src/config.js", () => ({ config: { premiumReminderDays: 3,botToken:'123456789:FAKE' } }));
vi.mock('../src/services/publications.js',()=>({runPublications:async()=>undefined}));
vi.mock('../src/services/visual-moderation.js',()=>({runVisualJobs:async()=>undefined}));
vi.mock('../src/services/ai-assistant.js',()=>({cleanupAI:async()=>undefined}));
vi.mock('../src/services/branded-bots.js',()=>({cleanupBrands:async()=>undefined}));
vi.mock("../src/db/pool.js", () => ({ pool: { connect: async () => ({ query: mocks.sql, release: mocks.release }) }, query: mocks.cleanup }));
vi.mock("../src/services/premium.js", () => ({ getExpiringPremiumChats: mocks.premium, markPremiumReminderSent: vi.fn() }));
vi.mock("../src/services/captcha.js", () => ({ expireCaptchas: mocks.expire }));
vi.mock('../src/services/advanced-engine.js',()=>({runAdvancedSchedules:async()=>undefined}));
vi.mock('../src/services/pro-licenses.js',()=>({validateProLicenses:async()=>undefined}));
vi.mock("../src/logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
import { runScheduledTasks } from "../src/services/scheduler.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sql.mockImplementation(async (sql: string) => {
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    return { rows: [], rowCount: 0 };
  });
  mocks.expire.mockResolvedValue(0);
  mocks.premium.mockResolvedValue([]);
  mocks.cleanup.mockResolvedValue(undefined);
});

describe("persistent scheduler", () => {
  it("skips a concurrent invocation that cannot acquire the database lock", async () => {
    mocks.sql.mockResolvedValueOnce({ rows: [{ locked: false }] });
    expect(await runScheduledTasks({} as never, "bot")).toEqual([]);
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledTimes(1);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });
  it("does not repeat recently completed tasks after a process restart", async () => {
    mocks.sql.mockImplementation(async (sql: string) => sql.includes("pg_try_advisory_lock")
      ? { rows: [{ locked: true }] } : { rows: [{}], rowCount: 1 });
    expect(await runScheduledTasks({} as never, "bot")).toEqual([]);
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.premium).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.sql.mock.calls.at(-1)![0]).toContain("pg_advisory_unlock");
  });
  it("records successful runs and releases the lock", async () => {
    expect(await runScheduledTasks({} as never, "bot")).toEqual(["captcha-expiry", "advanced-schedules", "publications", "visual-moderation", "pro-licenses", "premium-reminders", "cleanup"]);
    expect(mocks.sql.mock.calls.filter(([sql]) => sql.includes("completed_at=EXCLUDED.completed_at"))).toHaveLength(7);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  it("continues independent jobs after a failure and leaves the failed job due", async () => {
    mocks.expire.mockRejectedValueOnce(new Error("temporary network failure"));
    await expect(runScheduledTasks({} as never, "bot")).rejects.toThrow(AggregateError);
    expect(mocks.sql.mock.calls.filter(([sql]) => sql.includes("completed_at=EXCLUDED.completed_at"))).toHaveLength(6);
    expect(mocks.sql.mock.calls.some(([sql, params]) => sql.includes("failed_at=now()") && params[0] === "captcha-expiry")).toBe(true);
    expect(mocks.premium).toHaveBeenCalledOnce();
    expect(mocks.sql.mock.calls.at(-1)![0]).toContain("pg_advisory_unlock");
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});
