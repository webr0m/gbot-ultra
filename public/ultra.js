/* Ultra: explicit AI queries and one independent Telegram bot per group. */
(() => {
  "use strict";
  const G = window.GBot;
  if (!G) return;
  const esc = G.esc;
  let session = null,
    sequence = 0;
  const button = (label, action, attrs = "") =>
    `<button type="button" class="btn btn-secondary" data-action="ultra-${action}" ${attrs}>${esc(label)}</button>`;
  const field = (label, control) =>
    `<label class="field"><span class="field-label">${esc(label)}</span>${control}</label>`;
  const input = (name, value = "", extra = "") =>
    `<input class="input" name="${name}" value="${esc(value)}" ${extra}>`;
  const current = () =>
    session &&
    G.state.chat?.id === session.chatId &&
    G.state.sheetOpen &&
    G.state.sheetVersion === session.version;
  function sheet(title, body) {
    G.openSheet({ title, body: `<div class="adv-center">${body}</div>` });
    session.version = G.state.sheetVersion;
  }
  async function post(path, body) {
    if (!current())
      throw new Error("Abre de nuevo las funciones Ultra de este grupo.");
    const original = session,
      version = G.state.sheetVersion;
    const r = await G.api.post("/api/ultra/" + path, {
      chatId: session.chatId,
      ...body,
    });
    if (
      original !== session ||
      G.state.chat?.id !== original.chatId ||
      G.state.sheetVersion !== version
    )
      throw new Error(
        "Cambiaste de vista. Revisa el resultado en el grupo original.",
      );
    return r;
  }
  async function refresh(message) {
    if (!current()) return;
    const original = session,
      version = session.version;
    const r = await G.api.get("/api/ultra?chat_id=" + session.chatId);
    if (!current() || original !== session || session.version !== version)
      return;
    session.data = r;
    session.token = "";
    G.toast(message || "Actualizado.", "success");
    home();
  }
  function home() {
    if (!current()) return;
    session.token = "";
    const d = session.data;
    sheet(
      "Asistente y marca propia",
      `<div class="adv-intro"><span class="badge">ULTRA</span><h3>La voz de tu comunidad.</h3><p>Un asistente que responde cuando se le consulta y un bot con tu nombre en Telegram. </p></div>${!d.allowed ? "<p>Estas funciones requieren Ultra. Puedes desactivar una configuración existente aunque termine el plan.</p>" : ""}<div class="adv-grid"><button type="button" class="adv-feature" data-action="ultra-ai"><span><strong>Asistente de IA</strong><small>Consultas con /ia y pruebas privadas en el panel.</small></span><span class="adv-status">${d.ai.config.enabled ? "ACTIVO" : "CONFIGURAR"}</span></button><button type="button" class="adv-feature" data-action="ultra-brand"><span><strong>Bot con marca propia</strong><small>Tu identidad en Telegram. Un bot por grupo.</small></span><span class="adv-status">${d.branding.bot?.state === "active" ? "ACTIVO" : "CONECTAR"}</span></button></div>`,
    );
  }
  G.registerAction("ultra-open", async () => {
    const id = G.state.chat?.id;
    if (!id) return;
    const seq = ++sequence;
    G.openSheet({ title: "Funciones Ultra", body: "<p>Cargando…</p>" });
    const version = G.state.sheetVersion;
    const data = await G.api.get("/api/ultra?chat_id=" + id);
    if (
      seq !== sequence ||
      G.state.chat?.id !== id ||
      !G.state.sheetOpen ||
      G.state.sheetVersion !== version
    )
      return;
    session = { chatId: id, version, data, token: "" };
    home();
  });
  G.registerAction("ultra-home", home);
  function ai() {
    if (!current()) return;
    const d = session.data,
      v = d.ai.config,
      p = d.ai.provider;
    sheet(
      "Asistente de IA",
      `${button("← Volver", "home")}<div class="card"><span class="badge">${p.configured ? "GROQ CONFIGURADO" : "PROVEEDOR PENDIENTE"}</span><h3>Respuestas, cuando hacen falta.</h3><p>Solo se envían a Groq la consulta escrita, las normas públicas y la orientación que configures aquí. No se envía el historial del chat. El asistente no ejecuta sanciones ni comandos.</p><p>Hasta 30 consultas nuevas al día por grupo, sujetas a la capacidad gratuita del servicio.  Las respuestas se guardan hasta una hora; nunca se guarda la pregunta en la base de datos.</p><p>Consultas nuevas hoy: ${esc(d.ai.usage?.calls || 0)}. ${p.paused ? "El proveedor está temporalmente en pausa." : ""}</p></div><form data-form="ultra-ai"><label class="adv-check"><input type="checkbox" name="enabled" ${v.enabled ? "checked" : ""} ${!d.allowed || !p.configured ? "disabled" : ""}>Activar asistente en este grupo</label>${field("Orientación pública para el asistente", `<textarea class="input" name="instructions" rows="3" maxlength="400" placeholder="Ejemplo: ayuda a los nuevos miembros a entender las normas.">${esc(v.instructions)}</textarea>`)}<label class="adv-check"><input type="checkbox" name="consent" ${v.consent ? "checked" : ""}>Autorizo enviar las consultas y este contexto público a Groq.</label><div class="sheet-actions"><button type="submit" class="btn btn-primary">Guardar asistente</button></div></form><div class="card"><h3>Probar en privado</h3><p>Cuando esté activado, los miembros pueden usar <strong>/ia su consulta</strong> en el grupo. Esta prueba se muestra solo aquí y consume la misma cuota.</p><form data-form="ultra-ask">${field("Tu consulta", `<textarea class="input" name="question" rows="3" required minlength="2" maxlength="1200"></textarea>`)}<button type="submit" class="btn btn-secondary" ${!v.enabled || !d.allowed ? "disabled" : ""}>Consultar al asistente</button></form><div id="ultra-answer" aria-live="polite"></div></div>`,
    );
  }
  G.registerAction("ultra-ai", ai);
  G.registerForm("ultra-ai", async (f) => {
    if (!current()) return;
    const fd = new FormData(f);
    await post("ai", {
      settings: {
        enabled: fd.has("enabled"),
        consent: fd.has("consent"),
        instructions: String(fd.get("instructions") || ""),
      },
      version: session.data.ai.config.version,
    });
    await refresh("Asistente actualizado.");
  });
  G.registerForm("ultra-ask", async (f) => {
    const r = await post("ask", {
      question: String(new FormData(f).get("question") || ""),
    });
    const result = document.getElementById("ultra-answer");
    if (result) {
      result.replaceChildren();
      const label = document.createElement("p");
      label.textContent =
        "IA · respuesta orientativa" + (r.cached ? " · reutilizada" : "");
      const answer = document.createElement("pre");
      answer.textContent = r.answer;
      result.append(label, answer);
    }
  });
  function brand() {
    if (!current()) return;
    session.token = "";
    const d = session.data,
      b = d.branding.bot;
    sheet(
      "Bot con marca propia",
      `${button("← Volver", "home")}<div class="card"><span class="badge">${b?.state === "active" ? "ACTIVO" : b ? "CONECTADO · EN PAUSA" : "TU IDENTIDAD EN TELEGRAM"}</span><h3>${esc(b?.name || "Un bot que lleve tu nombre.")}</h3><p>Un bot independiente por grupo Ultra. Las reglas y los datos del grupo se conservan; la Mini App y las compras se administran desde el bot principal.</p><p>La conexión debe autorizarla el creador del grupo. Mantén al bot principal como administrador para conservar la gestión central y poder volver a él.</p>${b ? `<p><a href="https://t.me/${esc(b.username)}" target="_blank" rel="noopener">@${esc(b.username)} ↗</a></p>${b.last_error ? `<p>${esc(b.last_error)}</p>` : ""}` : ""}</div>${b?.state === "active" ? `<p>El bot con tu marca procesa la moderación, bienvenidas, comandos y publicaciones de este grupo. Otros grupos quedan fuera de su alcance. Al terminar Ultra, la conexión de marca propia deja de actuar.</p><form data-form="ultra-pause"><button type="submit" class="btn btn-secondary">Pausar y volver al bot principal</button></form>` : `${b ? `<div class="card"><h3>2. Añádelo y activa la conexión</h3><p>Añade @${esc(b.username)} a este grupo y dale permisos para eliminar mensajes y restringir miembros. Resuelve antes los captchas, cierres y envíos pendientes.</p><a class="btn btn-secondary" href="https://t.me/${esc(b.username)}?startgroup=true" target="_blank" rel="noopener">Añadir mi bot al grupo ↗</a><form data-form="ultra-activate"><label class="adv-check"><input type="checkbox" name="replaceWebhook">Autorizo reemplazar otra conexión de webhook que tenga este bot, si existe.</label><button type="submit" class="btn btn-primary" ${!d.allowed ? "disabled" : ""}>Activar mi bot en este grupo</button></form></div>` : ""}<div class="card"><h3>${b ? "Cambiar identidad o credencial" : "1. Crea tu bot y conéctalo"}</h3><p>Abre <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather ↗</a>, usa /newbot y elige nombre y usuario. La foto se cambia allí con /setuserpic. Pega aquí el token en el campo privado; se guardará cifrado y no volverá a mostrarse.</p>${!d.branding.configured ? "<p>El almacén privado aún no está configurado.</p>" : ""}<form data-form="ultra-inspect">${field("Token privado de BotFather", `<input class="input" name="token" type="password" autocomplete="new-password" spellcheck="false" required maxlength="200" ${G.DEMO ? 'value="TOKEN_DE_EJEMPLO"' : ""}>`)}${field("Nombre visible", input("name", b?.name || "", 'required maxlength="64"'))}${field("Descripción", `<textarea class="input" name="description" rows="3" maxlength="512">${esc(b?.description || "Administración y protección de nuestra comunidad.")}</textarea>`)}<button type="submit" class="btn btn-secondary" ${!d.allowed || !d.branding.configured ? "disabled" : ""}>Comprobar identidad</button></form></div>`}<p>El traslado automático de medios guardados admite hasta 10 MB. Si un archivo no puede trasladarse, vuelve a guardarlo desde el bot actual. Las credenciales permanecen privadas; no pegues tokens en mensajes del grupo.</p>`,
    );
  }
  G.registerAction("ultra-brand", brand);
  G.registerForm("ultra-inspect", async (f) => {
    const fd = new FormData(f),
      token = String(fd.get("token") || ""),
      r = await post("brand", { action: "inspect", token });
    session.token = token;
    session.identity = {
      name: String(fd.get("name") || ""),
      description: String(fd.get("description") || ""),
    };
    sheet(
      "Confirmar identidad del bot",
      `<h3>@${esc(r.bot.username)}</h3><p>Telegram reconoce esta credencial como el bot <strong>${esc(r.bot.name)}</strong>.</p><p>Nombre que utilizará: ${esc(session.identity.name)}</p><p>${r.hasWebhook ? "Tiene una conexión de webhook. Al activar deberás autorizar expresamente reemplazarla." : "No tiene una conexión de webhook activa."}</p><p>Se guardará cifrado y quedará en pausa hasta que lo añadas al grupo y lo actives.</p><form data-form="ultra-connect"><button type="submit" class="btn btn-primary">Guardar conexión privada</button>${button("Cancelar", "brand")}</form>`,
    );
  });
  G.registerForm("ultra-connect", async () => {
    if (!current() || !session.token) return;
    try {
      await post("brand", {
        action: "save",
        token: session.token,
        ...session.identity,
        version: session.data.branding.bot?.version || 0,
      });
      await refresh("Bot conectado en pausa. Añádelo al grupo y actívalo.");
    } finally {
      session.token = "";
    }
  });
  G.registerForm("ultra-activate", async (f) => {
    await post("brand", {
      action: "activate",
      version: session.data.branding.bot.version,
      replaceWebhook: new FormData(f).has("replaceWebhook"),
    });
    await refresh("Bot con marca propia activado.");
  });
  G.registerForm("ultra-pause", async () => {
    await post("brand", {
      action: "pause",
      version: session.data.branding.bot.version,
    });
    await refresh(
      "Conexión pausada. El bot principal vuelve a procesar el grupo.",
    );
  });
  const oldClose = G.closeSheet;
  G.closeSheet = function () {
    if (session) session.token = "";
    return oldClose();
  };
  const oldRender = G.renderSettings;
  G.renderSettings = function () {
    oldRender();
    const promo=document.querySelector('#main .adv-promo');
    if(promo)promo.insertAdjacentHTML('beforeend','<div class="adv-tools">'+button('Asistente y marca propia','open')+'</div>');
  };
  if (G.DEMO) {
    const original = G.demoRequest,
      records = new Map();
    G.demoRequest = async (path, options = {}) => {
      const url = new URL(path, location.origin);
      if (!url.pathname.startsWith("/api/ultra"))
        return original(path, options);
      await G.delay(100);
      const b = options.body ? JSON.parse(options.body) : {},
        id = Number(url.searchParams.get("chat_id") || b.chatId);
      if (!records.has(id))
        records.set(id, {
          allowed: true,
          ai: {
            config: {
              enabled: false,
              consent: false,
              instructions: "",
              version: 0,
            },
            provider: { configured: true, paused: false },
            usage: { calls: 0 },
          },
          branding: { configured: true, bot: null },
        });
      const d = records.get(id);
      if ((options.method || "GET") === "GET")
        return structuredClone({ ok: true, ...d });
      if (url.pathname.endsWith("/ai")) {
        if (b.settings.enabled && !b.settings.consent)
          throw new Error("Autoriza el envío antes de activar.");
        d.ai.config = { ...b.settings, version: d.ai.config.version + 1 };
      } else if (url.pathname.endsWith("/ask")) {
        return {
          ok: true,
          answer:
            "Esta es una respuesta de demostración. En un grupo real, el asistente utiliza las normas públicas y tu consulta para orientarte.",
          cached: false,
        };
      } else if (url.pathname.endsWith("/brand")) {
        if (b.action === "inspect")
          return {
            ok: true,
            bot: {
              id: 900001,
              username: "ComunidadDemoBot",
              name: "Bot de demostración",
            },
            hasWebhook: false,
          };
        if (b.action === "save")
          d.branding.bot = {
            id: "demo",
            bot_id: 900001,
            username: "ComunidadDemoBot",
            name: b.name,
            description: b.description,
            state: "paused",
            version: (d.branding.bot?.version || 0) + 1,
          };
        if (["activate", "pause"].includes(b.action)) {
          d.branding.bot.state = b.action === "activate" ? "active" : "paused";
          d.branding.bot.version++;
        }
      }
      return { ok: true, demo: true };
    };
  }
})();
