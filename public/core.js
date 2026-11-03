/* ============================================================
   GBot Ultra · Mini App
   Núcleo: estado, utilidades, API, navegación y hojas.
   ============================================================ */

(() => {
  "use strict";

  const G = (window.GBot = window.GBot || {});
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const params = new URLSearchParams(window.location.search);

  G.tg = tg;
  G.params = params;
  G.DEMO = params.get("demo") === "1";
  G.BOT_USERNAME = "GroupButlerEsp_bot";
  G.BOT_URL = "https://t.me/GroupButlerEsp_bot";
  G.SUPPORT_URL = "https://t.me/webrom_bot";

  G.state = {
    demo: G.DEMO,
    initData: tg && tg.initData ? tg.initData.trim() : "",
    themeOverride: (function () {
      try {
        return localStorage.getItem("gbot-theme");
      } catch {
        return null;
      }
    })(),
    tab: "home",
    chats: [],
    chat: null,
    bootstrap: null,
    settings: null,
    content: null,
    premium: null,
    chartDays: 14,
    members: {
      items: [],
      total: 0,
      tracked: 0,
      liveAdmins: 0,
      query: "",
      filter: "all",
      loading: false,
      loaded: false,
      hasMore: false,
      offset: 0,
      focusSearch: false,
    },
    logs: {
      items: [],
      total: 0,
      action: "",
      loading: false,
      loaded: false,
      hasMore: false,
      offset: 0,
    },
    sheetOpen: false,
    confirm: null,
    toastTimer: null,
    backAttached: false,
    themeBound: false,
    bootstrapRequestId: 0,
    sheetChatId: null,
    lastUpdated: null,
  };

  const state = G.state;

  G.actions = {};
  G.forms = {};
  G.inputs = {};

  // ------------------------------------------------------------
  //  Utilidades
  // ------------------------------------------------------------

  G.esc = function esc(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  };

  G.escAttr = G.esc;

  G.icon = function icon(name, extraClass) {
    return (
      '<svg class="icon ' +
      (extraClass || "") +
      '" aria-hidden="true"><use href="#' +
      G.esc(name) +
      '"></use></svg>'
    );
  };

  G.delay = function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  G.fmtInt = function fmtInt(value) {
    const number = Number(value || 0);
    try {
      return new Intl.NumberFormat("es-ES").format(number);
    } catch {
      return String(number);
    }
  };

  G.fmtDate = function fmtDate(value) {
    if (!value) return "—";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  };

  G.fmtDateTime = function fmtDateTime(value) {
    if (!value) return "—";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("es-ES", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  G.fmtDuration = function fmtDuration(seconds) {
    if (seconds == null || seconds === "") return "";
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return "Permanente";
    if (value < 60) return value + " s";
    if (value < 3600) return Math.round(value / 60) + " min";
    if (value < 86400) return Math.round(value / 3600) + " h";
    return Math.round(value / 86400) + " d";
  };

  G.initials = function initials(name) {
    const clean = String(name || "?").trim();
    if (!clean) return "?";
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  };

  G.avatarGradient = function avatarGradient(id) {
    const gradients = [
      "linear-gradient(135deg,#4ea1ff,#8b5cf6)",
      "linear-gradient(135deg,#f97316,#ef4444)",
      "linear-gradient(135deg,#10b981,#0ea5e9)",
      "linear-gradient(135deg,#a855f7,#ec4899)",
      "linear-gradient(135deg,#eab308,#f97316)",
      "linear-gradient(135deg,#06b6d4,#3b82f6)",
      "linear-gradient(135deg,#84cc16,#10b981)",
      "linear-gradient(135deg,#f43f5e,#8b5cf6)",
    ];
    const numeric = Math.abs(Number(id) || 0);
    return gradients[numeric % gradients.length];
  };

  G.avatar = function avatar(member, sizeClass) {
    const name = member && (member.displayName || member.firstName || member.username) || "?";
    const id = member && member.id;
    const url = member && member.avatarUrl;
    return (
      '<span class="avatar ' +
      G.esc(sizeClass || "") +
      '" style="background:' +
      G.avatarGradient(id) +
      '">' +
      '<span class="avatar-fallback">' +
      G.esc(G.initials(name)) +
      "</span>" +
      (url
        ? '<img class="avatar-img" src="' +
          G.esc(url) +
          '" alt="" loading="lazy" data-avatar>'
        : "") +
      "</span>"
    );
  };

  G.statusBadge = function statusBadge(member) {
    if (!member) return "";
    const status = member.status || "member";
    const label = member.statusLabel || status;
    let cls = "badge-muted";
    if (status === "creator" || status === "administrator") cls = "badge-admin";
    else if (status === "restricted") cls = "badge-warn";
    else if (status === "kicked") cls = "badge-danger";
    else if (status === "left") cls = "badge-muted";
    let html = '<span class="badge ' + cls + '">' + G.esc(label) + "</span>";
    if (member.isBot) html += '<span class="badge badge-muted">BOT</span>';
    if (Number(member.warns || 0) > 0) {
      html +=
        '<span class="badge badge-warn">' +
        G.icon("i-alert-triangle") +
        " " +
        G.esc(member.warns) +
        "</span>";
    }
    return html;
  };

  G.actionMeta = function actionMeta(action) {
    const map = {
      ban: { label: "Baneo", icon: "i-ban", tone: "danger" },
      unban: { label: "Desbaneo", icon: "i-user-check", tone: "success" },
      kick: { label: "Expulsión", icon: "i-user-x", tone: "danger" },
      mute: { label: "Silencio", icon: "i-mic-off", tone: "warn" },
      unmute: { label: "Silencio retirado", icon: "i-volume-2", tone: "success" },
      warn: { label: "Advertencia", icon: "i-alert-triangle", tone: "warn" },
      promote: { label: "Ascenso", icon: "i-user-check", tone: "info" },
      demote: { label: "Degradación", icon: "i-user-minus", tone: "muted" },
      lock: { label: "Grupo cerrado", icon: "i-lock", tone: "warn" },
      unlock: { label: "Grupo abierto", icon: "i-volume-2", tone: "success" },
      clearwarns: { label: "Advertencias borradas", icon: "i-check-circle", tone: "success" },
      gban: { label: "Baneo global", icon: "i-ban", tone: "danger" },
      captcha: { label: "Captcha", icon: "i-shield", tone: "info" },
    };
    return map[action] || { label: action || "Acción", icon: "i-shield", tone: "muted" };
  };

  G.empty = function empty(iconName, title, text, actionHtml) {
    return (
      '<div class="empty">' +
      '<span class="empty-icon">' +
      G.icon(iconName) +
      "</span>" +
      '<div class="empty-title">' +
      G.esc(title) +
      "</div>" +
      '<div class="empty-text">' +
      G.esc(text) +
      "</div>" +
      (actionHtml || "") +
      "</div>"
    );
  };

  G.toast = function toast(message, type) {
    const node = document.getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.className = "toast show" + (type ? " " + type : "");
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      node.className = "toast";
    }, 3400);
  };

  G.makeError = function makeError(message, status, data) {
    const error = new Error(message || "Ha ocurrido un error.");
    error.status = status == null ? 500 : status;
    error.data = data || null;
    return error;
  };

  // ------------------------------------------------------------
  //  Telegram WebApp
  // ------------------------------------------------------------

  function applyTheme() {
    const root = document.documentElement;
    const scheme =
      state.themeOverride === "light" || state.themeOverride === "dark"
        ? state.themeOverride
        : (tg && tg.colorScheme) ||
          (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark");
    root.dataset.theme = scheme;

    if (scheme === "dark") {
      // Modo nocturno completo: paleta oscura propia, sin depender de
      // los colores de Telegram, para un fondo totalmente negro.
      const darkPalette = {
        "--tg-theme-bg-color": "#050505",
        "--tg-theme-secondary-bg-color": "#111111",
        "--tg-theme-section-bg-color": "#1a1a1a",
        "--tg-theme-text-color": "#f5f5f5",
        "--tg-theme-hint-color": "#8a8a8a",
        "--tg-theme-button-color": "#4ea1ff",
        "--tg-theme-button-text-color": "#ffffff",
        "--tg-theme-link-color": "#4ea1ff",
        "--tg-theme-destructive-text-color": "#f87171",
      };
      Object.entries(darkPalette).forEach(([variable, value]) => {
        root.style.setProperty(variable, value);
      });
    } else if (tg && tg.themeParams) {
      const map = {
        bg_color: "--tg-theme-bg-color",
        secondary_bg_color: "--tg-theme-secondary-bg-color",
        section_bg_color: "--tg-theme-section-bg-color",
        text_color: "--tg-theme-text-color",
        hint_color: "--tg-theme-hint-color",
        button_color: "--tg-theme-button-color",
        button_text_color: "--tg-theme-button-text-color",
        link_color: "--tg-theme-link-color",
        destructive_text_color: "--tg-theme-destructive-text-color",
      };
      Object.entries(map).forEach(([key, variable]) => {
        const value = tg.themeParams[key];
        if (value) root.style.setProperty(variable, value);
      });
    }

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", scheme === "light" ? "#f5f7fb" : "#050505");
    }

    const toggle = document.getElementById("theme-toggle");
    if (toggle) {
      toggle.innerHTML =
        '<svg class="icon"><use href="#' + (scheme === "dark" ? "i-sun" : "i-moon") + '"></use></svg>';
      toggle.setAttribute(
        "aria-label",
        scheme === "dark" ? "Modo noche GBot · cambiar a modo día" : "Modo día GBot · cambiar a modo noche",
      );
    }
  }

  G.applyTheme = applyTheme;

  G.toggleTheme = function toggleTheme() {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const next = current === "dark" ? "light" : "dark";
    state.themeOverride = next;
    try {
      localStorage.setItem("gbot-theme", next);
    } catch {
      // Ignorar si localStorage no está disponible.
    }
    applyTheme();
  };

  function handleBackButton() {
    if (state.sheetOpen) {
      G.closeSheet();
      return;
    }
    if (state.tab !== "home") G.switchTab("home");
  }

  function initTelegram() {
    applyTheme();
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      if (typeof tg.disableVerticalSwipes === "function") tg.disableVerticalSwipes();
      if (typeof tg.setHeaderColor === "function") tg.setHeaderColor("secondary_bg_color");
      if (typeof tg.setBackgroundColor === "function") tg.setBackgroundColor("bg_color");
      if (typeof tg.setBottomBarColor === "function") tg.setBottomBarColor("secondary_bg_color");
      if (tg.MainButton && typeof tg.MainButton.hide === "function") tg.MainButton.hide();
    } catch {
      // La app sigue funcionando aunque alguna API no esté disponible.
    }

    if (tg.BackButton && !state.backAttached) {
      tg.BackButton.onClick(handleBackButton);
      state.backAttached = true;
    }

    if (!state.themeBound && typeof tg.onEvent === "function") {
      tg.onEvent("themeChanged", applyTheme);
      state.themeBound = true;
    }
  }

  G.updateBackButton = function updateBackButton() {
    if (!tg || !tg.BackButton) return;
    try {
      if (state.sheetOpen || state.tab !== "home") tg.BackButton.show();
      else tg.BackButton.hide();
    } catch {
      // Ignorar.
    }
  };

  // ------------------------------------------------------------
  //  API
  // ------------------------------------------------------------

  async function request(path, options) {
    if (state.demo) {
      if (typeof G.demoRequest !== "function") {
        throw G.makeError("El modo demo aún no está disponible.", 500);
      }
      return G.demoRequest(path, options || {});
    }

    const headers = {};
    if (state.initData) headers["X-Telegram-Init-Data"] = state.initData;
    if (options && options.body) headers["Content-Type"] = "application/json";

    const method = (options && options.method) || "GET";
    const deadline = Date.now() + 25_000;
    const recoverable = new Set([0, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526]);
    for (let attempt = 0; ; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
        let response, text, blob;
        try {
          response = await fetch(path, {
            method, headers,
            body: options && options.body ? options.body : undefined,
            credentials: "same-origin", redirect: "error", signal: controller.signal,
          });
          // Keep the deadline active while consuming the body, too.
          if (response.ok && options && options.binary) blob = await response.blob();
          else text = await response.text();
        } catch (error) {
          throw G.makeError(error.name === "AbortError" ? "La conexión tardó demasiado. Vuelve a intentarlo." : "No hay conexión con el servidor. Comprueba tu conexión.", 0);
        } finally { clearTimeout(timeout); }
        if (blob) return blob;
        let payload = null;
        if (text) { try { payload = JSON.parse(text); } catch { /* Non-JSON proxy error. */ } }
        if (!response.ok) {
          if (response.status === 401) G.showAuth();
          throw G.makeError((payload && payload.error) || "Error " + response.status + " del servidor.", response.status, payload);
        }
        if (!payload || typeof payload !== "object") throw G.makeError("El servidor devolvió una respuesta no válida. Vuelve a intentarlo.", 502);
        return payload;
      } catch (error) {
        const delay = 400 * (attempt + 1) ** 2 + Math.floor(Math.random() * 150);
        // Only reads can be replayed. A failed write may already have taken effect.
        if (method !== "GET" || attempt >= 2 || !recoverable.has(error.status) || Date.now() + delay >= deadline) throw error;
        await G.delay(delay);
      }
    }
  }

  G.api = {
    get(path) {
      return request(path, { method: "GET" });
    },
    post(path, body) {
      return request(path, { method: "POST", body: JSON.stringify(body || {}) });
    },
    patch(path, body) {
      return request(path, { method: "PATCH", body: JSON.stringify(body || {}) });
    },
    del(path, body) {
      return request(path, { method: "DELETE", body: JSON.stringify(body || {}) });
    },
    async blob(path) {
      if (state.demo) {
        return new Blob([JSON.stringify(G.demoExport(), null, 2)], {
          type: "application/json",
        });
      }
      return request(path, { method: "GET", binary: true });
    },
  };

  G.downloadBlob = function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  // ------------------------------------------------------------
  //  Arranque, autenticación y cabecera
  // ------------------------------------------------------------

  function hideSplash() {
    const splash = document.getElementById("splash");
    if (splash) splash.hidden = true;
  }

  G.showAuth = function showAuth() {
    hideSplash();
    const app = document.getElementById("app");
    const main = document.getElementById("main");
    const topbar = document.querySelector(".topbar");
    const nav = document.getElementById("bottom-nav");
    if (!app || !main) return;
    app.hidden = false;
    if (topbar) topbar.hidden = true;
    if (nav) nav.hidden = true;
    G.closeSheet();
    main.innerHTML =
      '<div class="auth-screen"><div class="card auth-card">' +
      '<div class="auth-logo">GB</div>' +
      '<div class="auth-title">Abre el panel desde Telegram</div>' +
      '<div class="auth-text">Por seguridad, el panel solo funciona dentro de Telegram. ' +
      "Abre el bot, pulsa <b>Panel de control</b> y vuelve a entrar.</div>" +
      '<div class="auth-actions">' +
      '<a class="btn btn-primary btn-block" href="' +
      G.BOT_URL +
      '?start=panel" target="_blank" rel="noopener">' +
      G.icon("i-send") +
      " Abrir @" +
      G.BOT_USERNAME +
      "</a>" +
      '<a class="btn btn-secondary btn-block" href="?demo=1">' +
      G.icon("i-eye") +
      " Ver demostración</a>" +
      "</div>" +
      '<p class="hint mt-16">También puedes abrir la demo con <b>?demo=1</b> para probar la interfaz sin Telegram.</p>' +
      "</div></div>";
  };

  G.showNoChats = function showNoChats() {
    hideSplash();
    const app = document.getElementById("app");
    const main = document.getElementById("main");
    const topbar = document.querySelector(".topbar");
    const nav = document.getElementById("bottom-nav");
    if (!app || !main) return;
    app.hidden = false;
    if (topbar) topbar.hidden = true;
    if (nav) nav.hidden = true;
    main.innerHTML =
      '<div class="auth-screen"><div class="card auth-card">' +
      '<div class="auth-logo">GB</div>' +
      '<div class="auth-title">Aún no hay grupos</div>' +
      '<div class="auth-text">Añade a <b>@' +
      G.BOT_USERNAME +
      "</b> a un grupo y dale permisos de administrador. Después vuelve a abrir este panel.</div>" +
      '<div class="auth-actions">' +
      '<a class="btn btn-primary btn-block" href="' +
      G.BOT_URL +
      '?startgroup=true" target="_blank" rel="noopener">' +
      G.icon("i-plus") +
      " Añadir a un grupo</a>" +
      '<button class="btn btn-secondary btn-block" data-action="retry">' +
      G.icon("i-refresh") +
      " Volver a comprobar</button>" +
      "</div></div></div>";
  };

  G.showFatal = function showFatal(error) {
    hideSplash();
    const app = document.getElementById("app");
    const main = document.getElementById("main");
    const topbar = document.querySelector(".topbar");
    const nav = document.getElementById("bottom-nav");
    if (!app || !main) return;
    app.hidden = false;
    if (topbar) topbar.hidden = true;
    if (nav) nav.hidden = true;
    main.innerHTML =
      '<div class="error-state">' +
      '<span class="empty-icon">' +
      G.icon("i-alert-triangle") +
      "</span>" +
      '<div class="empty-title">No se pudo cargar el panel</div>' +
      '<div class="empty-text">' +
      G.esc((error && error.message) || "Comprueba tu conexión e inténtalo de nuevo.") +
      "</div>" +
      '<div class="auth-actions">' +
      '<button class="btn btn-primary btn-block" data-action="retry">' +
      G.icon("i-refresh") +
      " Reintentar</button>" +
      "</div></div>";
  };

  function showApp() {
    hideSplash();
    const app = document.getElementById("app");
    const topbar = document.querySelector(".topbar");
    const nav = document.getElementById("bottom-nav");
    if (app) app.hidden = false;
    if (topbar) topbar.hidden = false;
    if (nav) nav.hidden = false;
    G.updateHeader();
    G.updateBackButton();
  }

  G.showApp = showApp;

  function setAvatarNode(node, member, sizeClass) {
    if (!node) return;
    const name = (member && (member.displayName || member.firstName || member.username)) || "?";
    node.style.background = G.avatarGradient(member && member.id);
    node.innerHTML =
      '<span class="avatar-fallback">' +
      G.esc(G.initials(name)) +
      "</span>" +
      (member && member.avatarUrl
        ? '<img class="avatar-img" src="' + G.esc(member.avatarUrl) + '" alt="" data-avatar>'
        : "");
  }

  G.updateHeader = function updateHeader() {
    const chat = (state.bootstrap && state.bootstrap.chat) || state.chat;
    const user = state.bootstrap && state.bootstrap.user;
    const title = document.getElementById("chat-switcher-title");
    const meta = document.getElementById("chat-switcher-meta");
    const chatAvatar = document.getElementById("chat-switcher-avatar");
    const userAvatar = document.getElementById("user-avatar");
    const premiumDot = document.getElementById("premium-dot");
    const demoPill = document.getElementById("demo-pill");

    if (title) title.textContent = (chat && chat.title) || "Selecciona un grupo";
    if (meta) {
      if (chat) {
        const premium = chat.premium && chat.premium.active;
        const count = chat.memberCount != null ? G.fmtInt(chat.memberCount) + " miembros" : "Grupo";
        meta.textContent = count + " · " + (premium ? "Premium" : "Plan gratis");
      } else {
        meta.textContent = "—";
      }
    }
    if (chatAvatar) {
      setAvatarNode(chatAvatar,{id:chat?.id,displayName:chat?.title||'GB',avatarUrl:chat?.photoUrl});
    }
    if (userAvatar) {
      userAvatar.innerHTML = "";
      setAvatarNode(userAvatar, user, "avatar-sm");
    }
    if (premiumDot) premiumDot.hidden = Boolean(chat && chat.premium && chat.premium.active);
    if (demoPill) demoPill.hidden = !state.demo;
    G.updateBackButton();
  };

  // ------------------------------------------------------------
  //  Carga de datos y navegación
  // ------------------------------------------------------------

  G.renderLoading = function renderLoading() {
    const main = document.getElementById("main");
    if (!main) return;
    main.innerHTML =
      '<div class="skeleton skeleton-card"></div>' +
      '<div class="skeleton skeleton-card"></div>' +
      '<div class="skeleton skeleton-line"></div>' +
      '<div class="skeleton skeleton-line short"></div>';
  };

  G.loadBootstrap = async function loadBootstrap(options) {
    const opts = options || {};
    if (!state.chat) return;
    const chatId = state.chat.id;
    const requestId = ++state.bootstrapRequestId;
    if (!opts.silent) G.renderLoading();
    try {
      const data = await G.api.get("/api/bootstrap?chat_id=" + encodeURIComponent(chatId));
      if (state.chat?.id !== chatId || requestId !== state.bootstrapRequestId) return false;
      state.bootstrap = data;
      state.settings = data.settings;
      state.lastUpdated = data.serverTime || new Date().toISOString();
      if (!data.chat.premium.active && !data.access?.owner) state.chartDays = 7;
      G.applyLanguage(data.settings.language);
      state.chat = Object.assign({}, state.chat, {
        title: data.chat.title,
        username: data.chat.username,
        type: data.chat.type,
        memberCount: data.chat.memberCount,
        premium: data.chat.premium,
      });
      const index = state.chats.findIndex((item) => item.id === state.chat.id);
      if (index >= 0) state.chats[index] = Object.assign({}, state.chats[index], state.chat);
      G.updateHeader();
      G.renderTab();
      return true;
    } catch (error) {
      if (state.chat?.id !== chatId || requestId !== state.bootstrapRequestId) return false;
      if (error.status === 401) {
        G.showAuth();
        return;
      }
      if (!opts.silent) {
        G.showFatal(error);
      } else {
        G.toast(error.message || "No se pudo actualizar el panel.", "error");
      }
      return false;
    }
  };

  G.switchChat = async function switchChat(chatId) {
    const chat = state.chats.find((item) => item.id === Number(chatId));
    if (!chat) return;
    state.chat = chat;
    state.bootstrapRequestId++;
    state.memberRequestId = (state.memberRequestId || 0) + 1;
    state.memberDetail = null;
    clearTimeout(state.members.searchTimer);
    state.bootstrap = null;
    state.settings = null;
    state.content = null;
    state.premium = null;
    state.members = {
      items: [],
      total: 0,
      tracked: 0,
      liveAdmins: 0,
      query: "",
      filter: "all",
      loading: false,
      loaded: false,
      hasMore: false,
      offset: 0,
      focusSearch: false,
    };
    state.logs = {
      items: [],
      total: 0,
      action: "",
      loading: false,
      loaded: false,
      hasMore: false,
      offset: 0,
    };
    state.tab = "home";
    G.closeSheet();
    showApp();
    G.updateNav();
    await G.loadBootstrap();
  };

  G.updateNav = function updateNav() {
    document.querySelectorAll(".nav-item[data-tab]").forEach((button) => {
      const active = button.dataset.tab === state.tab;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  };

  G.switchTab = function switchTab(tab) {
    if (!state.bootstrap && tab !== "home") return;
    state.tab = tab;
    G.updateNav();
    G.updateBackButton();
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (tab === "members" && !state.members.loaded) {
      G.renderMembers();
      G.loadMembers().catch(error => G.toast(error.message || "No se pudieron cargar los miembros.", "error"));
      return;
    }
    if (tab === "moderation" && !state.logs.loaded) {
      G.renderModeration();
      G.loadLogs().catch(error => G.toast(error.message || "No se pudo cargar el registro.", "error"));
      return;
    }
    if (tab === "settings") {
      if (!state.content) {
        G.renderSettings();
        G.loadContent().then(() => {
          if (state.tab === "settings") G.renderSettings();
        }).catch(error => G.toast(error.message || "No se pudo cargar el contenido.", "error"));
      } else {
        G.renderSettings();
      }
      return;
    }
    if (tab === "premium") {
      G.renderPremium();
      if (!state.premium) G.loadPremium().catch(error => G.toast(error.message || "No se pudo cargar el plan.", "error"));
      return;
    }
    G.renderTab();
  };

  G.renderTab = function renderTab() {
    if (!state.bootstrap) {
      G.renderLoading();
      return;
    }
    G.updateNav();
    if (state.tab === "members") G.renderMembers();
    else if (state.tab === "moderation") G.renderModeration();
    else if (state.tab === "settings") G.renderSettings();
    else if (state.tab === "premium") G.renderPremium();
    else G.renderHome();
    G.updateHeader();
  };

  G.refreshAll = async function refreshAll() {
    if (!state.chat) return;
    const chatId = state.chat.id;
    if (!(await G.loadBootstrap({ silent: true })) || state.chat?.id !== chatId) return;
    if (state.tab === "members") await G.loadMembers();
    else if (state.tab === "moderation") await G.loadLogs();
    else if (state.tab === "settings") {
      state.content = null;
      G.renderSettings();
      await G.loadContent();
    } else if (state.tab === "premium") {
      await G.loadPremium();
    }
    G.toast("Panel actualizado.", "success");
  };

  // ------------------------------------------------------------
  //  Hojas, confirmaciones y formularios
  // ------------------------------------------------------------

  G.openSheet = function openSheet(options) {
    const root = document.getElementById("modal-root");
    if (!root) return;
    const title = options.title || "";
    const subtitle = options.subtitle || state.chat?.title || "";
    if (!state.sheetOpen) state.sheetReturnFocus = document.activeElement;
    state.sheetChatId = state.chat?.id;
    state.sheetVersion = (state.sheetVersion || 0) + 1;
    root.innerHTML =
      '<div class="sheet-backdrop" data-sheet-backdrop>' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-label="' +
      G.esc(title) +
      '">' +
      '<div class="sheet-handle"></div>' +
      '<div class="sheet-header">' +
      '<div class="sheet-header-main">' +
      '<div class="sheet-title">' +
      G.esc(title) +
      "</div>" +
      (subtitle ? '<div class="sheet-sub">' + G.esc(subtitle) + "</div>" : "") +
      "</div>" +
      '<button class="sheet-close" type="button" data-action="close-sheet" aria-label="Cerrar">' +
      G.icon("i-close") +
      "</button>" +
      "</div>" +
      '<div class="sheet-body">' +
      (options.body || "") +
      "</div></div></div>";
    state.sheetOpen = true;
    document.body.classList.add("no-scroll");
    G.updateBackButton();
    root.querySelector(".sheet-close")?.focus();
  };

  G.closeSheet = function closeSheet() {
    const root = document.getElementById("modal-root");
    if (root) root.innerHTML = "";
    state.sheetOpen = false;
    state.confirm = null;
    state.sheetChatId = null;
    state.sheetVersion = (state.sheetVersion || 0) + 1;
    state.memberRequestId = (state.memberRequestId || 0) + 1;
    document.body.classList.remove("no-scroll");
    G.updateBackButton();
    if (state.sheetReturnFocus?.isConnected) state.sheetReturnFocus.focus();
  };

  G.openConfirm = function openConfirm(options) {
    state.confirm = options.onConfirm;
    G.openSheet({
      title: options.title || "Confirmar acción",
      subtitle: options.subtitle || "",
      body:
        '<div class="confirm-icon">' +
        G.icon(options.icon || "i-alert-triangle") +
        "</div>" +
        '<div class="empty-title">' +
        G.esc(options.heading || "¿Seguro que quieres continuar?") +
        "</div>" +
        '<div class="confirm-text">' +
        G.esc(options.text || "") +
        "</div>" +
        '<div class="sheet-actions">' +
        '<button class="btn btn-secondary" type="button" data-action="close-sheet">Cancelar</button>' +
        '<button class="btn ' +
        (options.tone === "success" ? "btn-success" : "btn-danger") +
        '" type="button" data-action="run-confirm">' +
        G.esc(options.confirmText || "Confirmar") +
        "</button></div>",
    });
  };

  G.runConfirm = async function runConfirm() {
    if (state.sheetChatId !== state.chat?.id) { G.closeSheet(); return; }
    const callback = state.confirm;
    state.confirm = null;
    if (!callback) return;
    try {
      await callback();
    } catch (error) {
      G.toast(error.message || "No se pudo completar la acción.", "error");
    }
  };

  G.registerAction = function registerAction(name, handler) {
    G.actions[name] = handler;
  };

  G.registerForm = function registerForm(name, handler) {
    G.forms[name] = handler;
  };

  G.registerInput = function registerInput(name, handler) {
    G.inputs[name] = handler;
  };

  G.runAction = async function runAction(name, target) {
    const handler = G.actions[name];
    if (!handler) return;
    if (target && target.disabled) return;
    if (target) target.disabled = true;
    try {
      await handler(target);
    } catch (error) {
      if (error && error.status === 401) {
        G.showAuth();
        return;
      }
      G.toast((error && error.message) || "Ha ocurrido un error.", "error");
    } finally { if (target) target.disabled = false; }
  };

  // ------------------------------------------------------------
  //  Arranque
  // ------------------------------------------------------------

  G.boot = async function boot() {
    if (window.history) window.history.scrollRestoration = "manual";
    window.scrollTo({ top: 0 });
    initTelegram();
    try {
      if (state.demo) {
        state.chats = G.demoChats();
        if (!state.chats.length) {
          G.showNoChats();
          return;
        }
        const requested = Number(params.get("chat_id") || 0);
        state.chat =
          state.chats.find((item) => item.id === requested) || state.chats[0];
        showApp();
        await G.loadBootstrap();
        if (["members", "moderation", "settings", "premium"].includes(params.get("tab"))) G.switchTab(params.get("tab"));
        return;
      }

      if (!state.initData) {
        G.showAuth();
        return;
      }

      const data = await G.api.get("/api/chats");
      state.chats = (data && data.chats) || [];
      if (!state.chats.length) {
        G.showNoChats();
        return;
      }
      const requested = Number(params.get("chat_id") || 0);
      if (requested && !state.chats.some(item => item.id === requested)) {
        G.toast("Ese grupo no está disponible para tu cuenta. Elige uno de tus grupos.", "error");
      }
      state.chat =
        state.chats.find((item) => item.id === requested) || state.chats[0];
      showApp();
      await G.loadBootstrap();
      if (["members", "moderation", "settings", "premium"].includes(params.get("tab"))) G.switchTab(params.get("tab"));
    } catch (error) {
      if (error.status === 401) G.showAuth();
      else G.showFatal(error);
    }
  };

  // ------------------------------------------------------------
  //  Eventos globales
  // ------------------------------------------------------------

  document.addEventListener("click", (event) => {
    const nav = event.target.closest(".nav-item[data-tab]");
    if (nav) {
      event.preventDefault();
      G.switchTab(nav.dataset.tab);
      return;
    }

    const actionNode = event.target.closest("[data-action]");
    if (actionNode) {
      if (actionNode.tagName === "A") event.preventDefault();
      G.runAction(actionNode.dataset.action, actionNode);
      return;
    }

    const backdrop = event.target.closest("[data-sheet-backdrop]");
    if (backdrop && event.target === backdrop) G.closeSheet();
  });

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    const handler = G.forms[form.dataset.form];
    if (!handler) return;
    if (form.dataset.submitting === "true" || (form.closest('#modal-root') && state.sheetChatId !== state.chat?.id)) return;
    form.dataset.submitting = "true";
    const buttons = Array.from(form.querySelectorAll('[type="submit"]'));
    buttons.forEach(button => { button.disabled = true; button.setAttribute("aria-busy", "true"); });
    Promise.resolve().then(() => handler(form)).catch((error) => {
      if (error && error.status === 401) {
        G.showAuth();
        return;
      }
      G.toast((error && error.message) || "No se pudo guardar.", "error");
    }).finally(() => {
      delete form.dataset.submitting;
      buttons.forEach(button => { button.disabled = false; button.removeAttribute("aria-busy"); });
    });
  });

  document.addEventListener("input", (event) => {
    const input = event.target.closest("[data-input]");
    if (!input) return;
    const handler = G.inputs[input.dataset.input];
    if (handler) handler(input);
  });

  document.addEventListener("change", (event) => {
    const input = event.target.closest("[data-change]");
    if (!input) return;
    const handler = G.inputs[input.dataset.change];
    if (handler) handler(input);
  });

  document.addEventListener(
    "error",
    (event) => {
      const image = event.target;
      if (image && image.classList && image.classList.contains("avatar-img")) {
        image.remove();
      }
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.sheetOpen) G.closeSheet();
    if (event.key === "Tab" && state.sheetOpen) {
      const nodes = Array.from(document.querySelectorAll('.sheet button:not(:disabled), .sheet input:not(:disabled), .sheet select:not(:disabled), .sheet textarea:not(:disabled), .sheet a[href]')).filter(node => !node.hidden);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });

  // Acciones comunes disponibles en todas las pantallas.
  G.registerAction("close-sheet", () => G.closeSheet());
  G.registerAction("run-confirm", () => G.runConfirm());
  G.registerAction("retry", async () => {
    if (state.demo) {
      window.location.reload();
      return;
    }
    if (!state.initData) {
      G.showAuth();
      return;
    }
    const app = document.getElementById("app");
    if (app) app.hidden = true;
    await G.boot();
  });
  G.registerAction("refresh", () => G.refreshAll());
  G.registerAction("toggle-theme", () => G.toggleTheme());
  G.registerAction("open-bot", () => {
    if (tg && typeof tg.openTelegramLink === "function") {
      tg.openTelegramLink(G.BOT_URL);
    } else {
      window.open(G.BOT_URL, "_blank", "noopener");
    }
  });
  G.registerAction("open-support", () => {
    if (tg && typeof tg.openTelegramLink === "function") {
      tg.openTelegramLink(G.SUPPORT_URL);
    } else {
      window.open(G.SUPPORT_URL, "_blank", "noopener");
    }
  });
})();
