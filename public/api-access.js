/* API para automatizaciones: claves por grupo con ámbitos y una referencia de uso. */
(() => {
  "use strict";
  const G = window.GBot;
  if (!G) return;
  const esc = G.esc;
  let session = null,
    sequence = 0,
    secret = "";
  const button = (label, action, attrs = "") =>
    `<button type="button" class="btn btn-secondary" data-action="${action}" ${attrs}>${esc(label)}</button>`;
  const field = (label, control) =>
    `<label class="field"><span class="field-label">${esc(label)}</span>${control}</label>`;
  const current = () =>
    session &&
    G.state.chat?.id === session.chatId &&
    G.state.sheetOpen &&
    G.state.sheetVersion === session.version;
  function sheet(title, body) {
    G.openSheet({ title, body: `<div class="adv-center">${body}</div>` });
    session.version = G.state.sheetVersion;
  }
  async function load() {
    const r = await G.api.get("/api/access/keys?chat_id=" + session.chatId);
    session.keys = r.keys || [];
    return session.keys;
  }
  function scopeNames(key) {
    return (key.scopes || []).map((s) => (s === "moderate" ? "moderación" : "lectura")).join(" · ");
  }
  function home() {
    if (!current()) return;
    const keys = session.keys || [];
    sheet(
      "API para automatizaciones",
      `<div class="adv-intro"><span class="badge">ULTRA</span><h3>Tu bot, desde tus herramientas.</h3><p>Crea claves para conectar tus automatizaciones con la moderación, los miembros y las estadísticas del grupo. Cada clave pertenece solo a este grupo.</p></div><div class="card"><p>Referencia de la API: <a href="/apidocs" target="_blank" rel="noopener">gbot.webrom.cc/apidocs ↗</a></p><p>Límite: 60 peticiones por minuto y clave. Ámbitos: lectura y moderación.</p></div>${keys.length ? `<h4>Claves de este grupo</h4>${keys.map((k) => `<div class="card"><strong>${esc(k.name)}</strong><p class="mono">${esc(k.prefix)}…</p><p>${esc(scopeNames(k))} · ${k.requests} peticiones · ${k.lastUsedAt ? "último uso " + esc(G.fmtDateTime(k.lastUsedAt)) : "sin uso"}</p>${k.revoked ? "<p>Anulada.</p>" : `<div class="adv-tools">${button("Anular", "api-access-revoke", `data-id="${esc(k.id)}"`)}</div>`}</div>`).join("")}` : "<p>Todavía no hay claves en este grupo.</p>"}<div class="card"><h4>Crear una clave</h4><p>La clave se muestra una sola vez. Guárdala en tu gestor de secretos: después solo verás su prefijo.</p><form data-form="api-access-create">${field("Nombre de la clave", '<input class="input" name="name" maxlength="48" required placeholder="Ejemplo: Moderación automática">')}<label class="adv-check"><input type="checkbox" name="read" checked>Lectura: miembros, estadísticas, ajustes e historial.</label><label class="adv-check"><input type="checkbox" name="moderate">Moderación: silenciar, expulsar, banear, avisar y revertir.</label><div class="sheet-actions"><button type="submit" class="btn btn-primary">Crear clave</button></div></form></div>`,
    );
  }
  G.registerAction("api-access-open", async () => {
    const id = G.state.chat?.id;
    if (!id) return;
    const seq = ++sequence;
    G.openSheet({ title: "API para automatizaciones", body: "<p>Cargando…</p>" });
    const version = G.state.sheetVersion;
    session = { chatId: id, version, keys: [] };
    try {
      await load();
    } catch {
      session.keys = [];
    }
    if (
      seq !== sequence ||
      G.state.chat?.id !== id ||
      !G.state.sheetOpen ||
      G.state.sheetVersion !== version
    )
      return;
    home();
  });
  G.registerAction("api-access-home", home);
  G.registerAction("api-access-revoke", async (target) => {
    if (!current()) return;
    const id = target?.dataset?.id;
    if (!id) return;
    await G.api.post("/api/access/keys/revoke", { chatId: session.chatId, id });
    await load();
    G.toast("Clave anulada.", "success");
    home();
  });
  G.registerForm("api-access-create", async (form) => {
    if (!current()) return;
    const fd = new FormData(form);
    const scopes = [];
    if (fd.has("read")) scopes.push("read");
    if (fd.has("moderate")) scopes.push("moderate");
    if (!scopes.length) throw new Error("Elige al menos un ámbito.");
    const r = await G.api.post("/api/access/keys", {
      chatId: session.chatId,
      name: String(fd.get("name") || "").trim(),
      scopes,
    });
    secret = r.secret || "";
    await load();
    sheet(
      "Guarda tu clave",
      `<div class="card"><h3>Esta clave no volverá a mostrarse.</h3><p class="mono">${esc(secret)}</p><div class="adv-tools">${button("Copiar", "api-access-copy", `data-secret="${esc(secret)}"`)}${button("Volver", "api-access-home")}</div><p>Úsala como <strong>Authorization: Bearer &lt;clave&gt;</strong> contra <strong>https://gbot.webrom.cc/api/v1</strong>.</p></div>`,
    );
  });
  G.registerAction("api-access-copy", async (target) => {
    const value = target?.dataset?.secret;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    G.toast("Clave copiada.", "success");
  });
  const oldClose = G.closeSheet;
  G.closeSheet = function () {
    secret = "";
    return oldClose();
  };
  const oldRender = G.renderSettings;
  G.renderSettings = function () {
    oldRender();
    const promo = document.querySelector("#main .adv-promo");
    if (!promo) return;
    let tools = promo.querySelector(".adv-tools");
    if (!tools) {
      tools = document.createElement("div");
      tools.className = "adv-tools";
      promo.appendChild(tools);
    }
    tools.insertAdjacentHTML(
      "beforeend",
      button("API para automatizaciones", "api-access-open"),
    );
  };
  if (G.DEMO) {
    const original = G.demoRequest,
      records = new Map();
    G.demoRequest = async (path, options = {}) => {
      const url = new URL(path, location.origin);
      if (!url.pathname.startsWith("/api/access"))
        return original(path, options);
      await G.delay(120);
      const b = options.body ? JSON.parse(options.body) : {};
      const id = Number(url.searchParams.get("chat_id") || b.chatId);
      if (!records.has(id))
        records.set(id, [
          {
            id: "demo-1",
            name: "Moderación automática",
            prefix: "gbot_live_demo1",
            scopes: ["read", "moderate"],
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
            requests: 0,
            revoked: false,
          },
        ]);
      const keys = records.get(id);
      if (url.pathname.endsWith("/revoke")) {
        const target = keys.find((k) => k.id === b.id);
        if (target) target.revoked = true;
        return { ok: true, revoked: true };
      }
      if ((options.method || "GET") === "GET")
        return { ok: true, keys: structuredClone(keys) };
      const created = {
        id: "demo-" + Date.now(),
        name: b.name,
        prefix: "gbot_live_demo" + String(keys.length + 1),
        scopes: b.scopes,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        requests: 0,
        revoked: false,
      };
      keys.unshift(created);
      return {
        ok: true,
        key: created,
        secret: "gbot_live_demo" + "x".repeat(40),
      };
    };
  }
})();
