import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = (file: string) => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");

function harness(tier = "pro") {
  const actions: Record<string, (el: any) => Promise<void>> = {};
  const forms: Record<string, (form: any) => Promise<void>> = {};
  const sheets: { title: string; body: string }[] = [];
  const toasts: { message: string; tone?: string }[] = [];
  const calls: string[] = [];
  const G: any = {
    state: {
      chat: { id: -1001, title: "Comunidad" },
      bootstrap: { chat: { premium: { tier } } },
      sheetOpen: false,
      sheetVersion: 0,
      tab: "moderation",
    },
    DEMO: false,
    esc: (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    actionMeta: (action: string) => action,
    registerAction: (name: string, handler: any) => { actions[name] = handler; },
    registerForm: (name: string, handler: any) => { forms[name] = handler; },
    openSheet: (sheet: { title: string; body: string }) => {
      sheets.push(sheet);
      G.state.sheetOpen = true;
      G.state.sheetVersion += 1;
    },
    closeSheet: () => { G.state.sheetOpen = false; },
    toast: (message: string, tone?: string) => toasts.push({ message, tone }),
    api: {
      get: vi.fn(async (path: string) => {
        calls.push(path);
        return { ok: true, items: [], rules: [], trend: [], hasMore: false, windows: [7, 14, 30, 90, 100], retentionDays: 100 };
      }),
      post: vi.fn(async (path: string) => { calls.push(path); return { ok: true }; }),
    },
    renderModeration: () => {},
    boot: async () => {},
    switchTab: async () => {},
  };
  const window: any = { GBot: G };
  const context = {
    window, setTimeout, clearTimeout,
    location: { search: "" },
    document: { getElementById: () => null, createElement: () => ({ remove: vi.fn() }) },
  };
  runInNewContext(source("quality-undo.js"), context);
  return { G, actions, forms, sheets, toasts, calls };
}

describe("Panel de calidad de reglas", () => {
  it("ofrece solo los períodos que el nivel admite", async () => {
    const h = harness("pro");
    await h.actions["quality-open"]?.({});
    const body = h.sheets.at(-1)?.body ?? "";
    expect(body).toContain('<option value="100"');
    expect(body).not.toContain('<option value="365"');
  });

  it("anuncia la conservación del nivel", async () => {
    const h = harness("pro");
    await h.actions["quality-open"]?.({});
    expect(h.sheets.at(-1)?.body).toContain("Conservación: 100 días");
  });

  it("consulta el grupo con el período elegido", async () => {
    const h = harness("pro");
    await h.actions["quality-open"]?.({});
    expect(h.calls[0]).toContain("chat_id=-1001");
  });

  it("explica el nivel necesario a un grupo por debajo de Pro", async () => {
    const h = harness("premium");
    await h.actions["quality-open"]?.({});
    expect(h.toasts.at(-1)).toEqual({ message: "Requiere Pro o Ultra. Consulta los planes en Premium.", tone: "error" });
    expect(h.calls.length).toBe(0);
    expect(h.sheets.length).toBe(0);
  });

  it("deja abrir la herramienta a un grupo Ultra", async () => {
    const h = harness("ultra");
    await h.actions["quality-open"]?.({});
    expect(h.toasts.length).toBe(0);
    expect(h.sheets.length).toBeGreaterThan(0);
  });
});
