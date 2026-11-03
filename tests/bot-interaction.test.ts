import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), chat: vi.fn() }));
vi.mock("../src/config.js", () => ({ config: { ownerIds: new Set([900000001]), hasWebapp: true, webappUrl: "https://gbot.webrom.cc", captchaTimeoutSeconds: 300 }, webappUrlForChat: (id: number, tab: string) => `https://gbot.webrom.cc/?chat_id=${id}${tab && tab !== "home" ? "&tab="+tab : ""}` }));
vi.mock("../src/logger.js", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("../src/db/pool.js", () => ({ one: vi.fn(), many: vi.fn(), query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../src/db/repositories/chats.js", () => ({ getChat: mocks.chat }));
vi.mock("../src/utils/telegram.js", () => ({ getChatMemberSafe: mocks.member, isAdminStatus: (status: string) => ["creator", "administrator"].includes(status), isGroupChat: (chat: any) => ["group", "supergroup"].includes(chat.type) }));
import { redirectGroupConfig } from "../src/bot/middleware.js";
import { showPanel } from "../src/bot/panel.js";
import { chatSelectionKeyboard } from "../src/bot/keyboards.js";

function ctx(text: string, owner = false): any {
  return { chat: { id: -1001, type: "supergroup" }, message: { text }, from: { id: owner ? 900000001 : 123 }, me: { username: "GroupButlerEsp_bot" }, app: { isOwner: owner, isAdmin: true, chatRow: { chat_id: -1001 } }, reply: vi.fn() };
}
beforeEach(() => { vi.clearAllMocks(); mocks.chat.mockResolvedValue({ active: true, title: "Private group" }); mocks.member.mockResolvedValue({ status: "administrator" }); });

describe("Telegram command routing", () => {
  it.each(["/rules", "/stats", "/top", "/get note", "/welcome off", "/captcha on", "settings", "/settings@AnotherBot"])("lets %s reach its normal handler", async text => {
    const context = ctx(text), next = vi.fn();
    await redirectGroupConfig(context, next);
    expect(next).toHaveBeenCalledOnce(); expect(context.reply).not.toHaveBeenCalled();
  });
  it("opens the selected group's settings through private Telegram", async () => {
    const context = ctx("/settings@GroupButlerEsp_bot");
    await redirectGroupConfig(context, vi.fn());
    expect(context.reply.mock.calls[0][1].reply_markup.inline_keyboard[0][0].url).toContain("start=settings_-1001");
  });
  it("does not offer administrative settings to ordinary members", async () => {
    const context = ctx("/config"); context.app.isAdmin = false;
    await redirectGroupConfig(context, vi.fn());
    expect(context.reply.mock.calls[0][0]).toContain("Solo administradores");
  });
});

describe("bot to Mini App entry", () => {
  it("rejects an unauthorized deep link without disclosing the group's title", async () => {
    mocks.member.mockResolvedValue({ status: "member" });
    const context = ctx("/start");
    await showPanel(context, -1001, "settings");
    expect(context.reply.mock.calls[0][0]).not.toContain("Private group");
    expect(context.reply.mock.calls[0][1]).toBeUndefined();
  });
  it("preserves developer access and opens the requested settings tab", async () => {
    const context = ctx("/start", true);
    await showPanel(context, -1001, "settings");
    expect(mocks.member).not.toHaveBeenCalled();
    const url = context.reply.mock.calls[0][1].reply_markup.inline_keyboard[0][0].web_app.url;
    expect(url).toContain("chat_id=-1001"); expect(url).toContain("tab=settings");
  });
  it("makes every group reachable beyond the old twenty-group limit", () => {
    const chats = Array.from({ length: 77 }, (_, index) => ({ chat_id: -index-1, title: "Group "+index, premium_until: null }));
    const keyboard = chatSelectionKeyboard(chats as never, 12).inline_keyboard;
    expect(JSON.stringify(keyboard)).toContain("premium:chat:-77");
    expect(JSON.stringify(keyboard)).toContain("premium:page:11");
  });
});
