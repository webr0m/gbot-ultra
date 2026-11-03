import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const scheduled = vi.hoisted(() => vi.fn(async () => ["captcha-expiry"]));
vi.mock("../src/config.js", () => ({ config: {
  botMode: "webhook", webhookSecret: "w".repeat(32), schedulerMode: "external",
  internalCronSecret: "c".repeat(32), nodeEnv: "test", isProduction: true,
  ownerIds: new Set(), logLevel: "silent", databaseUrl: "",
} }));
vi.mock("../src/services/scheduler.js", () => ({ runScheduledTasks: scheduled }));
vi.mock("../src/db/pool.js", () => ({ query: vi.fn(async()=>({rows:[],rowCount:1})), one: vi.fn(), many: vi.fn(), withTransaction: vi.fn() }));
import { buildServer } from "../src/server/app.js";
import { query } from '../src/db/pool.js';

let app: FastifyInstance;
afterEach(async () => { await app?.close(); scheduled.mockClear(); });

describe("external hosting endpoints", () => {
  async function server() {
    const bot = { api: {}, botInfo: { username: "test_bot" }, handleUpdate: vi.fn() };
    app = await buildServer(bot as never);
    return bot;
  }
  it.each([undefined, "wrong", "c".repeat(31)])("rejects an invalid cron secret: %s", async (secret) => {
    await server();
    const response = await app.inject({ method: "POST", url: "/api/internal/schedule", headers: secret ? { "x-gbot-cron-secret": secret } : {} });
    expect(response.statusCode).toBe(401);
    expect(scheduled).not.toHaveBeenCalled();
  });
  it("runs scheduled tasks only with the exact configured secret", async () => {
    const bot = await server();
    const response = await app.inject({ method: "POST", url: "/api/internal/schedule", headers: { "x-gbot-cron-secret": "c".repeat(32) } });
    expect(response.json()).toEqual({ ok: true, completed: ["captcha-expiry"] });
    expect(scheduled).toHaveBeenCalledWith(bot.api, "test_bot");
  });
  it("requires Telegram's secret before processing a webhook", async () => {
    const bot = await server();
    const invalid = await app.inject({ method: "POST", url: "/telegram/webhook", payload: { update_id: 1 } });
    expect(invalid.statusCode).toBe(401);
    expect(bot.handleUpdate).not.toHaveBeenCalled();
    const valid = await app.inject({ method: "POST", url: "/telegram/webhook", headers: { "x-telegram-bot-api-secret-token": "w".repeat(32) }, payload: { update_id: 1 } });
    expect(valid.statusCode).toBe(200);
    expect(bot.handleUpdate).toHaveBeenCalledWith({ update_id: 1 });
  });
  it("allows the main app in Telegram Web while isolating banner frames", async () => {
    await server();
    const panel = await app.inject({ method: "GET", url: "/" });
    expect(panel.headers["content-security-policy"]).toContain("https://web.telegram.org");
    expect(panel.headers["x-frame-options"]).toBeUndefined();
    expect(panel.headers["content-security-policy"]).not.toContain("data527.click");
    const banner = await app.inject({ method: "GET", url: "/banner-adsense.html" });
    expect(banner.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(banner.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(banner.headers["content-security-policy"]).toContain("sandbox allow-scripts allow-popups");
    expect(banner.headers["content-security-policy"]).not.toContain("allow-same-origin");
    const provider = await app.inject({ method: "GET", url: "/api/banner/adsense" });
    expect(provider.headers["content-security-policy"]).toContain("sandbox allow-scripts");
    expect(provider.body).toContain("ca-pub-8258058186888619");
    expect(banner.body).not.toContain("adsbygoogle.js");
  });
  it('does not process an ordinary webhook twice',async()=>{
    const bot=await server();vi.mocked(query).mockResolvedValueOnce({rows:[],rowCount:1} as never).mockResolvedValueOnce({rows:[],rowCount:1} as never).mockResolvedValueOnce({rows:[],rowCount:0} as never);
    const request={method:'POST' as const,url:'/telegram/webhook',headers:{'x-telegram-bot-api-secret-token':'w'.repeat(32)},payload:{update_id:8}};
    expect((await app.inject(request)).statusCode).toBe(200);expect((await app.inject(request)).json()).toMatchObject({ok:true,duplicate:true});expect(bot.handleUpdate).toHaveBeenCalledOnce();
  });
  it('allows payment updates to retry and propagates their activation errors',async()=>{
    const bot=await server();bot.handleUpdate.mockRejectedValueOnce(new Error('temporary activation failure'));
    const request={method:'POST' as const,url:'/telegram/webhook',headers:{'x-telegram-bot-api-secret-token':'w'.repeat(32)},payload:{update_id:9,message:{successful_payment:{telegram_payment_charge_id:'qa-payment'}}}};
    expect((await app.inject(request)).statusCode).toBe(500);expect((await app.inject(request)).statusCode).toBe(200);expect(bot.handleUpdate).toHaveBeenCalledTimes(2);
  });
});
