import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), rights: vi.fn(), sql: vi.fn(), saved: new Map<number, unknown>(), log: vi.fn() }));
vi.mock("../src/config.js", () => ({ config: { ownerIds: new Set([900000001]) } }));
vi.mock("../src/logger.js", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../src/utils/telegram.js", () => ({ getChatMemberSafe: mocks.member, checkBotRights: mocks.rights, RIGHT_LABELS: {} }));
vi.mock("../src/db/pool.js", () => ({ withTransaction: async (fn: Function) => {
  const before = new Map(mocks.saved);
  try { return await fn({ query: mocks.sql }); }
  catch (error) { mocks.saved.clear(); for (const [k,v] of before) mocks.saved.set(k,v); throw error; }
} }));
vi.mock("../src/db/repositories/moderation.js", () => ({ logModeration: mocks.log }));
vi.mock("../src/db/repositories/members.js", () => ({ setMemberStatus: vi.fn() }));
vi.mock("../src/db/repositories/warnings.js", () => ({ clearWarnings: vi.fn(), addWarning: vi.fn(), countWarnings: vi.fn() }));
import { assertActorRight, lockChat, unlockChat, promoteUser } from "../src/services/moderation.js";
import { DEVELOPER_ID, globalRole, globalRoleLabel } from "../src/services/roles.js";
import { filterMemberPage } from "../src/services/member-filters.js";

function context(actorId = 123) { return { actorId, botId: 456, chatId: -1001, chat: { title: "Group" }, settings: { logs: { enabled: false } }, api: { getChat: vi.fn(async () => ({ permissions: { can_send_messages: true, can_send_photos: false } })), setChatPermissions: vi.fn(), promoteChatMember: vi.fn(), setChatAdministratorCustomTitle: vi.fn() } } as any; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.saved.clear(); mocks.rights.mockResolvedValue({ ok: true });
  mocks.member.mockResolvedValue({ status: "creator", user: { id: 123 } });
  mocks.sql.mockImplementation(async (sql: string, values: any[]) => {
    if (sql.startsWith("SELECT permissions")) return { rows: mocks.saved.has(values[0]) ? [{ permissions: mocks.saved.get(values[0]) }] : [], rowCount: Number(mocks.saved.has(values[0])) };
    if (sql.startsWith("INSERT")) mocks.saved.set(values[0], JSON.parse(values[1]));
    if (sql.startsWith("DELETE")) mocks.saved.delete(values[0]);
    return { rows: [], rowCount: 0 };
  });
});

describe("administrator boundaries", () => {
  it("assigns the Developer rank to the designated principal", () => {
    expect(DEVELOPER_ID).toBe(900000001);
    expect(globalRoleLabel(globalRole(DEVELOPER_ID, new Set()))).toBe("Desarrollador");
    expect(globalRole(42, new Set([42]))).toBe("owner");
    expect(globalRole(43, new Set([42]))).toBeNull();
  });
  it("preserves the developer's full access without group-role checks", async () => {
    await assertActorRight(context(DEVELOPER_ID), "can_promote_members");
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it("rejects a regular admin without the required permission", async () => {
    mocks.member.mockResolvedValue({ status: "administrator", can_promote_members: false });
    await expect(assertActorRight(context(), "can_promote_members")).rejects.toThrow("Permiso");
  });
  it("allows automatic moderation performed by the bot itself", async () => {
    await assertActorRight(context(456), "can_restrict_members");
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it("does not delegate more privileges than a human admin has", async () => {
    mocks.member.mockImplementation(async (_api: unknown, _chat: number, id: number) => id === 123 ? { status: "administrator", can_promote_members: true, can_restrict_members: false } : { status: "member", user: { id } });
    const ctx = context();
    await expect(promoteUser(ctx, { userId: 789, name: "Member" }, "full")).rejects.toThrow("delegar");
    expect(ctx.api.promoteChatMember).not.toHaveBeenCalled();
  });
});

describe("temporary group closure", () => {
  it("preserves the first snapshot across repeated locks and restores it exactly", async () => {
    const ctx = context();
    await lockChat(ctx);
    ctx.api.getChat.mockResolvedValue({ permissions: { can_send_messages: false, can_send_photos: false } });
    await lockChat(ctx);
    await unlockChat(ctx);
    expect(ctx.api.getChat).toHaveBeenCalledTimes(1);
    expect(ctx.api.setChatPermissions.mock.calls.at(-1)[1]).toEqual({ can_send_messages: true, can_send_photos: false });
    expect(mocks.saved.size).toBe(0);
  });
  it("does not broaden permissions when there is no recorded lock", async () => {
    const ctx = context();
    await expect(unlockChat(ctx)).rejects.toThrow("Sin cierre");
    expect(ctx.api.setChatPermissions).not.toHaveBeenCalled();
  });
  it("retains the snapshot if Telegram rejects restoring it", async () => {
    const ctx = context(); await lockChat(ctx);
    ctx.api.setChatPermissions.mockRejectedValueOnce(new Error("temporary network failure"));
    await expect(unlockChat(ctx)).rejects.toThrow();
    expect(mocks.saved.size).toBe(1);
  });
});

it("filters members before pagination, including matches beyond the first 200", () => {
  const all = Array.from({ length: 250 }, (_, id) => ({ id, status: "member", warns: id === 249 ? 1 : 0 }));
  const page = filterMemberPage(all, "warned", 0, 200);
  expect(page.members.map(member => member.id)).toEqual([249]);
  expect(page.total).toBe(1); expect(page.counts.all).toBe(250);
});
