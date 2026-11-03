import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ userId: 900000001, pending: vi.fn(), stale: vi.fn(), remove: vi.fn(), attempts: vi.fn(), safeDelete: vi.fn(), gban: vi.fn() }));
vi.mock("../src/config.js", () => ({ config: { ownerIds: new Set([900000001]), captchaTimeoutSeconds: 300 }, telegramFileUrl: () => "https://example.invalid/file" }));
vi.mock("../src/logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../src/db/pool.js", () => ({ many: async () => [], one: vi.fn(), query: vi.fn() }));
vi.mock("../src/db/repositories/chats.js", () => ({ getChat: async () => ({ chat_id: -1001, title: "Group", active: true, created_at: new Date() }) }));
vi.mock("../src/db/repositories/captcha.js", () => ({ deletePending: m.remove, getPending: m.pending, getStalePending: m.stale, incrementAttempts: m.attempts, setPending: vi.fn() }));
vi.mock("../src/db/repositories/commands.js", () => ({ listCustomCommands: async () => [], listNotes: async () => [], getNote: async () => null, getCustomCommand: async () => null, incrementNoteUses: vi.fn(), incrementCustomCommandUses: vi.fn() }));
vi.mock("../src/db/repositories/filters.js", () => ({ listBlacklist: async () => [], isGbanned: m.gban }));
vi.mock("../src/db/repositories/members.js", () => ({ listMembers: async () => [], setMemberStatus: vi.fn() }));
vi.mock("../src/db/repositories/moderation.js", () => ({ listModerationLog: async () => [], logModeration: vi.fn() }));
vi.mock("../src/services/premium.js", () => ({ getPaymentHistory: async () => [], getPremiumStatus: () => ({ active: false }), premiumPlanLabel: () => "Free" }));
vi.mock("../src/services/stats.js", () => ({ getGroupStats: async () => ({}), getChartData: async () => [] }));
vi.mock("../src/services/chat-cache.js", () => ({ settingsOf: () => ({}), getCachedChat: () => null }));
vi.mock("../src/server/auth.js", () => ({ authFromRequest: () => ({ user: { id: m.userId, first_name: "Test" } }), verifyAvatarToken: () => false, avatarUrl: () => "/avatar" }));
vi.mock("../src/utils/telegram.js", () => ({ getChatMemberSafe: async () => ({ status: "creator" }), isAdminStatus: () => true, isGroupChat: () => true, safeDelete: m.safeDelete }));

import { registerAssetRoutes } from "../src/server/routes/assets.js";
import { registerMessages } from "../src/bot/messages.js";
import { sendCaptcha, verifyCaptcha, expireCaptchas } from "../src/services/captcha.js";
import { enforceAntispam } from "../src/services/antispam.js";

beforeEach(() => { vi.clearAllMocks(); m.userId = 900000001; m.stale.mockResolvedValue([]); m.gban.mockResolvedValue(false); });

describe("Developer global exemptions", () => {
  it.each([[900000001, 200], [123, 402]])("applies the correct free-group export access to %s", async (id, status) => {
    m.userId = id;
    const app = Fastify(); registerAssetRoutes(app, { api: {} } as never);
    try { expect((await app.inject({ method: "GET", url: "/api/export?chat_id=-1001" })).statusCode).toBe(status); }
    finally { await app.close(); }
  });
  it("does not subject the Developer to automation or an old pending captcha", async () => {
    let handler!: Function;
    registerMessages({ use: (fn: Function) => { handler = fn; } } as never);
    const next = vi.fn();
    await handler({ message: { text: "hello", message_id: 1 }, from: { id: 900000001 }, chat: { id: -1001 }, app: { isOwner: true, isAdmin: false, chatRow: { chat_id: -1001 } }, me: { username: "test" }, api: {} }, next);
    expect(next).toHaveBeenCalledOnce(); expect(m.safeDelete).not.toHaveBeenCalled(); expect(m.gban).not.toHaveBeenCalled();
  });
  it("does not create a captcha for the Developer", async () => {
    expect(await sendCaptcha({} as never, { id: -1001 } as never, { id: 900000001 } as never, { captcha: { enabled: true } } as never)).toBe(false);
  });
  it("does not kick the Developer when an old captcha expires", async () => {
    m.stale.mockResolvedValue([{ chat_id: -1001, user_id: 900000001 }]);
    expect(await expireCaptchas({} as never)).toBe(0);
    expect(m.remove).toHaveBeenCalledWith(-1001, 900000001);
  });
  it("clears old Developer challenges without counting failed attempts", async () => {
    expect(await verifyCaptcha({} as never, -1001, 900000001, "wrong")).toEqual({ status: "ok" });
    expect(m.attempts).not.toHaveBeenCalled();
  });
  it("exempts the Developer even when the antispam service is called directly", async () => {
    expect(await enforceAntispam({} as never, {} as never, {} as never, {} as never, { id: 900000001 } as never, 456)).toEqual({ handled: false });
    expect(m.gban).not.toHaveBeenCalled();
  });
});
