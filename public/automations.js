/* GBot · Programación y moderación visual. Demo never calls external providers. */
(() => {
  "use strict";
  const G = window.GBot;
  if (!G) return;
  const esc = G.esc;
  G.articleEditor = {
    fields(extras) {
      return field("Encabezado", input("articleHeading", "text", extras?.heading || "", 'maxlength="120"')) +
        field("Tabla · una fila por línea, separa columnas con |",
          `<textarea class="input" name="articleTable" rows="4" maxlength="7300" placeholder="Horario | Actividad">${esc(extras?.table?.map(row => row.join(" | ")).join("\n") || "")}</textarea>`) +
        field("Galería · hasta 6 enlaces HTTPS directos a fotos, uno por línea",
          `<textarea class="input" name="articleGallery" rows="4" maxlength="3010">${esc(extras?.gallery?.join("\n") || "")}</textarea>`);
    },
    read(data) {
      const lines = name => String(data.get(name) || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const table = lines("articleTable").map(row => row.split("|").map(cell => cell.trim()));
      const gallery = lines("articleGallery");
      if (table.length > 10 || table.some(row => row.length < 2 || row.length > 6 || row.length !== table[0].length || row.some(cell => cell.length > 120))) {
        throw new Error("Usa hasta 10 filas de 2 a 6 columnas iguales, con un máximo de 120 caracteres por celda.");
      }
      if (gallery.length > 6 || gallery.some(value => {
        try {const url = new URL(value);return url.protocol !== "https:" || url.username || url.password || value.length > 500;}
        catch {return true;}
      })) throw new Error("Usa hasta 6 enlaces HTTPS directos a fotos.");
      return { heading: String(data.get("articleHeading") || "").trim(), table, gallery };
    },
    preview(content, extras) {
      const table = extras?.table?.length ? `<div class="table-scroll"><table class="compare-table"><tbody>${extras.table.map((row,i) => `<tr>${row.map(cell => i ? `<td>${esc(cell)}</td>` : `<th scope="col">${esc(cell)}</th>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";
      const gallery = extras?.gallery?.length ? `<p>Galería · ${extras.gallery.length} ${extras.gallery.length === 1 ? "foto" : "fotos"} por URL</p>` : "";
      return `<article>${extras?.heading ? `<h3>${esc(extras.heading)}</h3>` : ""}<pre class="automation-preview">${esc(content)}</pre>${table}${gallery}</article>`;
    },
  };
  let session = null,
    sequence = 0;
  const status = {
    active: "Activa",
    paused: "Pausada",
    posting: "Enviando",
    completed: "Completada",
    sent: "Enviada",
    review: "Revisar",
    pending: "En cola",
    processing: "Analizando",
    unavailable: "Sin analizar",
    clear: "Sin coincidencia",
    deleted: "Foto eliminada",
    skipped: "Omitida",
    reviewed: "Revisada",
  };
  const recurrence = {
    once: "Una vez",
    daily: "Cada día",
    weekly: "Cada semana",
  };
  const button = (text, action, attrs = "") =>
    `<button type="button" class="btn btn-secondary" data-action="automation-${action}" ${attrs}>${esc(text)}</button>`;
  const field = (label, control) =>
    `<label class="field"><span class="field-label">${esc(label)}</span>${control}</label>`;
  const input = (name, type, value = "", extra = "") =>
    `<input class="input" name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;
  const date = (value, zone) => {
    try {
      return new Intl.DateTimeFormat("es", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: zone,
      }).format(new Date(value));
    } catch {
      return "Fecha no disponible";
    }
  };
  const current = () =>
    session &&
    G.state.chat?.id === session.chatId &&
    G.state.sheetOpen &&
    G.state.sheetVersion === session.sheetVersion;
  function sheet(title, body) {
    G.openSheet({
      title,
      body: `<div class="adv-center automation-center">${body}</div>`,
    });
    session.sheetVersion = G.state.sheetVersion;
  }
  async function post(route, body) {
    if (!current())
      throw new Error("Abre de nuevo las automatizaciones de este grupo.");
    const original = session,
      version = G.state.sheetVersion;
    const result = await G.api.post("/api/automations/" + route, {
      chatId: original.chatId,
      ...body,
    });
    if (
      session !== original ||
      G.state.chat?.id !== original.chatId ||
      G.state.sheetVersion !== version
    )
      throw new Error(
        "Cambiaste de vista. Revisa el resultado en el grupo original.",
      );
    return result;
  }
  async function refresh(message) {
    if (!current()) return;
    const original = session,
      version = G.state.sheetVersion;
    const data = await G.api.get("/api/automations?chat_id=" + original.chatId);
    if (session !== original || !current() || G.state.sheetVersion !== version)
      return;
    session.data = data;
    if (message) G.toast(message, "success");
    overview();
  }
  function overview() {
    if (!current()) return;
    session.pending = null;
    const d = session.data;
    sheet(
      "Publicaciones y filtro visual",
      `<div class="adv-intro"><span class="badge">${esc(d.tier.toUpperCase())}</span><h3>Más tiempo para tu comunidad.</h3><p>Publica a tu hora y revisa fotos desde el mismo lugar. Cada grupo conserva su propia configuración.</p></div><div class="adv-grid"><button class="adv-feature" type="button" data-action="automation-posts"><span><strong>Publicaciones programadas</strong><small>Texto o artículo, botón, temas y repetición diaria o semanal.</small></span><span class="adv-status">${d.features.publications ? "ABRIR" : "PRO"}</span></button><button class="adv-feature" type="button" data-action="automation-visual"><span><strong>Filtro visual NSFW</strong><small>Fotos · revisión o eliminación. Desactivado hasta que lo autorices.</small></span><span class="adv-status">${d.visual.config.enabled ? "ACTIVO" : d.features.visual ? "CONFIGURAR" : "PRO"}</span></button></div><p>Pro: hasta 20 programaciones y 100 fotos nuevas al día por grupo. Ultra: 100 y 300. </p>`,
    );
  }
  async function open() {
    const chatId = G.state.chat?.id;
    if (!chatId) return;
    const req = ++sequence;
    G.openSheet({
      title: "Automatizaciones",
      body: "<p>Cargando las funciones de este grupo…</p>",
    });
    const version = G.state.sheetVersion;
    const data = await G.api.get("/api/automations?chat_id=" + chatId);
    if (
      req !== sequence ||
      G.state.chat?.id !== chatId ||
      !G.state.sheetOpen ||
      G.state.sheetVersion !== version
    )
      return;
    session = { chatId, data, sheetVersion: version, pending: null };
    overview();
  }
  G.registerAction("automation-open", open);
  G.registerAction("automation-home", overview);
  function posts() {
    if (!current()) return;
    const d = session.data;
    sheet(
      "Publicaciones programadas",
      `${button("← Volver", "home")}<p>Puedes programar texto plano o un artículo con tabla y galería. Si el hosting se reactiva mediante el cron de respaldo, la publicación puede demorarse hasta cinco minutos.</p>${d.features.publications ? button("Crear publicación", "new") : "<p>Crear o reprogramar requiere Pro o Ultra. Puedes pausar y archivar lo existente.</p>"}${d.posts.length ? d.posts.map((p) => `<article class="card"><div class="automation-meta"><span class="badge">${esc(status[p.state] || p.state)}</span><span>${esc(recurrence[p.recurrence])}</span></div><h3>${esc(p.title)}</h3><p>${esc(date(p.next_run_at, p.timezone))} · ${esc(p.timezone)}${p.thread_id ? " · Tema " + esc(p.thread_id) : ""}</p>${G.articleEditor.preview(p.content,p.article)}${p.last_error ? `<p role="status">${esc(p.last_error)}</p>` : ""}<div class="adv-tools">${p.state !== "posting" ? `${d.features.publications ? button(p.state === "active" ? "Editar" : "Reprogramar", "edit", `data-id="${p.id}"`) : ""}${p.state === "active" ? button("Pausar", "pause", `data-id="${p.id}"`) : ""}${button("Archivar", "archive", `data-id="${p.id}"`)}` : "<p>Espera a que termine el envío.</p>"}</div></article>`).join("") : '<div class="card"><h3>Tu próxima publicación empieza aquí.</h3><p>Prepara un aviso, revisa su vista previa y elige cuándo publicarlo.</p></div>'}<details class="card"><summary>Historial de los últimos 50 envíos</summary>${d.runs.length ? d.runs.map((r) => `<p><strong>${esc(r.title)}</strong> · ${esc(status[r.state] || r.state)}<br>${esc(date(r.scheduled_at))}${r.message_id ? " · Mensaje " + esc(r.message_id) : ""}${r.detail ? "<br>" + esc(r.detail) : ""}</p>`).join("") : "<p>Aún no hay envíos.</p>"}</details>`,
    );
  }
  G.registerAction("automation-posts", posts);
  function edit(p) {
    if (!current() || !session.data.features.publications) {
      G.toast("Requiere Pro o Ultra.", "error");
      return;
    }
    const zone =
      p?.timezone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "America/Santiago";
    const initial = new Intl.DateTimeFormat("sv-SE", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(new Date(Date.now() + 3600000))
      .replace(" ", "T");
    session.edit = p ? { id: p.id, version: p.version } : {};
    sheet(
      p ? "Reprogramar publicación" : "Nueva publicación",
      `${button("← Publicaciones", "posts")}<form data-form="automation-preview">${field("Nombre interno", input("title", "text", p?.title || "", 'required maxlength="80"'))}${field("Texto de la publicación", `<textarea class="input" name="content" rows="6" maxlength="4000" required>${esc(p?.content || "")}</textarea>`)}<details ${p?.article ? "open" : ""}><summary>Formato de artículo</summary><label class="adv-check"><input type="checkbox" name="articleEnabled" ${p?.article ? "checked" : ""}> Enviar como artículo</label>${G.articleEditor.fields(p?.article)}</details>${field("Fecha y hora local", input("localTime", "datetime-local", p?.state === "active" ? p.local_time : initial, "required"))}${field("Zona horaria IANA", input("timezone", "text", zone, 'required maxlength="80" placeholder="America/Santiago"'))}${field(
        "Repetición",
        `<select class="input" name="recurrence">${Object.entries(recurrence)
          .map(
            ([v, t]) =>
              `<option value="${v}" ${p?.recurrence === v ? "selected" : ""}>${t}</option>`,
          )
          .join("")}</select>`,
      )}${field("ID del tema (0 = general)", input("threadId", "number", p?.thread_id || 0, 'min="0" max="2147483647" required'))}<details><summary>Botón opcional</summary>${field("Texto del botón", input("buttonLabel", "text", p?.button_label || "", 'maxlength="50"'))}${field("Enlace HTTPS", input("buttonUrl", "url", p?.button_url || "", 'maxlength="1000" placeholder="https://…"'))}</details><p>Las repeticiones mantienen la hora local. Las horas inexistentes por cambios horarios se omiten; las repetidas se envían una sola vez. Un envío incierto se detiene para revisión.</p><div class="sheet-actions"><button class="btn btn-primary" type="submit">Ver vista previa</button></div></form>`,
    );
  }
  G.registerAction("automation-new", () => edit(null));
  G.registerAction("automation-edit", (t) => {
    if (current())
      edit(session.data.posts.find((p) => p.id === Number(t.dataset.id)));
  });
  G.registerForm("automation-preview", async (f) => {
    if (!current()) return;
    const fd = new FormData(f),
      body = {
        input: {
          title: fd.get("title"),
          content: fd.get("content"),
          article: fd.has("articleEnabled") ? G.articleEditor.read(fd) : null,
          timezone: fd.get("timezone"),
          localTime: fd.get("localTime"),
          recurrence: fd.get("recurrence"),
          threadId: Number(fd.get("threadId")),
          buttonLabel: fd.get("buttonLabel") || "",
          buttonUrl: fd.get("buttonUrl") || "",
        },
        ...session.edit,
        operationId: crypto.randomUUID(),
      };
    const r = await post("publication", { action: "preview", ...body });
    session.pending = body;
    sheet(
      "Revisar antes de programar",
      `<span class="badge">${esc(recurrence[r.input.recurrence])}</span><h3>${esc(r.input.title)}</h3>${G.articleEditor.preview(r.input.content,r.input.article)}${r.input.buttonUrl ? `<p>Botón: ${esc(r.input.buttonLabel)}<br><span class="mono">${esc(r.input.buttonUrl)}</span></p>` : ""}<p><strong>${esc(date(r.firstRun, r.input.timezone))}</strong><br>${esc(r.input.timezone)} · ${r.input.threadId ? "Tema " + esc(r.input.threadId) : "Destino general"}</p><p>${esc(r.notice)}</p><form data-form="automation-save"><div class="sheet-actions"><button class="btn btn-primary" type="submit">Confirmar programación</button>${button("Cancelar", "posts")}</div></form>`,
    );
  });
  G.registerForm("automation-save", async () => {
    if (!current() || !session.pending) return;
    await post("publication", { action: "save", ...session.pending });
    await refresh("Publicación programada.");
  });
  G.registerAction("automation-pause", async (t) => {
    if (!current()) return;
    const p = session.data.posts.find((p) => p.id === Number(t.dataset.id));
    if (p) {
      await post("publication", {
        action: "pause",
        id: p.id,
        version: p.version,
      });
      await refresh("Programación pausada.");
    }
  });
  G.registerAction("automation-archive", (t) => {
    if (!current()) return;
    const p = session.data.posts.find((p) => p.id === Number(t.dataset.id));
    if (!p) return;
    session.archive = p;
    sheet(
      "Archivar publicación",
      `<h3>${esc(p.title)}</h3><p>Dejará de publicarse. Su historial se conserva y liberarás un espacio.</p><form data-form="automation-archive"><div class="sheet-actions"><button class="btn btn-primary" type="submit">Archivar</button>${button("Cancelar", "posts")}</div></form>`,
    );
  });
  G.registerForm("automation-archive", async () => {
    if (!current() || !session.archive) return;
    const p = session.archive;
    await post("publication", {
      action: "archive",
      id: p.id,
      version: p.version,
    });
    await refresh("Publicación archivada.");
  });
  function visual() {
    if (!current()) return;
    const d = session.data,
      v = d.visual.config,
      provider = d.visual.provider;
    sheet(
      "Filtro visual NSFW",
      `${button("← Volver", "home")}<div class="card"><span class="badge">${provider.configured ? (provider.paused ? "PROVEEDOR EN PAUSA" : "PROVEEDOR CONFIGURADO") : "PROVEEDOR PENDIENTE"}</span><h3>Fotos, con control del administrador.</h3><p>OpenAI Moderation analiza posible contenido sexual. GBot envía la foto sin la URL ni el token de Telegram y guarda solo el resultado. No analiza vídeos ni identifica la edad de las personas.</p><p>${esc(d.visual.usage?.calls || 0)} de ${d.limits.photos === null ? "sin límite del plan" : esc(d.limits.photos)} análisis nuevos usados hoy (UTC). Las fotos ya analizadas reutilizan el resultado hasta siete días. Hay un límite global de capacidad.</p></div>${!d.features.visual ? "<p>Activar requiere Pro o Ultra. Siempre puedes desactivar el filtro existente.</p>" : ""}<form data-form="automation-visual"><label class="adv-check"><input type="checkbox" name="enabled" ${v.enabled ? "checked" : ""} ${!d.features.visual || !provider.configured ? "disabled" : ""}>Activar en este grupo</label>${field("Acción al superar el umbral", `<select class="input" name="mode"><option value="review" ${v.mode === "review" ? "selected" : ""}>Registrar para revisión</option><option value="delete" ${v.mode === "delete" ? "selected" : ""}>Eliminar la foto</option></select>`)}${field("Umbral (0,70 a 0,99)", input("threshold", "number", v.threshold, 'min="0.7" max="0.99" step="0.01" required'))}<label class="adv-check"><input type="checkbox" name="consent" ${v.consent ? "checked" : ""}>Autorizo enviar las fotos de este grupo a OpenAI para moderación.</label><p>Empieza en revisión para ajustar el umbral. El filtro nunca banea usuarios. El filtro respeta las excepciones de moderación configuradas. Si el servicio falla o no hay cuota, conserva el mensaje y registra el motivo.</p><div class="sheet-actions"><button class="btn btn-primary" type="submit">Guardar filtro</button></div></form><details class="card" open><summary>Últimas revisiones y resultados (máximo 50)</summary>${d.visual.jobs.length ? d.visual.jobs.map((j) => `<article class="automation-result"><strong>${esc(status[j.state] || j.state)}</strong> · Mensaje ${esc(j.message_id)}${j.score !== null ? " · Puntuación " + esc(Number(j.score).toFixed(2)) : ""}<p>${esc(j.detail || "En espera del análisis.")}</p>${["review", "unavailable"].includes(j.state) ? button("Marcar como revisado", "review", `data-id="${j.id}"`) : ""}</article>`).join("") : "<p>No hay fotos analizadas. El filtro no revisa mensajes antiguos.</p>"}</details>`,
    );
  }
  G.registerAction("automation-visual", visual);
  G.registerForm("automation-visual", async (f) => {
    if (!current()) return;
    const fd = new FormData(f);
    await post("visual", {
      settings: {
        enabled: fd.has("enabled"),
        mode: fd.get("mode"),
        threshold: Number(fd.get("threshold")),
        consent: fd.has("consent"),
      },
      version: session.data.visual.config.version,
    });
    await refresh("Filtro actualizado.");
  });
  G.registerAction("automation-review", async (t) => {
    await post("visual/review", { id: Number(t.dataset.id) });
    await refresh("Resultado marcado como revisado.");
  });
  const originalRender = G.renderSettings;
  G.renderSettings = function () {
    originalRender();
    const main = document.getElementById("main");
    if (main && G.state.bootstrap)
      main.insertAdjacentHTML(
        "afterbegin",
        `<section class="section"><div class="card"><span class="badge">NUEVO · PRO Y ULTRA</span><h3>Publica a tu hora. Revisa las fotos.</h3><p>Publicaciones recurrentes y filtro visual, con ajustes independientes para cada grupo.</p>${button("Publicaciones y filtro visual", "open")}</div></section>`,
      );
  };
  if (G.DEMO) {
    const original = G.demoRequest,
      records = new Map();
    G.demoRequest = async (path, options = {}) => {
      const url = new URL(path, location.origin);
      if (!url.pathname.startsWith("/api/automations"))
        return original(path, options);
      const b = options.body ? JSON.parse(options.body) : {},
        chatId = Number(url.searchParams.get("chat_id") || b.chatId);
      await G.delay(100);
      if (!records.has(chatId))
        records.set(chatId, {
          posts: [],
          runs: [],
          tier: "ultra",
          features: { publications: true, visual: true },
          limits: { posts: 100, photos: 300 },
          visual: {
            config: {
              enabled: false,
              mode: "review",
              threshold: 0.9,
              consent: false,
              version: 0,
            },
            provider: { configured: true, paused: false },
            usage: { calls: 0 },
            jobs: [],
          },
        });
      const d = records.get(chatId);
      if ((options.method || "GET") === "GET")
        return structuredClone({ ok: true, ...d });
      if (url.pathname.endsWith("/publication")) {
        if (b.action === "preview")
          return {
            ok: true,
            input: b.input,
            firstRun: new Date(b.input.localTime).toISOString(),
            notice: "Vista previa de ejemplo. No se enviarán mensajes reales.",
          };
        if (b.action === "save") {
          const p = d.posts.find((p) => p.id === b.id);
          if (p && p.version !== b.version)
            throw new Error("La programación cambió. Recarga.");
          const row = {
            id: p?.id || Date.now(),
            ...b.input,
            local_time: b.input.localTime,
            thread_id: b.input.threadId,
            button_label: b.input.buttonLabel,
            button_url: b.input.buttonUrl,
            next_run_at: new Date(b.input.localTime).toISOString(),
            version: (p?.version || 0) + 1,
            state: "active",
          };
          d.posts = d.posts.filter((p) => p.id !== row.id);
          d.posts.push(row);
        } else {
          const p = d.posts.find((p) => p.id === b.id);
          if (p) {
            if (b.action === "archive")
              d.posts = d.posts.filter((x) => x !== p);
            else {
              p.state = "paused";
              p.version++;
            }
          }
        }
      } else if (url.pathname.endsWith("/visual")) {
        if (b.settings.enabled && !b.settings.consent)
          throw new Error("Confirma la autorización antes de activar.");
        d.visual.config = {
          ...b.settings,
          version: d.visual.config.version + 1,
        };
      } else if (url.pathname.endsWith("/review")) {
        const j = d.visual.jobs.find((j) => j.id === b.id);
        if (j) j.state = "reviewed";
      }
      return { ok: true, demo: true };
    };
  }
})();
