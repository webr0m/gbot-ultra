import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function coreHarness() {
  const listeners = new Map<string, Function>();
  const document = { addEventListener: (name: string, fn: Function) => listeners.set(name, fn), getElementById: () => null, querySelectorAll: () => [], documentElement: { dataset: {} }, body: { classList: { add: vi.fn(), remove: vi.fn() } } };
  const window: any = { location: { search: "" }, scrollTo: vi.fn() };
  runInNewContext(readFileSync(new URL("../public/core.js", import.meta.url), "utf8"), { window, document, URLSearchParams, URL, Intl, Date, setTimeout, clearTimeout, localStorage: { getItem: () => null }, AbortController });
  const G = window.GBot;
  G.updateHeader = vi.fn(); G.renderTab = vi.fn(); G.renderLoading = vi.fn(); G.applyLanguage = vi.fn(); G.toast = vi.fn();
  G.state.chat = { id: 1 }; G.state.chats = [{ id: 1 }, { id: 2 }];
  return { G, listeners };
}
const payload = (id: number) => ({ settings: { language: "es" }, chat: { id, title: "Group " + id, premium: { active: false } } });

describe("Mini App request boundaries", () => {
  it("discards an old group bootstrap that finishes after a new group", async () => {
    const { G } = coreHarness();
    let first!: Function, second!: Function;
    G.api.get = vi.fn().mockReturnValueOnce(new Promise(resolve => { first = resolve; })).mockReturnValueOnce(new Promise(resolve => { second = resolve; }));
    const old = G.loadBootstrap();
    G.state.chat = { id: 2 };
    const current = G.loadBootstrap();
    second(payload(2)); await current;
    first(payload(1)); await old;
    expect(G.state.chat.id).toBe(2);
    expect(G.state.bootstrap.chat.id).toBe(2);
    expect(G.renderTab).toHaveBeenCalledTimes(1);
  });
  it("does not report a successful refresh when loading fails", async () => {
    const { G } = coreHarness();
    G.loadBootstrap = vi.fn(async () => false);
    await G.refreshAll();
    expect(G.toast).not.toHaveBeenCalled();
  });
  it("submits a form only once while its request is pending", async () => {
    const { G, listeners } = coreHarness();
    let finish!: Function;
    const handler = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    G.registerForm("test", handler);
    G.state.sheetChatId = 1;
    const button = { disabled: false, setAttribute: vi.fn(), removeAttribute: vi.fn() };
    const form = { dataset: { form: "test" } as any, querySelectorAll: () => [button],closest:()=>({}) };
    const event = { target: { closest: () => form }, preventDefault: vi.fn() };
    listeners.get("submit")!(event); listeners.get("submit")!(event);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    finish(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(button.disabled).toBe(false);
  });
  it("does not submit an old group's form", async () => {
    const { G, listeners } = coreHarness();
    const handler = vi.fn(); G.registerForm("test", handler);
    G.state.sheetChatId = 2;
    listeners.get("submit")!({ target: { closest: () => ({ dataset: { form: "test" },closest:()=>({}) }) }, preventDefault: vi.fn() });
    await Promise.resolve(); expect(handler).not.toHaveBeenCalled();
  });
  it('allows a main-page billing form without an open sheet',async()=>{
    const {G,listeners}=coreHarness();const handler=vi.fn();G.registerForm('license',handler);G.state.sheetChatId=null;
    const form={dataset:{form:'license'},closest:()=>null,querySelectorAll:()=>[]};listeners.get('submit')!({target:{closest:()=>form},preventDefault:vi.fn()});await Promise.resolve();expect(handler).toHaveBeenCalledOnce();
  });
});
