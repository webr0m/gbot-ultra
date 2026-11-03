import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = (file: string) => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");

function harness() {
  const scripts: any[] = [];
  const G: any = {
    state: { settings: { language: "es" }, bootstrap: {}, chat: { id: 1 }, tab: "home" },
    toast: vi.fn(), closeSheet: vi.fn(),
    registerAction: vi.fn(), registerForm: vi.fn(), registerInput: vi.fn(),
    api: { patch: vi.fn(), get: vi.fn() },
  };
  const window: any = { GBot: G };
  const context = {
    window, setTimeout, clearTimeout,
    localStorage: { removeItem: vi.fn() },
    document: {
      readyState: "loading", addEventListener: vi.fn(), querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({ remove: vi.fn() }),
      body: { appendChild: (script: any) => scripts.push(script) },
    },
  };
  runInNewContext(source("i18n.js"), context);
  const engine = { libReady: true, error: false, translate: vi.fn(() => true) };
  function ready() {
    window.__GT = { translator: engine };
    scripts.at(-1).onload();
  }
  return { G, window, context, scripts, engine, ready };
}

describe("Mini App translation", () => {
  it("does not load the external translator for Spanish", async () => {
    const h = harness();
    await h.G.applyLanguage("es");
    expect(h.scripts).toHaveLength(0);
  });

  it("maps Chinese to the engine language and restores Spanish", async () => {
    const h = harness();
    h.G.state.settings.language = "zh";
    const pending = h.G.applyLanguage("zh");
    h.ready();
    await pending;
    expect(h.engine.translate).toHaveBeenLastCalledWith("es", "zh-CN");
    h.G.state.settings.language = "es";
    await h.G.applyLanguage("es");
    expect(h.engine.translate).toHaveBeenLastCalledWith("es", "es");
  });

  it("only applies the most recent language while the engine loads", async () => {
    const h = harness();
    const first = h.G.applyLanguage("en");
    const second = h.G.applyLanguage("fr");
    expect(h.scripts).toHaveLength(1);
    h.ready();
    await Promise.all([first, second]);
    expect(h.engine.translate.mock.calls).toEqual([["es", "fr"]]);
  });

  it("cancels a pending translation when switching back to Spanish", async () => {
    const h = harness();
    const pending = h.G.applyLanguage("en");
    await h.G.applyLanguage("es");
    h.ready();
    await pending;
    expect(h.engine.translate).not.toHaveBeenCalled();
  });

  it("allows retrying after a script load failure", async () => {
    const h = harness();
    const pending = h.G.applyLanguage("en");
    h.scripts[0].onerror();
    await pending;
    expect(h.G.toast).toHaveBeenCalledWith(expect.stringContaining("traductor"), "error");
    const retry = h.G.applyLanguage("en");
    expect(h.scripts).toHaveLength(2);
    h.ready();
    await retry;
    expect(h.engine.translate).toHaveBeenCalledWith("es", "en");
  });

  it("saves language changes without replacing the active screen", async () => {
    const h = harness();
    runInNewContext(source("settings.js"), h.context);
    h.G.renderSettings = vi.fn();
    h.G.applyLanguage = vi.fn();
    h.G.api.patch.mockResolvedValue({ settings: { language: "en" } });
    await h.G.changeLanguage("en");
    expect(h.G.api.patch).toHaveBeenCalledWith("/api/settings", { chatId: 1, patch: { language: "en" } });
    expect(h.G.state.settings.language).toBe("en");
    expect(h.G.applyLanguage).toHaveBeenCalledWith("en");
    expect(h.G.renderSettings).not.toHaveBeenCalled();
  });

  it("keeps the saved language if updating it fails", async () => {
    const h = harness();
    runInNewContext(source("settings.js"), h.context);
    h.G.api.patch.mockRejectedValue(new Error("Network unavailable"));
    await expect(h.G.changeLanguage("en")).rejects.toThrow("Network unavailable");
    expect(h.G.state.settings.language).toBe("es");
  });
});

describe("Mini App navigation", () => {
  it("keeps the latest search when an older request completes later", async () => {
    const h = harness();
    h.G.state.members = { items: [], query: "before", filter: "all" };
    h.G.state.tab = "members";
    runInNewContext(source("ui.js"), h.context);
    h.G.renderMembers = vi.fn();
    let first!: (value: unknown) => void, second!: (value: unknown) => void;
    h.G.api.get.mockReturnValueOnce(new Promise(resolve => { first = resolve; })).mockReturnValueOnce(new Promise(resolve => { second = resolve; }));
    const old = h.G.loadMembers();
    h.G.state.members.query = "after";
    const current = h.G.loadMembers();
    second({ members: [{ id: 2 }], total: 1 }); await current;
    first({ members: [{ id: 1 }], total: 1 }); await old;
    expect(h.G.state.members.items).toEqual([{ id: 2 }]);
  });
  it("discards old group's content", async () => {
    const h = harness();
    runInNewContext(source("settings.js"), h.context);
    let finish!: (value: unknown) => void;
    h.G.api.get.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = h.G.loadContent();
    h.G.state.chat = { id: 2 }; h.G.state.content = { commands: ["current"] };
    finish({ commands: ["old"] }); await pending;
    expect(h.G.state.content.commands).toEqual(["current"]);
  });
  it.each([
    ["members", "loadMembers", "renderMembers", { members: [] }],
    ["moderation", "loadLogs", "renderModeration", { items: [] }],
  ])("does not replace Home and its banner with a late %s response", async (tab, load, render, result) => {
    const h = harness();
    h.G.state.members = { items: [], query: "" };
    h.G.state.logs = { items: [], action: "" };
    h.G.state.tab = tab;
    runInNewContext(source("ui.js"), h.context);
    h.G[render as string] = vi.fn();
    let finish: (value: unknown) => void = () => {};
    h.G.api.get.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = h.G[load as string]();
    expect(h.G[render as string]).toHaveBeenCalledTimes(1);
    h.G.state.tab = "home";
    finish(result);
    await pending;
    expect(h.G[render as string]).toHaveBeenCalledTimes(1);
  });
});
