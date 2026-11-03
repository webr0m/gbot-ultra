/* ============================================================
   GBot Ultra · Ajustes, protección y contenido
   ============================================================ */

(() => {
  "use strict";

  const G = window.GBot;
  if (!G) return;
  const state = G.state;

  const TOGGLES = [
    {
      key: "welcome",
      section: "welcome",
      prop: "enabled",
      label: "Bienvenida",
      desc: "Saluda a los nuevos miembros con un mensaje personalizado.",
      icon: "i-send",
      premium: false,
    },
    {
      key: "goodbye",
      section: "goodbye",
      prop: "enabled",
      label: "Despedida",
      desc: "Avisa al grupo cuando alguien se marcha.",
      icon: "i-log-out",
      premium: false,
    },
    {
      key: "captcha",
      section: "captcha",
      prop: "enabled",
      label: "Captcha",
      desc: "Verifica que los nuevos miembros son personas reales.",
      icon: "i-shield",
      premium: false,
    },
    {
      key: "antilink",
      section: "antilink",
      prop: "enabled",
      label: "Antienlaces",
      desc: "Borra enlaces no permitidos y aplica la acción configurada.",
      icon: "i-link",
      premium: false,
    },
    {
      key: "antiflood",
      section: "antiflood",
      prop: "enabled",
      label: "Antiflood",
      desc: "Detecta ráfagas de mensajes y silencia automáticamente.",
      icon: "i-zap",
      premium: false,
    },
    {
      key: "blacklist",
      section: "blacklist",
      prop: "enabled",
      label: "Lista negra",
      desc: "Bloquea palabras y expresiones prohibidas en el grupo.",
      icon: "i-ban",
      premium: false,
    },
    {
      key: "warnings",
      section: "warnings",
      prop: "enabled",
      label: "Advertencias",
      desc: "Acumula avisos y aplica un castigo al alcanzar el límite.",
      icon: "i-alert-triangle",
      premium: false,
    },
    {
      key: "reports",
      section: "reports",
      prop: "enabled",
      label: "Reportes",
      desc: "Permite a los miembros avisar a los administradores.",
      icon: "i-message-circle",
      premium: false,
    },
    {
      key: "deleteJoins",
      section: "serviceMessages",
      prop: "deleteJoins",
      label: "Borrar mensajes de unión",
      desc: "Limpia del chat los avisos de entrada y salida.",
      icon: "i-trash",
      premium: false,
    },
    {
      key: "logs",
      section: "logs",
      prop: "enabled",
      label: "Canal de registros",
      desc: "Envía toda la moderación a un canal privado de Telegram.",
      icon: "i-clipboard",
      premium: true,
    },
    {
      key: "autoApprove",
      section: "joinRequests",
      prop: "autoApprove",
      label: "Aprobar solicitudes",
      desc: "Acepta automáticamente las solicitudes de entrada al grupo.",
      icon: "i-user-check",
      premium: true,
    },
  ];

  const SETTING_PANELS = [
    {
      key: "welcome",
      label: "Mensaje de bienvenida",
      desc: "Texto, autoeliminación y multimedia",
      icon: "i-send",
    },
    {
      key: "goodbye",
      label: "Mensaje de despedida",
      desc: "Texto que se envía al salir un miembro",
      icon: "i-log-out",
    },
    {
      key: "rules",
      label: "Normas del grupo",
      desc: "Reglas que se muestran con /rules",
      icon: "i-info",
    },
    {
      key: "captcha",
      label: "Configuración del captcha",
      desc: "Modo de verificación y tiempo límite",
      icon: "i-shield",
    },
    {
      key: "antilink",
      label: "Antienlaces",
      desc: "Acción, duración y lista blanca",
      icon: "i-link",
    },
    {
      key: "antiflood",
      label: "Antiflood",
      desc: "Límite de mensajes y castigo",
      icon: "i-zap",
    },
    {
      key: "warnings",
      label: "Advertencias",
      desc: "Límite y acción al alcanzarlo",
      icon: "i-alert-triangle",
    },
    {
      key: "blacklistSettings",
      label: "Acción de la lista negra",
      desc: "Qué hacer al detectar una palabra prohibida",
      icon: "i-ban",
    },
    {
      key: "logs",
      label: "Canal de registros",
      desc: "ID del canal privado de moderación",
      icon: "i-clipboard",
      premium: true,
    },
  ];

  function main() {
    return document.getElementById("main");
  }

  function isPremium() {
    return Boolean(state.bootstrap && (state.bootstrap.chat.premium.active || state.bootstrap.access?.owner));
  }

  function settings() {
    return state.settings || (state.bootstrap && state.bootstrap.settings) || null;
  }

  function getToggleValue(def) {
    const s = settings();
    if (!s || !s[def.section]) return false;
    return Boolean(s[def.section][def.prop]);
  }

  function durationLabel(seconds) {
    if (!seconds) return "Permanente";
    return G.fmtDuration(seconds);
  }

  function actionLabel(action) {
    return (
      {
        delete: "Borrar mensaje",
        warn: "Advertir",
        mute: "Silenciar",
        ban: "Banear",
        kick: "Expulsar",
      }[action] || action || "—"
    );
  }

  function durationOptions(selected, withPermanent) {
    const values = [
      [60, "1 minuto"],
      [300, "5 minutos"],
      [600, "10 minutos"],
      [1800, "30 minutos"],
      [3600, "1 hora"],
      [21600, "6 horas"],
      [86400, "24 horas"],
      [604800, "7 días"],
      [2592000, "30 días"],
    ];
    if (withPermanent) values.push([0, "Permanente"]);
    return values
      .map(
        (item) =>
          '<option value="' +
          item[0] +
          '"' +
          (Number(selected) === item[0] ? " selected" : "") +
          ">" +
          item[1] +
          "</option>",
      )
      .join("");
  }

  function field(label, control, hint) {
    return (
      '<label class="field"><span class="field-label">' +
      G.esc(label) +
      "</span>" +
      control +
      (hint ? '<span class="hint">' + G.esc(hint) + "</span>" : "") +
      "</label>"
    );
  }

  function selectField(label, name, options, selected, hint) {
    return field(
      label,
      '<select class="select" name="' +
        name +
        '">' +
        options
          .map(
            (item) =>
              '<option value="' +
              G.esc(item[0]) +
              '"' +
              (String(selected) === String(item[0]) ? " selected" : "") +
              ">" +
              G.esc(item[1]) +
              "</option>",
          )
          .join("") +
        "</select>",
      hint,
    );
  }

  function sheetForm(kind, body, submitLabel) {
    return (
      '<form data-form="settings" data-setting="' +
      kind +
      '"><div class="settings-grid">' +
      body +
      '</div><div class="sheet-actions"><button class="btn btn-secondary" type="button" data-action="close-sheet">Cancelar</button>' +
      '<button class="btn btn-primary" type="submit">' +
      G.icon("i-check") +
      " " +
      G.esc(submitLabel || "Guardar cambios") +
      "</button></div></form>"
    );
  }

  function previewText(text, fallback) {
    const clean = String(text || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return fallback || "Sin configurar";
    return clean.length > 74 ? clean.slice(0, 74) + "…" : clean;
  }

  function planBanner() {
    const premium = state.bootstrap.chat.premium;
    if (premium.active) {
      return (
        '<div class="card settings-card" style="margin-bottom:12px">' +
        '<div class="row-between wrap"><div class="row"><span class="toggle-icon" style="color:var(--warning)">' +
        G.icon("i-crown") +
        '</span><div><div class="settings-card-title">Plan activo</div>' +
        '<div class="settings-card-desc" style="margin:0">' +
        (state.bootstrap.access?.owner?'Configuración':premium.until?G.esc(premium.daysLeft)+' días restantes':'Pro permanente') +
        '</div></div></div>' +
        '<button class="btn btn-secondary btn-sm" type="button" data-action="tab" data-tab="premium">Gestionar</button></div></div>'
      );
    }
    return (
      '<div class="card settings-card" style="margin-bottom:12px;border-color:rgba(251,191,36,.3)">' +
      '<div class="row-between wrap"><div class="row"><span class="toggle-icon" style="color:var(--warning)">' +
      G.icon("i-crown") +
      '</span><div><div class="settings-card-title">Plan gratuito</div>' +
      '<div class="settings-card-desc" style="margin:0">Desbloquea logs, captcha matemático, multimedia y 5.000 acciones al día.</div></div></div>' +
      '<button class="btn btn-warning btn-sm" type="button" data-action="tab" data-tab="premium">' +
      G.icon("i-crown") +
      " Ver Premium</button></div></div>"
    );
  }

  function toggleRow(def) {
    const checked = getToggleValue(def);
    const locked = def.premium && !isPremium();
    return (
      '<div class="toggle-row">' +
      '<span class="toggle-icon"' +
      (locked ? ' style="color:var(--warning)"' : "") +
      ">" +
      G.icon(locked ? "i-crown" : def.icon) +
      "</span>" +
      '<div class="toggle-info"><div class="toggle-title">' +
      G.esc(def.label) +
      (locked ? '<span class="badge badge-premium">Premium</span>' : "") +
      '</div><div class="toggle-desc">' +
      G.esc(def.desc) +
      "</div></div>" +
      '<button class="switch" type="button" role="switch" aria-checked="' +
      (checked ? "true" : "false") +
      '" aria-label="' +
      G.esc(def.label) +
      '" data-action="toggle-setting" data-key="' +
      def.key +
      '"></button></div>'
    );
  }

  function panelRow(panel) {
    const s = settings();
    let desc = panel.desc;
    if (panel.key === "welcome") {
      desc =
        (s.welcome.enabled ? "Activada" : "Desactivada") +
        " · " +
        previewText(s.welcome.text, "Sin texto");
    } else if (panel.key === "goodbye") {
      desc =
        (s.goodbye.enabled ? "Activada" : "Desactivada") +
        " · " +
        previewText(s.goodbye.text, "Sin texto");
    } else if (panel.key === "rules") {
      desc = s.rules.text ? previewText(s.rules.text) : "Sin normas configuradas";
    } else if (panel.key === "captcha") {
      desc =
        (s.captcha.mode === "math" ? "Matemático" : "Botón") +
        " · " +
        G.fmtDuration(s.captcha.timeoutSeconds) +
        " para verificar";
    } else if (panel.key === "antilink") {
      desc =
        actionLabel(s.antilink.action) +
        " · " +
        durationLabel(s.antilink.muteSeconds) +
        " · " +
        (s.antilink.whitelist.length
          ? s.antilink.whitelist.length + " dominios permitidos"
          : "Sin lista blanca");
    } else if (panel.key === "antiflood") {
      desc =
        s.antiflood.limit +
        " mensajes / " +
        s.antiflood.windowSeconds +
        " s · " +
        durationLabel(s.antiflood.muteSeconds);
    } else if (panel.key === "warnings") {
      desc =
        "Límite " +
        s.warnings.limit +
        " · " +
        actionLabel(s.warnings.action) +
        " · " +
        durationLabel(s.warnings.muteSeconds);
    } else if (panel.key === "blacklistSettings") {
      desc = actionLabel(s.blacklist.action);
    } else if (panel.key === "logs") {
      desc = s.logs.chatId
        ? "Canal " + s.logs.chatId + (s.logs.enabled ? " · activo" : " · desactivado")
        : "Sin canal configurado";
    }
    const locked = panel.premium && !isPremium();
    return (
      '<button class="list-item" type="button" data-action="open-setting" data-setting="' +
      panel.key +
      '">' +
      '<span class="toggle-icon"' +
      (locked ? ' style="color:var(--warning)"' : "") +
      ">" +
      G.icon(locked ? "i-crown" : panel.icon) +
      "</span>" +
      '<div class="list-item-main"><div class="list-item-title">' +
      G.esc(panel.label) +
      (locked ? '<span class="badge badge-premium">Premium</span>' : "") +
      '</div><div class="list-item-sub">' +
      G.esc(desc) +
      "</div></div>" +
      '<span class="list-item-side">' +
      G.icon("i-chevron-right") +
      "</span></button>"
    );
  }

  function contentCount(kind) {
    const c = state.content;
    if (!c) return { used: 0, limit: 0 };
    if (kind === "command") return c.limits.commands;
    if (kind === "note") return c.limits.notes;
    return c.limits.blacklist;
  }

  function contentRow(kind, label, desc, icon) {
    const count = contentCount(kind);
    const locked = !state.content;
    return (
      '<button class="list-item" type="button" data-action="open-content" data-kind="' +
      kind +
      '"' +
      (locked ? " disabled" : "") +
      ">" +
      '<span class="toggle-icon">' +
      G.icon(icon) +
      "</span>" +
      '<div class="list-item-main"><div class="list-item-title">' +
      G.esc(label) +
      '</div><div class="list-item-sub">' +
      G.esc(desc) +
      "</div></div>" +
      '<span class="list-item-side"><span class="badge badge-muted">' +
      (state.content ? G.fmtInt(count.used) + " / " + G.fmtInt(count.limit) : "…") +
      "</span>" +
      G.icon("i-chevron-right") +
      "</span></button>"
    );
  }

  G.renderSettings = function renderSettings() {
    const box = main();
    const s = settings();
    if (!box || !s || !state.bootstrap) return;
    const premium = isPremium();
    const content = state.content;

    const currentLang = (s.language || "es");
    const langName = (G.LANGUAGES.find((l) => l.code === currentLang) || G.LANGUAGES[0]).name;
    const langFlag = (G.LANGUAGES.find((l) => l.code === currentLang) || G.LANGUAGES[0]).flag;
    box.innerHTML =
      planBanner() +
      '<section class="section"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-settings") +
      ' Idioma</div><div class="section-subtitle">Idioma del grupo y del panel</div></div></div>' +
      '<div class="card"><div class="row-between wrap"><div><div class="settings-card-title">' +
      langFlag +
      " " +
      G.esc(langName) +
      '</div><div class="settings-card-desc" style="margin:0">Traduce el panel y las respuestas del bot. Los textos personalizados se conservan.</div></div>' +
      '<button class="btn btn-secondary btn-sm" type="button" data-action="change-language">' +
      G.icon("i-settings") +
      " Cambiar idioma</button></div></div></section>" +
      '<section class="section"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-zap") +
      ' Funciones</div><div class="section-subtitle">Moderación automática y avisos del grupo</div></div></div>' +
      '<div class="card settings-card"><div class="toggle-list">' +
      TOGGLES.map(toggleRow).join("") +
      "</div></div></section>" +
      '<section class="section"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-settings") +
      ' Personalización</div><div class="section-subtitle">Mensajes, normas y protección</div></div></div>' +
      '<div class="card card-flush" style="padding:6px 8px"><div class="list">' +
      SETTING_PANELS.map(panelRow).join("") +
      "</div></div></section>" +
      '<section class="section"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-hash") +
      ' Contenido</div><div class="section-subtitle">Comandos, notas y palabras bloqueadas</div></div>' +
      (content
        ? '<button class="section-action" type="button" data-action="refresh-content">Actualizar</button>'
        : "") +
      "</div>" +
      '<div class="card card-flush" style="padding:6px 8px"><div class="list">' +
      contentRow("command", "Comandos personalizados", "Responde con /comando en el grupo", "i-hash") +
      contentRow("note", "Notas guardadas", "Contenido reutilizable con #nota", "i-message-circle") +
      contentRow("blacklist", "Lista negra", "Palabras y expresiones prohibidas", "i-ban") +
      "</div></div></section>" +
      '<section class="section"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-info") +
      ' Información</div><div class="section-subtitle">Detalles técnicos del grupo</div></div></div>' +
      '<div class="card"><div class="list">' +
      '<div class="list-item"><span class="toggle-icon">' +
      G.icon("i-hash") +
      '</span><div class="list-item-main"><div class="list-item-title">ID del grupo</div><div class="list-item-sub mono">' +
      G.esc(state.bootstrap.chat.id) +
      "</div></div></div>" +
      '<div class="list-item"><span class="toggle-icon">' +
      G.icon("i-users") +
      '</span><div class="list-item-main"><div class="list-item-title">Miembros rastreados</div><div class="list-item-sub">' +
      G.fmtInt(state.bootstrap.chat.trackedMembers) +
      " de " +
      G.fmtInt(state.bootstrap.chat.memberCount) +
      "</div></div></div>" +
      '<div class="list-item"><span class="toggle-icon">' +
      G.icon("i-key") +
      '</span><div class="list-item-main"><div class="list-item-title">Idioma</div><div class="list-item-sub">Español</div></div></div>' +
      '<div class="list-item"><span class="toggle-icon">' +
      G.icon("i-crown") +
      '</span><div class="list-item-main"><div class="list-item-title">Plan actual</div><div class="list-item-sub">' +
      (state.bootstrap.access?.owner?'Cuenta':premium ? (state.bootstrap.chat.premium.until?"Premium · " + G.esc(state.bootstrap.chat.premium.daysLeft) + " días":'Pro permanente') : "Gratuito") +
      "</div></div></div></div></div></section>" +
      '<section class="section"><div class="card"><div class="row-between wrap"><div><div class="settings-card-title">' +
      G.icon("i-send") +
      ' Gestionar desde Telegram</div><div class="settings-card-desc" style="margin:0">Algunos ajustes, como la multimedia de bienvenida, se configuran desde el chat del bot.</div></div>' +
      '<button class="btn btn-secondary btn-sm" type="button" data-action="open-bot">' +
      G.icon("i-external-link") +
      " Abrir bot</button></div></div></section>";

    G.updateHeader();
  };

  G.loadContent = async function loadContent() {
    if (!state.chat) return;
    const chatId = state.chat.id;
    try {
      const data = await G.api.get(
        "/api/content?chat_id=" + encodeURIComponent(state.chat.id),
      );
      if (state.chat?.id !== chatId) return;
      state.content = data;
      if (state.tab === "settings") G.renderSettings();
    } catch (error) {
      if (state.chat?.id !== chatId) return;
      state.content = null;
      if (state.tab === "settings") G.renderSettings();
      throw error;
    }
  };

  const saves = new Map();
  async function saveSettings(patch, message) {
    const chatId = state.chat.id;
    const operation = (saves.get(chatId) || Promise.resolve()).catch(() => {}).then(() => G.api.patch("/api/settings", {
      chatId,
      patch,
    }));
    saves.set(chatId, operation);
    let result;
    try { result = await operation; }
    finally { if (saves.get(chatId) === operation) saves.delete(chatId); }
    if (state.chat?.id !== chatId) return false;
    state.settings = result.settings;
    if (state.bootstrap) state.bootstrap.settings = result.settings;
    if (state.tab === "settings") G.renderSettings();
    G.applyLanguage(result.settings.language);
    G.toast(message || "Ajustes guardados.", "success");
    return true;
  }

  async function guardedSave(patch, message) {
    try {
      return await saveSettings(patch, message);
    } catch (error) {
      if (error.status === 402) {
        G.openPremiumPrompt(
          (error.data && error.data.premiumFeature) || "Esta función",
        );
        return false;
      }
      throw error;
    }
  }

  // ------------------------------------------------------------
  //  Formularios de ajustes
  // ------------------------------------------------------------

  function openWelcome() {
    const s = settings();
    const media = s.welcome.media;
    G.openSheet({
      title: "Mensaje de bienvenida",
      subtitle: "Se envía cuando un miembro entra al grupo",
      body: sheetForm(
        "welcome",
        field(
          "Texto de bienvenida",
          '<textarea class="textarea" name="text" maxlength="2000" required>' +
            G.esc(s.welcome.text) +
            "</textarea>",
          "Variables: {mention}, {name}, {chat}, {username}, {id}",
        ) +
          selectField(
            "Autoeliminar después de",
            "deleteAfter",
            [
              [0, "No eliminar"],
              [15, "15 segundos"],
              [30, "30 segundos"],
              [60, "1 minuto"],
              [300, "5 minutos"],
              [3600, "1 hora"],
            ],
            s.welcome.deleteAfter,
            "Disponible con Premium.",
          ) +
          '<div class="field"><label class="field-label">Multimedia</label>' +
          (media
            ? '<div class="content-item" style="margin:0"><div class="content-item-main"><div class="content-item-name">' +
              G.esc(media.type) +
              '</div><div class="content-item-text">Archivo adjunto configurado</div></div>' +
              '<button class="icon-btn" type="button" data-action="clear-welcome-media" aria-label="Quitar multimedia">' +
              G.icon("i-trash") +
              "</button></div>"
            : '<div class="hint">Envía una foto, vídeo, GIF o documento al chat del bot para usarlo como bienvenida. Requiere Premium.</div>') +
          "</div>",
        "Guardar bienvenida",
      ),
    });
  }

  function openGoodbye() {
    const s = settings();
    G.openSheet({
      title: "Mensaje de despedida",
      subtitle: "Se envía cuando un miembro sale del grupo",
      body: sheetForm(
        "goodbye",
        field(
          "Texto de despedida",
          '<textarea class="textarea" name="text" maxlength="1000" required>' +
            G.esc(s.goodbye.text) +
            "</textarea>",
          "Variables: {name}, {chat}, {username}, {id}",
        ),
        "Guardar despedida",
      ),
    });
  }

  function openRules() {
    const s = settings();
    G.openSheet({
      title: "Normas del grupo",
      subtitle: "Los miembros pueden consultarlas con /rules",
      body: sheetForm(
        "rules",
        field(
          "Texto de las normas",
          '<textarea class="textarea" name="text" maxlength="4000" required>' +
            G.esc(s.rules.text) +
            "</textarea>",
          "Puedes usar formato HTML básico: <b>, <i>, <a href>.",
        ) +
          selectField(
            "Botón de normas",
            "button",
            [
              ["1", "Mostrar botón junto a la bienvenida"],
              ["0", "No mostrar botón"],
            ],
            s.rules.button ? "1" : "0",
          ),
        "Guardar normas",
      ),
    });
  }

  function openCaptcha() {
    const s = settings();
    G.openSheet({
      title: "Configuración del captcha",
      subtitle: "Verificación de nuevos miembros",
      body: sheetForm(
        "captcha",
        selectField(
          "Modo de verificación",
          "mode",
          [
            ["button", "Botón (fácil)"],
            ["math", "Operación matemática (Premium)"],
          ],
          s.captcha.mode,
          "El captcha matemático está disponible con Premium.",
        ) +
          selectField(
            "Tiempo para verificar",
            "timeoutSeconds",
            [
              [60, "1 minuto"],
              [120, "2 minutos"],
              [300, "5 minutos"],
              [600, "10 minutos"],
              [1800, "30 minutos"],
            ],
            s.captcha.timeoutSeconds,
            "Tiempo personalizado disponible con Premium.",
          ),
        "Guardar captcha",
      ),
    });
  }

  function openAntilink() {
    const s = settings();
    G.openSheet({
      title: "Antienlaces",
      subtitle: "Controla los enlaces que se comparten",
      body: sheetForm(
        "antilink",
        selectField(
          "Acción al detectar un enlace",
          "action",
          [
            ["delete", "Borrar el mensaje"],
            ["mute", "Silenciar (Premium)"],
            ["ban", "Banear (Premium)"],
          ],
          s.antilink.action,
        ) +
          selectField(
            "Duración del silencio",
            "muteSeconds",
            [
              [60, "1 minuto"],
              [300, "5 minutos"],
              [600, "10 minutos"],
              [1800, "30 minutos"],
              [3600, "1 hora"],
              [21600, "6 horas"],
              [86400, "24 horas"],
              [604800, "7 días"],
            ],
            s.antilink.muteSeconds,
            "Se aplica cuando la acción es silenciar.",
          ) +
          field(
            "Lista blanca de dominios",
            '<textarea class="textarea" name="whitelist" maxlength="4000" placeholder="telegram.org, github.com">' +
              G.esc(s.antilink.whitelist.join(", ")) +
              "</textarea>",
            "Separa los dominios con comas. Disponible con Premium.",
          ),
        "Guardar antienlaces",
      ),
    });
  }

  function openAntiflood() {
    const s = settings();
    G.openSheet({
      title: "Antiflood",
      subtitle: "Evita ráfagas de mensajes",
      body: sheetForm(
        "antiflood",
        field(
          "Máximo de mensajes",
          '<input class="input" type="number" name="limit" min="1" max="100" value="' +
            s.antiflood.limit +
            '" required />',
          "Entre 3 y 20 en el plan gratuito.",
        ) +
          field(
            "Ventana de tiempo (segundos)",
            '<input class="input" type="number" name="windowSeconds" min="1" max="300" value="' +
              s.antiflood.windowSeconds +
              '" required />',
            "Entre 5 y 60 en el plan gratuito.",
          ) +
          selectField(
            "Duración del silencio",
            "muteSeconds",
            [
              [60, "1 minuto"],
              [300, "5 minutos"],
              [600, "10 minutos"],
              [1800, "30 minutos"],
              [3600, "1 hora"],
              [21600, "6 horas"],
              [86400, "24 horas"],
            ],
            s.antiflood.muteSeconds,
          ),
        "Guardar antiflood",
      ),
    });
  }

  function openWarnings() {
    const s = settings();
    G.openSheet({
      title: "Advertencias",
      subtitle: "Castigo automático al acumular avisos",
      body: sheetForm(
        "warnings",
        field(
          "Número de advertencias",
          '<input class="input" type="number" name="limit" min="1" max="20" value="' +
            s.warnings.limit +
            '" required />',
        ) +
          selectField(
            "Acción al alcanzar el límite",
            "action",
            [
              ["mute", "Silenciar"],
              ["kick", "Expulsar"],
              ["ban", "Banear"],
            ],
            s.warnings.action,
          ) +
          selectField(
            "Duración del silencio",
            "muteSeconds",
            [
              [60, "1 minuto"],
              [300, "5 minutos"],
              [600, "10 minutos"],
              [1800, "30 minutos"],
              [3600, "1 hora"],
              [21600, "6 horas"],
              [86400, "24 horas"],
              [604800, "7 días"],
            ],
            s.warnings.muteSeconds,
            "Se aplica cuando la acción es silenciar.",
          ),
        "Guardar advertencias",
      ),
    });
  }

  function openBlacklistSettings() {
    const s = settings();
    G.openSheet({
      title: "Acción de la lista negra",
      subtitle: "Qué hacer al detectar una palabra prohibida",
      body: sheetForm(
        "blacklistSettings",
        selectField(
          "Acción",
          "action",
          [
            ["delete", "Borrar el mensaje"],
            ["warn", "Advertir al usuario"],
            ["mute", "Silenciar"],
            ["ban", "Banear"],
          ],
          s.blacklist.action,
        ),
        "Guardar acción",
      ),
    });
  }

  function openLogs() {
    if (!isPremium()) {
      G.openPremiumPrompt("El canal de registros");
      return;
    }
    const s = settings();
    G.openSheet({
      title: "Canal de registros",
      subtitle: "Recibe todas las acciones de moderación",
      body: sheetForm(
        "logs",
        field(
          "ID del canal",
          '<input class="input" type="number" name="chatId" placeholder="-1001234567890" value="' +
            (s.logs.chatId == null ? "" : s.logs.chatId) +
            '" />',
          "Añade el bot al canal como administrador y pega aquí su ID (empieza por -100).",
        ) +
          selectField(
            "Estado",
            "enabled",
            [
              ["1", "Activo"],
              ["0", "Desactivado"],
            ],
            s.logs.enabled ? "1" : "0",
          ),
        "Guardar canal",
      ),
    });
  }

  // ------------------------------------------------------------
  //  Gestor de contenido
  // ------------------------------------------------------------

  const CONTENT_META = {
    command: {
      label: "Comandos personalizados",
      singular: "comando",
      icon: "i-hash",
      empty: "Sin comandos",
      hint: "Se activan escribiendo /nombre en el grupo.",
    },
    note: {
      label: "Notas guardadas",
      singular: "nota",
      icon: "i-message-circle",
      empty: "Sin notas",
      hint: "Se muestran escribiendo #nombre en el grupo.",
    },
    blacklist: {
      label: "Lista negra",
      singular: "patrón",
      icon: "i-ban",
      empty: "Sin patrones bloqueados",
      hint: "Los mensajes que coincidan se moderan automáticamente.",
    },
  };

  function contentItems(kind) {
    const c = state.content;
    if (!c) return [];
    if (kind === "command") return c.commands || [];
    if (kind === "note") return c.notes || [];
    return c.blacklist || [];
  }

  G.openContentManager = async function openContentManager(kind) {
    const chatId = state.chat.id;
    const meta = CONTENT_META[kind];
    if (!meta) return;
    if (!state.content) {
      try {
        await G.loadContent();
      } catch (error) {
        G.toast(error.message || "No se pudo cargar el contenido.", "error");
        return;
      }
    }
    if (state.chat?.id !== chatId) return;
    const items = contentItems(kind);
    const count = contentCount(kind);
    const atLimit = count.limit > 0 && count.used >= count.limit;
    let listHtml;
    if (!items.length) {
      listHtml = G.empty(meta.icon, meta.empty, meta.hint);
    } else if (kind === "blacklist") {
      listHtml = items
        .map(
          (item) =>
            '<div class="content-item"><div class="content-item-main"><div class="content-item-name">' +
            G.esc(item.pattern) +
            '</div><div class="content-item-text">' +
            (item.is_regex ? "Expresión regular" : "Texto literal") +
            "</div></div>" +
            '<button class="icon-btn" type="button" data-action="content-edit" data-kind="blacklist" data-name="' +
            G.esc(item.pattern) +
            '" aria-label="Editar">' +
            G.icon("i-edit") +
            "</button>" +
            '<button class="icon-btn" type="button" data-action="content-delete" data-kind="blacklist" data-name="' +
            G.esc(item.pattern) +
            '" aria-label="Eliminar">' +
            G.icon("i-trash") +
            "</button></div>",
        )
        .join("");
    } else {
      listHtml = items
        .map(
          (item) =>
            '<div class="content-item"><div class="content-item-main"><div class="content-item-name">/' +
            G.esc(item.name) +
            '</div><div class="content-item-text">' +
            G.esc(item.content) +
            '</div><div class="content-item-text">' +
            G.fmtInt(item.uses || 0) +
            " usos</div></div>" +
            '<button class="icon-btn" type="button" data-action="content-edit" data-kind="' +
            kind +
            '" data-name="' +
            G.esc(item.name) +
            '" aria-label="Editar">' +
            G.icon("i-edit") +
            "</button>" +
            '<button class="icon-btn" type="button" data-action="content-delete" data-kind="' +
            kind +
            '" data-name="' +
            G.esc(item.name) +
            '" aria-label="Eliminar">' +
            G.icon("i-trash") +
            "</button></div>",
        )
        .join("");
    }

    G.openSheet({
      title: meta.label,
      subtitle:
        G.fmtInt(count.used) +
        " de " +
        G.fmtInt(count.limit) +
        " · " +
        meta.hint,
      body:
        '<div class="content-group"><div class="content-group-head"><div class="content-group-title">' +
        G.icon(meta.icon) +
        " " +
        G.esc(meta.label) +
        '</div><button class="btn btn-primary btn-sm" type="button" data-action="content-add" data-kind="' +
        kind +
        '"' +
        (atLimit ? " disabled" : "") +
        ">" +
        G.icon("i-plus") +
        " Añadir</button></div>" +
        (atLimit
          ? '<div class="hint" style="margin-bottom:8px">Has alcanzado el límite de tu plan. ' +
            (isPremium() ? "" : "Mejora a Premium para ampliarlo.") +
            "</div>"
          : "") +
        listHtml +
        "</div>" +
        '<div class="sheet-actions"><button class="btn btn-secondary btn-block" type="button" data-action="close-sheet">Cerrar</button></div>',
    });
  };

  function openContentForm(kind, name) {
    const meta = CONTENT_META[kind];
    if (!meta) return;
    const editing = Boolean(name);
    const item = editing
      ? contentItems(kind).find((row) =>
          kind === "blacklist" ? row.pattern === name : row.name === name,
        )
      : null;
    if (editing && !item) {
      G.toast("No se encontró el elemento.", "error");
      return;
    }

    let body;
    if (kind === "blacklist") {
      body =
        field(
          "Patrón a bloquear",
          '<input class="input" name="pattern" maxlength="200" value="' +
            G.esc(item ? item.pattern : "") +
            '" placeholder="spam o (?:free|gratis)[ _-]?btc" required ' +
            (editing ? "readonly" : "") +
            " />",
          "Puede ser texto literal o una expresión regular.",
        ) +
        selectField(
          "Tipo de patrón",
          "isRegex",
          [
            ["0", "Texto literal"],
            ["1", "Expresión regular"],
          ],
          item && item.is_regex ? "1" : "0",
        );
    } else {
      body =
        field(
          "Nombre",
          '<input class="input" name="name" maxlength="32" value="' +
            G.esc(item ? item.name : "") +
            '" placeholder="' +
            (kind === "command" ? "reglas" : "bienvenida") +
            '" pattern="[A-Za-z0-9_]+" required ' +
            (editing ? "readonly" : "") +
            " />",
          "Solo letras, números y guiones bajos.",
        ) +
        field(
          "Contenido",
          '<textarea class="textarea" name="content" maxlength="2000" required placeholder="Escribe la respuesta…">' +
            G.esc(item ? item.content : "") +
            "</textarea>",
          kind === "command"
            ? "Se enviará al escribir /" + (item ? item.name : "nombre") + "."
            : "Se enviará al escribir #" + (item ? item.name : "nombre") + ".",
        );
    }

    G.openSheet({
      title: (editing ? "Editar " : "Nuevo ") + meta.singular,
      subtitle: editing ? "Los cambios se aplican al instante" : meta.hint,
      body: sheetForm(
        "content-" + kind,
        body +
          '<input type="hidden" name="editing" value="' +
          (editing ? "1" : "0") +
          '" />',
        editing ? "Guardar cambios" : "Crear " + meta.singular,
      ),
    });
  }

  async function submitContent(form) {
    const kind = form.dataset.setting.replace("content-", "");
    const data = new FormData(form);
    const body = { chatId: state.chat.id };
    if (kind === "blacklist") {
      body.pattern = String(data.get("pattern") || "").trim();
      body.isRegex = String(data.get("isRegex") || "0") === "1";
      await G.api.post("/api/content/blacklist", body);
    } else {
      body.name = String(data.get("name") || "").trim();
      body.content = String(data.get("content") || "").trim();
      await G.api.post("/api/content/" + kind, body);
    }
    if (state.chat?.id !== body.chatId) return;
    G.closeSheet();
    state.content = null;
    await G.loadContent();
    G.toast(
      (kind === "command" ? "Comando" : kind === "note" ? "Nota" : "Patrón") +
        " guardado correctamente.",
      "success",
    );
    await G.openContentManager(kind);
  }

  async function deleteContent(kind, name) {
    const chatId = state.chat.id;
    const meta = CONTENT_META[kind];
    G.openConfirm({
      title: "Eliminar " + meta.singular,
      heading: "¿Eliminar «" + name + "»?",
      text: "Se borrará de forma permanente. Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      icon: "i-trash",
      tone: "danger",
      onConfirm: async () => {
        const body = { chatId };
        if (kind === "blacklist") body.pattern = name;
        else body.name = name;
        await G.api.del("/api/content/" + kind, body);
        if (state.chat?.id !== chatId) return;
        G.closeSheet();
        state.content = null;
        await G.loadContent();
        G.toast("Eliminado correctamente.", "success");
        await G.openContentManager(kind);
      },
    });
  }

  // ------------------------------------------------------------
  //  Envío de formularios
  // ------------------------------------------------------------

  async function submitSettings(form) {
    const kind = form.dataset.setting;
    const data = new FormData(form);
    const premium = isPremium();

    if (kind === "welcome") {
      const deleteAfter = Number(data.get("deleteAfter") || 0);
      if (deleteAfter > 0 && !premium) {
        G.openPremiumPrompt("Autoeliminar la bienvenida");
        return;
      }
      if (await guardedSave({ welcome: { text: String(data.get("text") || "").trim(), deleteAfter } }, "Bienvenida guardada.")) {
        G.closeSheet();
      }
      return;
    }

    if (kind === "goodbye") {
      if (await guardedSave({ goodbye: { text: String(data.get("text") || "").trim() } }, "Despedida guardada.")) {
        G.closeSheet();
      }
      return;
    }

    if (kind === "rules") {
      if (
        await guardedSave(
          {
            rules: {
              text: String(data.get("text") || "").trim(),
              button: String(data.get("button") || "1") === "1",
            },
          },
          "Normas guardadas.",
        )
      ) {
        G.closeSheet();
      }
      return;
    }

    if (kind === "captcha") {
      const mode = String(data.get("mode") || "button");
      if (mode === "math" && !premium) {
        G.openPremiumPrompt("Captcha matemático");
        return;
      }
      if (
        await guardedSave(
          {
            captcha: {
              mode,
              timeoutSeconds: Number(data.get("timeoutSeconds") || 300),
            },
          },
          "Captcha guardado.",
        )
      ) {
        G.closeSheet();
      }
      return;
    }

    if (kind === "antilink") {
      const whitelist = String(data.get("whitelist") || "")
        .split(/[\s,;]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      const action = String(data.get("action") || "delete");
      if ((action !== "delete" || whitelist.length) && !premium) {
        G.openPremiumPrompt("Antienlaces avanzado");
        return;
      }
      if (
        await guardedSave(
          {
            antilink: {
              action,
              muteSeconds: Number(data.get("muteSeconds") || 600),
              whitelist,
            },
          },
          "Antienlaces guardado.",
        )
      ) {
        G.closeSheet();
      }
      return;
    }

    if (kind === "antiflood") {
      if (
        await guardedSave(
          {
            antiflood: {
              limit: Number(data.get("limit") || 8),
              windowSeconds: Number(data.get("windowSeconds") || 10),
              muteSeconds: Number(data.get("muteSeconds") || 600),
            },
          },
          "Antiflood guardado.",
        )
      ) {
        G.closeSheet();
      }
      return;
    }

    if (kind === "warnings") {
      if (
        await guardedSave(
          {
            warnings: {
              limit: Number(data.get("limit") || 3),
              action: String(data.get("action") || "mute"),
              muteSeconds: Number(data.get("muteSeconds") || 3600),
            },
          },
          "Advertencias guardadas.",
        )
      ) {
        G.closeSheet();
      }
      return;
    }

    if (kind === "blacklistSettings") {
      if (
        await guardedSave(
          { blacklist: { action: String(data.get("action") || "warn") } },
          "Acción de la lista negra guardada.",
        )
      ) {
        G.closeSheet();
      }
      return;
    }

    if (kind === "logs") {
      if (!premium) {
        G.openPremiumPrompt("Canal de registros");
        return;
      }
      const raw = String(data.get("chatId") || "").trim();
      const chatId = raw ? Number(raw) : null;
      if (raw && (!Number.isFinite(chatId) || chatId >= 0)) {
        throw new Error("El ID del canal debe ser un número negativo (por ejemplo -1001234567890).");
      }
      if (
        await guardedSave(
          {
            logs: {
              chatId,
              enabled: String(data.get("enabled") || "1") === "1" && chatId != null,
            },
          },
          chatId ? "Canal de registros guardado." : "Canal de registros desactivado.",
        )
      ) {
        G.closeSheet();
      }
      return;
    }

    if (kind.startsWith("content-")) {
      await submitContent(form);
    }
  }

  // ------------------------------------------------------------
  //  Acciones
  // ------------------------------------------------------------

  G.registerAction("toggle-setting", async (target) => {
    const def = TOGGLES.find((item) => item.key === target.dataset.key);
    if (!def) return;
    if (def.premium && !isPremium()) {
      G.openPremiumPrompt(def.label);
      return;
    }
    const current = getToggleValue(def);
    const patch = {};
    patch[def.section] = {};
    patch[def.section][def.prop] = !current;
    await guardedSave(patch, def.label + (current ? " desactivado." : " activado."));
  });

  G.registerAction("open-setting", (target) => {
    const key = target.dataset.setting;
    if (key === "welcome") openWelcome();
    else if (key === "goodbye") openGoodbye();
    else if (key === "rules") openRules();
    else if (key === "captcha") openCaptcha();
    else if (key === "antilink") openAntilink();
    else if (key === "antiflood") openAntiflood();
    else if (key === "warnings") openWarnings();
    else if (key === "blacklistSettings") openBlacklistSettings();
    else if (key === "logs") openLogs();
  });

  G.registerAction("clear-welcome-media", async () => {
    if (
      await guardedSave(
        { welcome: { media: null } },
        "Multimedia de bienvenida eliminada.",
      )
    ) {
      G.closeSheet();
    }
  });

  G.registerAction("open-content", (target) => G.openContentManager(target.dataset.kind));
  G.registerAction("refresh-content", async () => {
    try {
      state.content = null;
      await G.loadContent();
      G.toast("Contenido actualizado.", "success");
    } catch (error) {
      G.toast(error.message || "No se pudo actualizar el contenido.", "error");
    }
  });
  G.registerAction("content-add", (target) => {
    const kind = target.dataset.kind;
    const count = contentCount(kind);
    if (count.limit > 0 && count.used >= count.limit) {
      G.toast("Has alcanzado el límite de tu plan.", "error");
      return;
    }
    openContentForm(kind, null);
  });
  G.registerAction("content-edit", (target) =>
    openContentForm(target.dataset.kind, target.dataset.name),
  );
  G.registerAction("content-delete", (target) =>
    deleteContent(target.dataset.kind, target.dataset.name),
  );

  G.registerAction("change-language", () => {
    const s = settings();
    const current = (s && s.language) || "es";
    const options = (G.LANGUAGES || [])
      .map(
        (lang) =>
          '<button class="list-item" type="button" data-action="set-language" data-lang="' +
          G.esc(lang.code) +
          '"><span class="toggle-icon">' +
          G.esc(lang.flag) +
          '</span><div class="list-item-main"><div class="list-item-title">' +
          G.esc(lang.name) +
          (lang.code === current ? " ✓" : "") +
          '</div><div class="list-item-sub">' +
          G.esc(lang.code) +
          "</div></div></button>",
      )
      .join("");
    G.openSheet({
      title: "Idioma",
      subtitle: "Elige el idioma del panel y de las respuestas del grupo",
      body: '<div class="list notranslate" translate="no">' + options + "</div>",
    });
  });

  let changingLanguage = false;
  G.changeLanguage = async function changeLanguage(code) {
    if (changingLanguage || !settings() || !G.LANGUAGES.some((lang) => lang.code === code)) return;
    changingLanguage = true;
    try {
      if (await guardedSave({ language: code }, "Idioma actualizado.")) G.closeSheet();
    } finally {
      changingLanguage = false;
    }
  };

  G.registerAction("set-language", (target) => {
    return G.changeLanguage(target.dataset.lang);
  });

  G.registerForm("settings", (form) => submitSettings(form));
})();
