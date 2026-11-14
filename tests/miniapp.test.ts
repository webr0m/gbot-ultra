import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = (file: string) => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");

function harness(language?: string) {
  const scripts: any[] = [];
  const G: any = {
    state: { settings: { language: "es" }, bootstrap: {}, chat: { id: 1 }, tab: "home" },
    toast: vi.fn(), closeSheet: vi.fn(),
    registerAction: vi.fn(), registerForm: vi.fn(), registerInput: vi.fn(),
    api: { patch: vi.fn(), get: vi.fn() },
  };
  const window: any = { GBot: G, Telegram: { WebApp: { initDataUnsafe: { user: { language_code: language } } } } };
  const context = {
    window, setTimeout, clearTimeout,
    localStorage: { removeItem: vi.fn() },
    document: {
      documentElement: { lang: "es", dir: "ltr" },
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
  it.each([
    ["es", "es"], ["en-US", "en"], ["pt-BR", "pt"], ["zh_CN", "zh"],
    ["UK-ua", "uk"], ["ja-JP", "ja"], ["id_ID", "id"], ["fa-IR", "fa"],
    ["invalid", "en"], ["sv", "en"], ["", "en"], [undefined, "en"],
  ])("detects Telegram locale %s as %s, independently of the group", (client, expected) => {
    const h = harness(client);
    h.G.state.settings.language = "fr";
    expect(h.G.currentLang()).toBe(expected);
    h.G.state.settings.language = "de";
    expect(h.G.currentLang()).toBe(expected);
  });

  it("uses the verified Telegram locale if the SDK has no locale", () => {
    const h = harness();
    h.G.state.bootstrap.user = { languageCode: "ko-KR" };
    expect(h.G.currentLang()).toBe("ko");
    h.window.Telegram.WebApp.initDataUnsafe.user.language_code = "nl-NL";
    expect(h.G.currentLang()).toBe("nl");
    h.window.Telegram.WebApp.initDataUnsafe.user.language_code = "unsupported";
    expect(h.G.currentLang()).toBe("en");
  });

  it("provides local navigation and appearance translations in all 20 panel languages", () => {
    const h = harness();
    expect(h.G.LANGUAGES).toHaveLength(20);
    expect(new Set(h.G.LANGUAGES.map((lang: any) => lang.code)).size).toBe(20);
    const keys = ["home", "members", "moderation", "settings", "premium", "changeTheme", "groups", "changeGroup", "appearance", "nightMode", "dayMode"];
    for (const { code } of h.G.LANGUAGES) {
      for (const key of keys) expect(h.G.t(key, code)).not.toBe(key);
    }
    expect(h.G.t("settings", "unsupported")).toBe("Settings");
    expect(h.G.t("settings", "pt-BR")).toBe("Ajustes");
  });

  it("translates the entire panel into English for an unavailable Telegram language", async () => {
    const h = harness("sv-SE");
    const pending = h.G.applyClientLanguage();
    h.ready();
    await pending;
    expect(h.engine.translate).toHaveBeenCalledWith("es", "en");
    expect(h.context.document.documentElement).toMatchObject({ lang: "en", dir: "ltr" });
  });

  it.each(["ar", "fa"])("sets right-to-left layout for %s and restores it for English", async (language) => {
    const h = harness(language);
    const pending = h.G.applyClientLanguage();
    h.ready();
    await pending;
    expect(h.context.document.documentElement).toMatchObject({ lang: language, dir: "rtl" });
    h.window.Telegram.WebApp.initDataUnsafe.user.language_code = "en";
    await h.G.applyClientLanguage();
    expect(h.context.document.documentElement).toMatchObject({ lang: "en", dir: "ltr" });
  });

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
    expect(h.G.toast).toHaveBeenCalledWith(expect.stringContaining("translator"), "error");
    const retry = h.G.applyLanguage("en");
    expect(h.scripts).toHaveLength(2);
    h.ready();
    await retry;
    expect(h.engine.translate).toHaveBeenCalledWith("es", "en");
  });

  it("saves the group language without overriding the client's panel language", async () => {
    const h = harness("ja-JP");
    runInNewContext(source("settings.js"), h.context);
    h.G.renderSettings = vi.fn();
    h.G.applyClientLanguage = vi.fn();
    h.G.api.patch.mockResolvedValue({ settings: { language: "en" } });
    await h.G.changeLanguage("en");
    expect(h.G.api.patch).toHaveBeenCalledWith("/api/settings", { chatId: 1, patch: { language: "en" } });
    expect(h.G.state.settings.language).toBe("en");
    expect(h.G.applyClientLanguage).toHaveBeenCalledWith();
    expect(h.G.currentLang()).toBe("ja");
    expect(h.G.renderSettings).not.toHaveBeenCalled();
  });

  it("renders all twenty languages in the group selector", () => {
    const h = harness("en");
    runInNewContext(source("settings.js"), h.context);
    h.G.esc = (value: unknown) => String(value);
    h.G.openSheet = vi.fn();
    const open = h.G.registerAction.mock.calls.find(([name]: any[]) => name === "change-language")?.[1];
    open();
    expect(h.G.GROUP_LANGUAGES).toHaveLength(20);
    const sheet = h.G.openSheet.mock.calls[0][0];
    expect((sheet.body.match(/data-action="set-language"/g) || [])).toHaveLength(20);
    for (const language of h.G.LANGUAGES) expect(sheet.body).toContain('data-lang="' + language.code + '"');
  });

  it.each(["uk", "pl", "nl", "ro", "ja", "ko", "hi", "id", "vi", "fa"])("saves new group language %s without changing the Telegram panel locale", async (language) => {
    const h = harness("pt-BR");
    runInNewContext(source("settings.js"), h.context);
    h.G.api.patch.mockResolvedValue({ settings: { language } });
    h.G.applyClientLanguage = vi.fn();
    await h.G.changeLanguage(language);
    expect(h.G.api.patch).toHaveBeenCalledWith("/api/settings", { chatId: 1, patch: { language } });
    expect(h.G.state.settings.language).toBe(language);
    expect(h.G.currentLang()).toBe("pt");
  });

  it("keeps the saved language if updating it fails", async () => {
    const h = harness();
    runInNewContext(source("settings.js"), h.context);
    h.G.api.patch.mockRejectedValue(new Error("Network unavailable"));
    await expect(h.G.changeLanguage("en")).rejects.toThrow("Network unavailable");
    expect(h.G.state.settings.language).toBe("es");
  });
});

describe("Mini App automatic language lifecycle", () => {
  it("applies the client language on startup and when reopening the Mini App", () => {
    const h = harness("pl-PL");
    h.G.boot = vi.fn().mockResolvedValue(undefined);
    h.G.applyClientLanguage = vi.fn();
    h.context.document.readyState = "complete";
    runInNewContext(source("start.js"), h.context);
    expect(h.G.applyClientLanguage).toHaveBeenCalledOnce();
    expect(h.G.boot).toHaveBeenCalledOnce();
    const handler = h.context.document.addEventListener.mock.calls.find(([event]: any[]) => event === "visibilitychange")?.[1];
    Object.assign(h.context.document, { visibilityState: "hidden" });
    handler();
    expect(h.G.applyClientLanguage).toHaveBeenCalledOnce();
    Object.assign(h.context.document, { visibilityState: "visible" });
    handler();
    expect(h.G.applyClientLanguage).toHaveBeenCalledTimes(2);
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
