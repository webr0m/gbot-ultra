/* ============================================================
   GBot Ultra · pantallas principales de la Mini App
   ============================================================ */

(() => {
  "use strict";

  const G = window.GBot;
  if (!G) return;
  const state = G.state;
  let unmountBanner = null;

  function mountBanner(slot) {
    if (unmountBanner) unmountBanner();
    unmountBanner = null;
    if (!slot) return;
    const viewport = document.createElement("div");
    viewport.className = "ad-viewport";
    const frame = document.createElement("iframe");
    frame.className = "ad-frame";
    frame.title = "Publicidad";
    // A separate document gives the provider its own load event on every visit
    // and keeps its document.write hooks and creative scripts out of the app.
    frame.src = "/api/banner/data527";
    frame.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms");
    frame.dataset.provider = "data527";
    const googleFrame = document.createElement("iframe");
    googleFrame.className = "ad-frame ad-frame-responsive";
    googleFrame.title = "Publicidad de Google";
    googleFrame.dataset.provider = "adsense";
    googleFrame.hidden = true;
    googleFrame.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms");
    viewport.appendChild(frame);
    viewport.appendChild(googleFrame);
    slot.appendChild(viewport);
    function resize() {
      const scale = Math.min(1, viewport.clientWidth / 728);
      frame.style.transform = "scale(" + scale + ")";
      const height = viewport.clientWidth < 468 ? 50 : viewport.clientWidth < 728 ? 60 : 90;
      viewport.style.height = height + "px";
      frame.style.top = (height - 90 * scale) / 2 + "px";
    }
    resize();
    const observer = new ResizeObserver(() => {
      if (!viewport.isConnected) {
        cleanup();
        return;
      }
      resize();
    });
    observer.observe(viewport);
    let googleVisible = false;
    let googleUnavailable = false;
    let googleResolved = false;
    let availabilityTimer = null;
    function unavailable() {
      googleUnavailable = true;
      googleVisible = false;
      googleFrame.hidden = true;
      frame.hidden = false;
    }
    function onAdStatus(event) {
      if (event.origin !== "null" || event.source !== googleFrame.contentWindow ||
          !event.data || event.data.type !== "gbot-ad-status") return;
      googleResolved = true;
      clearTimeout(availabilityTimer);
      googleUnavailable = event.data.status !== "filled";
      if (googleUnavailable) unavailable();
    }
    window.addEventListener("message", onAdStatus);
    const timer = setInterval(() => {
      if (!viewport.isConnected) return cleanup();
      if (document.hidden || googleUnavailable) return;
      googleVisible = !googleVisible;
      frame.hidden = googleVisible;
      googleFrame.hidden = !googleVisible;
      // Initialize AdSense only when its container is visible and has a width.
      // Subsequent switches reuse it instead of refreshing ad impressions.
      if (googleVisible && !googleFrame.getAttribute("src")) {
        googleFrame.src = "/api/banner/adsense";
        // The child cannot report an error if a browser blocks the whole iframe.
        // Keep the timeout in the parent too so a blocked ad never sticks blank.
        availabilityTimer = setTimeout(() => { if (!googleResolved) unavailable(); }, 10000);
      }
    }, 15000);
    function cleanup() {
      observer.disconnect();
      clearInterval(timer);
      clearTimeout(availabilityTimer);
      window.removeEventListener("message", onAdStatus);
    }
    unmountBanner = cleanup;
  }

  function main() {
    return document.getElementById("main");
  }

  function isPremium() {
    return Boolean(state.bootstrap && (state.bootstrap.chat.premium.active || state.bootstrap.access?.owner));
  }

  G.canModerate = function canModerate(action) {
    const b = state.bootstrap;
    if (!b) return false;
    const right = ["promote", "demote"].includes(action) ? "can_promote_members" : "can_restrict_members";
    return b.botRights?.[right] !== false && b.access?.actorRights?.[right] !== false;
  };

  G.renderDiagnostics = function renderDiagnostics() {
    const b = state.bootstrap;
    if (!b) return "";
    const rights = b.botRights || {};
    const checks = [
      ["Administrador del grupo", Boolean(rights.isAdmin), "Asciende al bot desde la información del grupo."],
      ["Eliminar mensajes", Boolean(rights.can_delete_messages), "Necesario para antienlaces y limpieza."],
      ["Restringir miembros", Boolean(rights.can_restrict_members), "Necesario para captcha, silencios y baneos."],
      ["Normas del grupo", Boolean(b.settings.rules.text?.trim()), "Añade tus normas en Ajustes."],
    ];
    const missing = checks.filter(check => !check[1]).length;
    return '<section class="card setup-card" aria-label="Estado del grupo"><div class="row-between wrap"><div><h2 class="section-title">' + G.icon("i-shield") +
      ' Estado del grupo</h2><p class="section-subtitle">' + (missing ? missing + " puntos por revisar" : "Configuración básica lista") +
      '</p></div><button class="btn btn-secondary btn-sm" data-action="tab" data-tab="settings">Revisar ajustes</button></div><ul class="setup-list">' +
      checks.map(check => '<li><span class="setup-state ' + (check[1] ? 'ready' : 'pending') + '">' + G.icon(check[1] ? 'i-check-circle' : 'i-alert-triangle') + '</span><div><strong>' + G.esc(check[0]) + '</strong><p>' + (check[1] ? 'Listo' : G.esc(check[2])) + '</p></div></li>').join('') +
      '</ul><p class="hint">Los cambios de ajustes se guardan automáticamente y se aplican también en Telegram.</p></section>';
  };

  function isAdminStatus(status) {
    return status === "creator" || status === "administrator";
  }

  function memberName(member) {
    return (
      (member && (member.displayName || member.firstName)) ||
      (member && member.username) ||
      "Usuario"
    );
  }

  function logRow(log) {
    const meta = G.actionMeta(log.action);
    const tone = {
      danger: "var(--danger)",
      warn: "var(--warning)",
      success: "var(--success)",
      info: "var(--accent)",
      muted: "var(--muted)",
    }[meta.tone] || "var(--muted)";
    const target = log.target ? log.target.name : null;
    const actor = log.actor ? log.actor.name : "Sistema";
    return (
      '<div class="list-item">' +
      '<span class="toggle-icon" style="color:' +
      tone +
      '">' +
      G.icon(meta.icon) +
      "</span>" +
      '<div class="list-item-main">' +
      '<div class="list-item-title">' +
      G.esc(meta.label) +
      (target ? '<span class="muted"> · ' + G.esc(target) + "</span>" : "") +
      "</div>" +
      '<div class="list-item-sub">' +
      (log.reason ? G.esc(log.reason) + " · " : "") +
      G.esc(actor) +
      " · " +
      G.fmtDateTime(log.createdAt) +
      (log.durationSeconds != null
        ? " · " + G.esc(G.fmtDuration(log.durationSeconds))
        : "") +
      "</div></div></div>"
    );
  }

  function renderChart(points) {
    if (!points || !points.length) {
      return G.empty("i-bar-chart", "Sin actividad todavía", "Cuando el grupo tenga mensajes verás aquí la evolución.");
    }
    const width = 640;
    const height = 190;
    const left = 38;
    const right = 16;
    const top = 16;
    const bottom = 28;
    const innerWidth = width - left - right;
    const innerHeight = height - top - bottom;
    const max = Math.max(10, ...points.map((point) => Number(point.messages || 0)), ...points.map((point) => Number(point.joins || 0)));
    const stepX = points.length > 1 ? innerWidth / (points.length - 1) : 0;
    const x = (index) => left + index * stepX;
    const y = (value) => top + innerHeight * (1 - Number(value || 0) / max);
    const messageLine = points
      .map((point, index) => (index === 0 ? "M" : "L") + " " + x(index).toFixed(1) + " " + y(point.messages).toFixed(1))
      .join(" ");
    const area =
      messageLine +
      " L " +
      x(points.length - 1).toFixed(1) +
      " " +
      (height - bottom) +
      " L " +
      x(0).toFixed(1) +
      " " +
      (height - bottom) +
      " Z";
    const joinLine = points
      .map((point, index) => (index === 0 ? "M" : "L") + " " + x(index).toFixed(1) + " " + y(point.joins).toFixed(1))
      .join(" ");

    const grid = [0, 0.5, 1]
      .map((ratio) => {
        const lineY = top + innerHeight * ratio;
        const value = Math.round(max * (1 - ratio));
        return (
          '<line x1="' +
          left +
          '" y1="' +
          lineY +
          '" x2="' +
          (width - right) +
          '" y2="' +
          lineY +
          '" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 5"/>' +
          '<text x="' +
          (left - 7) +
          '" y="' +
          (lineY + 3) +
          '" text-anchor="end">' +
          G.fmtInt(value) +
          "</text>"
        );
      })
      .join("");

    const labelEvery = Math.max(1, Math.ceil(points.length / 7));
    const labels = points
      .map((point, index) =>
        index % labelEvery === 0 || index === points.length - 1
          ? '<text x="' + x(index).toFixed(1) + '" y="' + (height - 8) + '" text-anchor="middle">' + G.esc(point.label) + "</text>"
          : "",
      )
      .join("");

    return (
      '<div class="chart-wrap"><svg viewBox="0 0 ' +
      width +
      " " +
      height +
      '" role="img" aria-label="Mensajes y nuevos miembros de los últimos días">' +
      '<defs><linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#4ea1ff" stop-opacity="0.32"/>' +
      '<stop offset="100%" stop-color="#4ea1ff" stop-opacity="0.02"/>' +
      "</linearGradient></defs>" +
      grid +
      '<path d="' +
      area +
      '" fill="url(#chart-area)"/>' +
      '<path d="' +
      messageLine +
      '" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="' +
      joinLine +
      '" fill="none" stroke="var(--success)" stroke-width="1.8" stroke-dasharray="5 4" stroke-linecap="round"/>' +
      labels +
      "</svg></div>"
    );
  }

  // ------------------------------------------------------------
  //  Inicio
  // ------------------------------------------------------------

  G.renderHome = function renderHome() {
    const box = main();
    const b = state.bootstrap;
    if (!box || !b) return;
    const chat = b.chat;
    const premium = chat.premium.active;
    const actions = b.limits.actions;
    const percent = Math.min(100, Math.round((actions.used / Math.max(1, actions.limit)) * 100));
    const progressClass = percent >= 95 ? "danger" : percent >= 80 ? "warn" : "";
    const botWarning =
      b.botRights && !b.botRights.isAdmin
        ? '<div class="card" style="border-color:rgba(251,191,36,.35);margin-bottom:12px">' +
          '<div class="row" style="align-items:flex-start">' +
          '<span class="toggle-icon" style="color:var(--warning)">' +
          G.icon("i-alert-triangle") +
          "</span>" +
          '<div class="grow"><div class="toggle-title">El bot no es administrador</div>' +
          '<div class="toggle-desc">Dale permisos de administrador para que pueda moderar, borrar mensajes y gestionar miembros.</div></div>' +
          "</div></div>"
        : "";

    const topHtml = b.top.length
      ? b.top
          .map(
            (member, index) =>
              '<button class="list-item" type="button" data-action="member-open" data-user-id="' +
              member.id +
              '">' +
              '<span class="rank ' +
              (index === 0 ? "gold" : index === 1 ? "silver" : index === 2 ? "bronze" : "") +
              '">' +
              (index + 1) +
              "</span>" +
              G.avatar({ id: member.id, firstName: member.firstName, username: member.username, avatarUrl: member.avatarUrl }, "avatar-sm") +
              '<div class="list-item-main"><div class="list-item-title">' +
              G.esc(member.firstName || member.username || "Usuario") +
              "</div>" +
              '<div class="list-item-sub">' +
              (member.username ? "@" + G.esc(member.username) : "Miembro") +
              "</div></div>" +
              '<div class="list-item-side">' +
              G.icon("i-message-circle") +
              " " +
              G.fmtInt(member.messages) +
              "</div></button>",
          )
          .join("")
      : G.empty("i-users", "Sin ranking todavía", "Los miembros aparecerán cuando participen en el grupo.");

    const logsHtml = b.logs.length
      ? b.logs.slice(0, 5).map(logRow).join("")
      : G.empty("i-shield", "Sin acciones recientes", "La moderación del grupo aparecerá aquí.");

    const adBanner =
      !isPremium() && b.ads && b.ads.enabled
        ? '<div class="card" style="margin-bottom:12px;border-color:rgba(78,161,255,.25)"><div class="row-between wrap"><div><div class="settings-card-title">' +
          G.icon("i-star") +
          " Patrocinado</div><div class=\"settings-card-desc\" style=\"margin:0\">" +
          G.esc(b.ads.text) +
          '</div></div><a class="btn btn-secondary btn-sm" href="' +
          G.esc(b.ads.url) +
          '" target="_blank" rel="noopener">' +
          G.icon("i-external-link") +
          " Ver</a></div></div>"
        : "";
    const customAdSlot = !isPremium()
      ? '<div class="card ad-slot notranslate" translate="no"></div>'
      : "";
    box.innerHTML =
      botWarning +
      adBanner +
      customAdSlot +
      '<div class="workspace-tools"><div><p class="workspace-label">' + (state.demo ? 'DEMOSTRACIÓN · datos simulados' : 'Administración del grupo') +
      '</p><p class="hint">' + (state.lastUpdated ? 'Actualizado ' + G.fmtDateTime(state.lastUpdated) : 'Panel conectado') +
      '</p></div><div class="workspace-actions">' + (state.chats.length > 1 ? '<button class="btn btn-secondary btn-sm" data-action="chats" aria-label="Elegir otro grupo">' + G.icon('i-users') + ' Grupos</button>' : '') +
      '<button class="btn btn-secondary btn-sm" data-action="toggle-theme">' + G.icon(document.documentElement.dataset.theme === 'light' ? 'i-moon' : 'i-sun') + ' Tema</button></div></div>' +
      '<section class="hero">' +
      '<div class="hero-badge"><span class="badge ' +
      (premium ? "badge-premium" : "badge-muted") +
      '">' +
      G.icon(premium ? "i-crown" : "i-shield") +
      " " +
      (state.bootstrap.access?.owner?'Cuenta':premium ? (chat.premium.until?"Premium · " + G.esc(chat.premium.daysLeft) + " días":'Pro permanente') : "Plan gratuito") +
      "</span></div>" +
      '<div class="hero-content">' +
      '<div class="hero-eyebrow">' +
      G.icon("i-bar-chart") +
      " Panel del grupo</div>" +
      '<h1 class="hero-title">' +
      G.esc(chat.title) +
      "</h1>" +
      '<div class="hero-meta">' +
      '<span>' +
      G.fmtInt(chat.memberCount) +
      " miembros</span><span class=\"dot\"></span>" +
      "<span>" +
      G.fmtInt(chat.adminCount) +
      " admins</span><span class=\"dot\"></span>" +
      "<span>" +
      G.fmtInt(chat.trackedMembers) +
      " rastreados</span>" +
      (chat.boosts ? '<span class="dot"></span><span>' + G.fmtInt(chat.boosts) + " boosts</span>" : "") +
      "</div>" +
      '<div class="hero-actions">' +
      '<button class="btn btn-primary btn-sm" type="button" data-action="tab" data-tab="members">' +
      G.icon("i-users") +
      " Gestionar miembros</button>" +
      '<button class="btn btn-secondary btn-sm" type="button" data-action="tab" data-tab="settings">' +
      G.icon("i-sliders") +
      " Ajustes</button>" +
      (!premium
        ? '<button class="btn btn-warning btn-sm" type="button" data-action="tab" data-tab="premium">' +
          G.icon("i-crown") +
          " Mejorar a Premium</button>"
        : "") +
      "</div>" +
      "</div></section>" +
      '<div class="stats-grid">' +
      '<div class="card stat-card"><span class="stat-icon">' +
      G.icon("i-users") +
      '</span><div class="stat-value">' +
      G.fmtInt(chat.memberCount) +
      '</div><div class="stat-label">Miembros</div><div class="stat-trend neutral">' +
      G.fmtInt(b.stats.joinsToday) +
      " hoy</div></div>" +
      '<div class="card stat-card"><span class="stat-icon">' +
      G.icon("i-message-circle") +
      '</span><div class="stat-value">' +
      G.fmtInt(b.stats.messagesToday) +
      '</div><div class="stat-label">Mensajes hoy</div><div class="stat-trend neutral">' +
      G.fmtInt(b.stats.messages7d) +
      " en 7 días</div></div>" +
      '<div class="card stat-card"><span class="stat-icon">' +
      G.icon("i-shield") +
      '</span><div class="stat-value">' +
      G.fmtInt(b.stats.actionsToday) +
      '</div><div class="stat-label">Acciones hoy</div><div class="stat-trend neutral">' +
      G.fmtInt(actions.remaining) +
      " restantes</div></div>" +
      '<div class="card stat-card"><span class="stat-icon" style="color:var(--warning)">' +
      G.icon("i-alert-triangle") +
      '</span><div class="stat-value">' +
      G.fmtInt(b.stats.warnings) +
      '</div><div class="stat-label">Advertencias</div><div class="stat-trend warn">' +
      G.fmtInt(b.stats.moderationToday) +
      " moderaciones hoy</div></div>" +
      "</div>" +
      G.renderDiagnostics() +
      '<section class="section">' +
      '<div class="section-header"><div><div class="section-title">Actividad</div>' +
      '<div class="section-subtitle">Mensajes y nuevas incorporaciones</div></div>' +
      '<div class="chips">' +
      [7, 14, 30]
        .map(
          (days) =>
            '<button class="chip ' +
            (state.chartDays === days ? "active" : "") +
            '" type="button" data-action="chart-range" data-days="' +
            days +
            '" data-premium="' +
            (days > 7 && !premium ? "1" : "0") +
            '">' +
            days +
            " días" +
            (days > 7 && !premium ? " 👑" : "") +
            "</button>",
        )
        .join("") +
      "</div></div>" +
      '<div class="card chart-card">' +
      '<div class="chart-head"><div><div class="chart-title">Mensajes</div>' +
      '<div class="chart-sub">Últimos ' +
      state.chartDays +
      " días</div></div>" +
      '<div class="chart-legend"><span><span class="legend-dot" style="background:var(--accent)"></span>Mensajes</span>' +
      '<span><span class="legend-dot" style="background:var(--success)"></span>Entradas</span></div></div>' +
      renderChart(b.chart) +
      "</div></section>" +
      '<div class="grid-2 section">' +
      '<div class="card"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-zap") +
      " Límites del plan</div><div class=\"section-subtitle\">" +
      (premium ? "GBot Ultra Premium" : "Plan gratuito") +
      "</div></div>" +
      (!premium
        ? '<button class="section-action" type="button" data-action="tab" data-tab="premium">Mejorar</button>'
        : "") +
      "</div>" +
      '<div class="limit-list">' +
      '<div><div class="limit-head"><span class="limit-name">Acciones de moderación</span><span class="limit-value">' +
      G.fmtInt(actions.used) +
      " / " +
      G.fmtInt(actions.limit) +
      '</span></div><div class="progress"><div class="progress-fill ' +
      progressClass +
      '" style="width:' +
      percent +
      '%"></div></div></div>' +
      '<div><div class="limit-head"><span class="limit-name">Comandos personalizados</span><span class="limit-value">' +
      G.fmtInt(b.limits.commands.used) +
      " / " +
      G.fmtInt(b.limits.commands.limit) +
      '</span></div><div class="progress"><div class="progress-fill" style="width:' +
      Math.min(100, Math.round((b.limits.commands.used / Math.max(1, b.limits.commands.limit)) * 100)) +
      '%"></div></div></div>' +
      '<div><div class="limit-head"><span class="limit-name">Notas guardadas</span><span class="limit-value">' +
      G.fmtInt(b.limits.notes.used) +
      " / " +
      G.fmtInt(b.limits.notes.limit) +
      '</span></div><div class="progress"><div class="progress-fill" style="width:' +
      Math.min(100, Math.round((b.limits.notes.used / Math.max(1, b.limits.notes.limit)) * 100)) +
      '%"></div></div></div></div></div>' +
      '<div class="card"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-star") +
      " Top de la semana</div><div class=\"section-subtitle\">Miembros más activos</div></div>" +
      '<button class="section-action" type="button" data-action="tab" data-tab="members">Ver todos</button></div>' +
      '<div class="list">' +
      topHtml +
      "</div></div></div>" +
      '<section class="section"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-shield") +
      " Últimas acciones</div><div class=\"section-subtitle\">Moderación reciente del grupo</div></div>" +
      '<button class="section-action" type="button" data-action="tab" data-tab="moderation">Ver registro</button></div>' +
      '<div class="card card-flush"><div class="list">' +
      logsHtml +
      "</div></div></section>";

    mountBanner(box.querySelector(".ad-slot"));
  };

  G.setChartRange = async function setChartRange(days) {
    if (!isPremium() && days > 7) {
      G.openPremiumPrompt("Los gráficos de 14 y 30 días");
      return;
    }
    state.chartDays = days;
    const chatId = state.chat.id;
    const requestId = state.chartRequestId = (state.chartRequestId || 0) + 1;
    try {
      const data = await G.api.get(
        "/api/stats?chat_id=" + encodeURIComponent(state.chat.id) + "&days=" + days,
      );
      if (state.chat?.id !== chatId || requestId !== state.chartRequestId || !state.bootstrap) return;
      state.bootstrap.chart = data.chart;
      state.bootstrap.stats = data.stats;
      state.bootstrap.top = data.top;
      if (data.limited) G.toast("El plan gratuito muestra un máximo de 7 días.", "error");
      if (state.tab === "home") G.renderHome();
    } catch (error) {
      G.toast(error.message || "No se pudieron cargar las estadísticas.", "error");
    }
  };

  // ------------------------------------------------------------
  //  Miembros
  // ------------------------------------------------------------

  function filteredMembers() {
    const items = state.members.items;
    const filter = state.members.filter;
    if (filter === "admins") return items.filter((member) => isAdminStatus(member.status));
    if (filter === "restricted") return items.filter((member) => member.status === "restricted");
    if (filter === "warned") return items.filter((member) => Number(member.warns || 0) > 0);
    if (filter === "kicked") return items.filter((member) => member.status === "kicked" || member.status === "left");
    return items;
  }

  G.renderMembers = function renderMembers() {
    const box = main();
    if (!box) return;
    const m = state.members;
    const counts = m.counts || {
      all: m.items.length,
      admins: m.items.filter((member) => isAdminStatus(member.status)).length,
      restricted: m.items.filter((member) => member.status === "restricted").length,
      warned: m.items.filter((member) => Number(member.warns || 0) > 0).length,
      kicked: m.items.filter((member) => member.status === "kicked" || member.status === "left").length,
    };
    const items = filteredMembers();
    const chips = [
      ["all", "Todos", counts.all],
      ["admins", "Admins", counts.admins],
      ["restricted", "Silenciados", counts.restricted],
      ["warned", "Con warns", counts.warned],
      ["kicked", "Baneados", counts.kicked],
    ];

    let listHtml = "";
    if (m.loading && !m.items.length) {
      listHtml =
        '<div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div>';
    } else if (!items.length) {
      listHtml = G.empty(
        "i-users",
        m.query ? "Sin resultados" : "No hay miembros que mostrar",
        m.query
          ? "Prueba con otro nombre o nombre de usuario."
          : "Telegram no permite listar todos los miembros del grupo. Los usuarios que escriben y los administradores aparecerán aquí.",
      );
    } else {
      listHtml = items
        .map(
          (member) =>
            '<button class="member-row" type="button" data-action="member-open" data-user-id="' +
            member.id +
            '">' +
            G.avatar(member) +
            '<div class="member-info"><div class="member-name">' +
            G.esc(memberName(member)) +
            (member.customTitle
              ? '<span class="muted small" style="font-weight:500"> · ' + G.esc(member.customTitle) + "</span>"
              : "") +
            "</div>" +
            '<div class="member-meta">' +
            (member.username ? "@" + G.esc(member.username) + " · " : "") +
            "ID " +
            G.esc(member.id) +
            (member.lastMessageAt ? " · activo " + G.fmtDate(member.lastMessageAt) : "") +
            "</div>" +
            '<div class="member-badges">' +
            G.statusBadge(member) +
            "</div></div>" +
            '<div class="member-side">' +
            G.icon("i-message-circle") +
            " " +
            G.fmtInt(member.messages) +
            G.icon("i-chevron-right") +
            "</div></button>",
        )
        .join("");
    }

    box.innerHTML =
      '<section class="section mt-0"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-users") +
      " Miembros</div><div class=\"section-subtitle\">" +
      G.fmtInt(m.tracked || m.total) +
      " rastreados · " +
      G.fmtInt(m.liveAdmins) +
      " administradores en Telegram</div></div>" +
      '<button class="section-action" type="button" data-action="refresh">Actualizar</button></div>' +
      '<div class="search-bar">' +
      G.icon("i-search") +
      '<input id="member-search" data-input="member-search" type="search" placeholder="Buscar por nombre o @usuario" value="' +
      G.esc(m.query) +
      '" autocomplete="off" />' +
      (m.query
        ? '<button class="icon-btn" type="button" data-action="member-clear" aria-label="Limpiar búsqueda">' +
          G.icon("i-close") +
          "</button>"
        : "") +
      "</div>" +
      '<div class="chips mt-8">' +
      chips
        .map(
          (chip) =>
            '<button class="chip ' +
            (m.filter === chip[0] ? "active" : "") +
            '" type="button" data-action="member-filter" data-filter="' +
            chip[0] +
            '">' +
            G.esc(chip[1]) +
            (chip[2] ? " · " + G.esc(chip[2]) : "") +
            "</button>",
        )
        .join("") +
      "</div></section>" +
      '<section class="section"><div class="card card-flush" style="padding:6px 8px"><div class="list">' +
      listHtml +
      "</div>" +
      (m.hasMore
        ? '<div style="padding:10px 4px 4px"><button class="btn btn-secondary btn-block" type="button" data-action="load-more-members" ' +
          (m.loading ? "disabled" : "") +
          ">" +
          (m.loading ? "Cargando…" : "Cargar más miembros") +
          "</button></div>"
        : "") +
      "</div></section>" +
      '<p class="hint" style="text-align:center;margin-top:14px">Telegram no expone la lista completa de miembros. GBot Ultra muestra a los usuarios rastreados y a los administradores en tiempo real.</p>';
    G.updateHeader();

    if (m.focusSearch) {
      const input = document.getElementById("member-search");
      if (input) {
        input.focus();
        const length = input.value.length;
        if (input.setSelectionRange) input.setSelectionRange(length, length);
      }
      m.focusSearch = false;
    }
  };

  G.loadMembers = async function loadMembers(append) {
    const m = state.members;
    if (m.loading && append) return;
    const requestId = (m.requestId || 0) + 1;
    m.requestId = requestId;
    m.loading = true;
    const offset = append ? m.items.length : 0;
    if (!append) {
      m.items = [];
      m.total = 0;
      m.hasMore = false;
    }
    if (state.tab === "members") G.renderMembers();
    try {
      const data = await G.api.get(
        "/api/members?chat_id=" +
          encodeURIComponent(state.chat.id) +
          "&limit=200&offset=" +
          offset +
          "&q=" +
          encodeURIComponent(m.query) + "&filter=" + encodeURIComponent(m.filter || "all"),
      );
      if (state.members !== m || requestId !== m.requestId) return;
      m.items = append ? m.items.concat(data.members || []) : data.members || [];
      m.total = data.total || 0;
      m.counts = data.counts || null;
      m.tracked = data.tracked || 0;
      m.liveAdmins = data.liveAdmins || 0;
      m.hasMore = Boolean(data.hasMore);
      m.loaded = true;
      m.loading = false;
      if (state.tab === "members") G.renderMembers();
    } catch (error) {
      if (state.members !== m || requestId !== m.requestId) return;
      m.loading = false;
      if (state.tab === "members") G.renderMembers();
      throw error;
    }
  };

  G.registerInput("member-search", (input) => {
    state.members.query = input.value;
    state.members.focusSearch = true;
    if (state.members.searchTimer) clearTimeout(state.members.searchTimer);
    state.members.searchTimer = setTimeout(() => {
      G.loadMembers(false).catch((error) =>
        G.toast(error.message || "No se pudo buscar.", "error"),
      );
    }, 320);
  });

  // ------------------------------------------------------------
  //  Moderación
  // ------------------------------------------------------------

  G.renderModeration = function renderModeration() {
    const box = main();
    const b = state.bootstrap;
    if (!box || !b) return;
    const l = state.logs;
    const filters = [
      ["", "Todo"],
      ["ban", "Baneos"],
      ["mute", "Silencios"],
      ["warn", "Warns"],
      ["kick", "Expulsiones"],
      ["promote", "Promociones"],
    ];
    let listHtml = "";
    if (l.loading && !l.items.length) {
      listHtml =
        '<div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div>';
    } else if (!l.items.length) {
      listHtml = G.empty("i-shield", "Sin acciones registradas", "Las acciones de moderación aparecerán aquí.");
    } else {
      listHtml = l.items.map(logRow).join("");
    }

    box.innerHTML =
      '<section class="section mt-0"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-shield") +
      " Moderación</div><div class=\"section-subtitle\">Controla el orden del grupo</div></div>" +
      '<button class="section-action" type="button" data-action="refresh">Actualizar</button></div>' +
      '<div class="card"><div class="row-between wrap"><div><div class="toggle-title">Acciones del grupo</div>' +
      '<div class="toggle-desc">Cierra el grupo temporalmente o elige un miembro para moderarlo.</div></div>' +
      '<div class="row wrap"><button class="btn btn-warning btn-sm" type="button" data-action="lock-group">' +
      G.icon("i-lock") +
      " Cerrar grupo</button>" +
      '<button class="btn btn-success btn-sm" type="button" data-action="unlock-group">' +
      G.icon("i-volume-2") +
      " Abrir grupo</button>" +
      '<button class="btn btn-secondary btn-sm" type="button" data-action="moderate-member">' +
      G.icon("i-users") +
      " Elegir miembro</button></div></div></div></section>" +
      '<section class="section"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-clock") +
      " Registro de acciones</div><div class=\"section-subtitle\">" +
      G.fmtInt(l.total) +
      " acciones registradas</div></div></div>" +
      '<div class="chips">' +
      filters
        .map(
          (filter) =>
            '<button class="chip ' +
            (l.action === filter[0] ? "active" : "") +
            '" type="button" data-action="log-filter" data-filter="' +
            filter[0] +
            '">' +
            filter[1] +
            "</button>",
        )
        .join("") +
      "</div>" +
      '<div class="card card-flush mt-8"><div class="list">' +
      listHtml +
      "</div>" +
      (l.hasMore
        ? '<div style="padding:10px 4px 4px"><button class="btn btn-secondary btn-block" type="button" data-action="load-more-logs" ' +
          (l.loading ? "disabled" : "") +
          ">" +
          (l.loading ? "Cargando…" : "Cargar más") +
          "</button></div>"
        : "") +
      "</div></section>";
    G.updateHeader();
  };

  G.loadLogs = async function loadLogs(append) {
    const l = state.logs;
    if (l.loading && append) return;
    const requestId = (l.requestId || 0) + 1;
    l.requestId = requestId;
    l.loading = true;
    const offset = append ? l.items.length : 0;
    if (!append) {
      l.items = [];
      l.total = 0;
      l.hasMore = false;
    }
    if (state.tab === "moderation") G.renderModeration();
    try {
      const data = await G.api.get(
        "/api/moderation/log?chat_id=" +
          encodeURIComponent(state.chat.id) +
          "&limit=30&offset=" +
          offset +
          "&action=" +
          encodeURIComponent(l.action),
      );
      if (state.logs !== l || requestId !== l.requestId) return;
      l.items = append ? l.items.concat(data.items || []) : data.items || [];
      l.total = data.total || 0;
      l.hasMore = Boolean(data.hasMore);
      l.loaded = true;
      l.loading = false;
      if (state.tab === "moderation") G.renderModeration();
    } catch (error) {
      if (state.logs !== l || requestId !== l.requestId) return;
      l.loading = false;
      if (state.tab === "moderation") G.renderModeration();
      throw error;
    }
  };

  // ------------------------------------------------------------
  //  Premium
  // ------------------------------------------------------------

  G.loadPremium = async function loadPremium() {
    const chatId = state.chat?.id;
    if (!chatId) return;
    try {
      const data = await G.api.get("/api/premium?chat_id=" + encodeURIComponent(state.chat.id));
      if (state.chat?.id !== chatId) return;
      state.premium = data;
      if (state.tab === "premium") G.renderPremium();
    } catch (error) {
      throw error;
    }
  };

  G.renderPremium = function renderPremium() {
    const box = main();
    const b = state.bootstrap;
    if (!box || !b) return;
    const premium =
      state.premium || {
        status: b.chat.premium,
        plans: b.plans,
        perks: b.perks,
        payments: b.payments,
      };
    const status = premium.status || b.chat.premium;
    const active = Boolean(status.active || state.bootstrap.access?.owner);
    const plans = premium.plans || b.plans || [];
    const perks = premium.perks || b.perks || [];
    const payments = premium.payments || b.payments || [];

    const planCards = plans
      .map(
        (plan) =>
          '<div class="plan-card ' +
          (plan.popular ? "popular" : "") +
          '">' +
          (plan.popular ? '<span class="plan-badge">Más elegido</span>' : "") +
          '<div class="plan-emoji">' +
          G.esc(plan.emoji || "👑") +
          '</div><div class="plan-name">' +
          G.esc(plan.label) +
          '</div><div class="plan-price">' +
          G.fmtInt(plan.stars) +
          ' ⭐ <small>' +
          (plan.kind==='license'?'· pago único · hasta '+G.esc(plan.groups||10)+' grupos':'/ '+G.esc(plan.days)+' días por grupo') +
          '</small></div>' +
          (plan.save ? '<div class="plan-save">' + G.esc(plan.save) + "</div>" : "") +
          '<div class="plan-save muted" style="color:var(--muted);font-weight:500">' +
          G.esc(plan.perDay) +
          "</div>" +
          '<ul class="plan-features">' +
          (plan.id==='pro'?['Licencia permanente · diez cupos reasignables','Todo Premium en los grupos asignados','Horarios y respuestas por frases','Notas enriquecidas, temas e importación']:plan.id==='ultra'?['Funciones Pro para el grupo suscrito','Alianzas GBot y revisión local','Perfiles compartidos con vista previa','Observación y simulador']:['5.000 acciones/día','50 comandos y 100 notas','Antirraids y bloqueos por contenido','Confianza y caducidad de advertencias','Multimedia, registros y exportación'])
            .map((feature) => "<li>" + G.icon("i-check") + G.esc(feature) + "</li>")
            .join("") +
          "</ul>" +
          '<button class="btn ' +
          (plan.popular ? "btn-primary" : "btn-secondary") +
          ' btn-block" type="button" data-action="buy-plan" data-plan-id="' +
          G.esc(plan.id) +
          '">' +
          G.icon("i-star") +
          (plan.kind==='license'?' Comprar licencia ':(active ? ' Contratar / ampliar ' : ' Activar ')) +
          G.esc(plan.label) +
          "</button></div>",
      )
      .join("");

    const perksHtml = perks
      .map(
        (perk) =>
          '<div class="perk"><span class="perk-emoji">' +
          G.esc(perk.emoji) +
          '</span><div><div class="perk-title">' +
          G.esc(perk.title) +
          '</div><div class="perk-desc">' +
          G.esc(perk.description) +
          "</div></div></div>",
      )
      .join("");

    const paymentsHtml = payments.length
      ? payments
          .map(
            (payment) =>
              '<div class="payment-row"><div class="payment-main"><div class="payment-title">' +
              G.esc(payment.planLabel || payment.plan || "Premium") +
              '</div><div class="payment-sub">' +
              G.fmtDateTime(payment.createdAt) +
              " · " +
              (payment.plan==='pro'?'Licencia permanente · 10 cupos':G.esc(payment.days||0)+' días') +
              '</div></div>' +
              '<div class="payment-amount">' +
              G.fmtInt(payment.amount) +
              " ⭐</div></div>",
          )
          .join("")
      : G.empty("i-credit-card", "Sin pagos todavía", "Cuando actives Premium verás aquí tu historial.");

    box.innerHTML =
      '<section class="premium-hero"><div class="premium-crown">' +
      G.icon("i-crown") +
      '</div><div class="premium-title">GBot Ultra Premium</div>' +
      '<div class="premium-sub">Desbloquea todo el potencial de tu grupo: protección avanzada, estadísticas completas y hasta 5.000 acciones al día.</div>' +
      '<div class="premium-status"><span class="badge ' +
      (active ? "badge-premium" : "badge-muted") +
      '">' +
      G.icon(active ? "i-crown" : "i-shield") +
      " " +
      (state.bootstrap.access?.owner?'Configuración':active?(status.until?"Activo · " + G.esc(status.daysLeft) + " días restantes":'Pro permanente'):'Plan gratuito') +
      "</span>" +
      (active && status.until
        ? '<span class="badge badge-muted">Hasta ' + G.esc(G.fmtDate(status.until)) + "</span>"
        : "") +
      "</div></section>" +
      '<section class="section"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-star") +
      " Elige tu plan</div><div class=\"section-subtitle\">Pago seguro con Telegram Stars · sin renovación automática</div></div></div>" +
      '<div class="plan-grid">' +
      planCards +
      "</div></section>" +
      '<section class="section"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-gift") +
      " Funciones comunes de los planes de pago</div><div class=\"section-subtitle\">Más capacidad para administrar tus grupos</div></div></div>" +
      '<div class="perks-grid">' +
      perksHtml +
      "</div></section>" +
      '<section class="section"><div class="grid-2"><div class="card"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-key") +
      " Canjear código</div><div class=\"section-subtitle\">Si tienes un código Premium, canjéalo aquí</div></div></div>" +
      '<form data-form="redeem"><div class="field"><label class="field-label" for="redeem-code">Código</label>' +
      '<input class="input" id="redeem-code" name="code" placeholder="GBOT-XXXX-XXXX" maxlength="64" autocomplete="off" required />' +
      (state.demo ? '<span class="hint">En la demo puedes usar <b>GBOT-DEMO</b>.</span>' : "") +
      '</div><div class="form-actions"><button class="btn btn-primary btn-block" type="submit">' +
      G.icon("i-gift") +
      " Canjear código</button></div></form></div>" +
      '<div class="card"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-download") +
      " Exportar datos</div><div class=\"section-subtitle\">Descarga un JSON con estadísticas, miembros y moderación</div></div></div>" +
      (active
        ? '<button class="btn btn-secondary btn-block" type="button" data-action="export">' +
          G.icon("i-download") +
          " Descargar exportación</button>"
        : '<button class="btn btn-warning btn-block" type="button" data-action="go-premium">' +
          G.icon("i-crown") +
          " Disponible con Premium</button>") +
      "</div></div></section>" +
      '<section class="section"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-credit-card") +
      " Historial de pagos</div><div class=\"section-subtitle\">Tus compras con Telegram Stars</div></div></div>" +
      '<div class="card card-flush"><div class="list">' +
      paymentsHtml +
      "</div></div></section>" +
      '<section class="section"><div class="section-header"><div><div class="section-title">' +
      G.icon("i-info") +
      " Comparativa</div><div class=\"section-subtitle\">Gratis vs. GBot Ultra Premium</div></div></div>" +
      '<div class="card"><table class="compare-table"><thead><tr><th>Función</th><th>Gratis</th><th>Premium</th></tr></thead><tbody>' +
      [
        ["Acciones de moderación/día", "200", "5.000"],
        ["Comandos personalizados", "3", "50"],
        ["Notas guardadas", "5", "100"],
        ["Bienvenidas multimedia", "—", "Sí"],
        ["Captcha matemático", "—", "Sí"],
        ["Antienlaces avanzado", "—", "Sí"],
        ["Canal de logs", "—", "Sí"],
        ["Exportación JSON", "—", "Sí"],
        ["Aprobación automática", "—", "Sí"],
      ]
        .map(
          (row) =>
            "<tr><td>" +
            G.esc(row[0]) +
            '</td><td class="no">' +
            G.esc(row[1]) +
            '</td><td class="yes">' +
            G.esc(row[2]) +
            "</td></tr>",
        )
        .join("") +
      "</tbody></table></div></section>";
    G.updateHeader();
  };

  G.openPremiumPrompt = function openPremiumPrompt(feature) {
    G.openSheet({
      title: "Función Premium",
      subtitle: "Desbloquea GBot Ultra Premium",
      body:
        '<div class="premium-crown" style="margin-bottom:12px">' +
        G.icon("i-crown") +
        "</div>" +
        '<div class="empty-title">' +
        G.esc(feature || "Esta función") +
        " requiere Premium</div>" +
        '<div class="empty-text" style="margin:6px auto 0">Mejora el grupo para acceder a bienvenidas multimedia, captcha matemático, logs, exportación y 5.000 acciones diarias.</div>' +
        '<div class="sheet-actions"><button class="btn btn-secondary" type="button" data-action="close-sheet">Ahora no</button>' +
        '<button class="btn btn-primary" type="button" data-action="go-premium">' +
        G.icon("i-crown") +
        " Ver planes</button></div>",
    });
  };

  function openDemoPayment(planId) {
    const plans = (state.premium && state.premium.plans) || state.bootstrap.plans || [];
    const plan = plans.find((item) => item.id === planId);
    if (!plan) return;
    G.openSheet({
      title: "Pago simulado",
      subtitle: "Modo demostración",
      body:
        '<div class="premium-crown">' +
        G.icon("i-crown") +
        "</div>" +
        '<div class="empty-title">' +
        G.esc(plan.label) +
        " · " +
        G.fmtInt(plan.stars) +
        " ⭐</div>" +
        '<div class="empty-text" style="margin:6px auto 0">Esta es una demostración. No se realizará ningún cobro real. ' + (plan.kind==='license'?'Se añadirán diez cupos de ejemplo para asignar desde Premium.':'El plan se activará en este grupo de prueba.') + '</div>' +
        '<div class="sheet-actions"><button class="btn btn-secondary" type="button" data-action="close-sheet">Cancelar</button>' +
        '<button class="btn btn-primary" type="button" data-action="confirm-demo-pay" data-plan-id="' +
        G.esc(plan.id) +
        '">' +
        G.icon("i-star") +
        " Simular pago</button></div>",
    });
  }

  G.buyPlan = async function buyPlan(planId) {
    if (state.demo) {
      openDemoPayment(planId);
      return;
    }
    const data = await G.api.post("/api/premium/invoice", {
      chatId: state.chat.id,
      planId,
    });
    if (data.demo) {
      openDemoPayment(planId);
      return;
    }
    if (G.tg && typeof G.tg.openInvoice === "function") {
      G.tg.openInvoice(data.url, (status) => {
        if (status === "paid") {
          G.toast("Pago recibido. Activando Premium…", "success");
          setTimeout(async () => {
            try {
              await G.loadBootstrap({ silent: true });
              await G.loadPremium();
              G.updateHeader();
            } catch {
              // El siguiente refresco manual actualizará el estado.
            }
          }, 2400);
        } else if (status === "cancelled") {
          G.toast("Pago cancelado.", "error");
        } else if (status === "failed") {
          G.toast("El pago no se pudo completar.", "error");
        }
      });
      return;
    }
    window.open(data.url, "_blank", "noopener");
    G.toast("Abre la factura y paga con Telegram Stars.", "success");
  };

  G.confirmDemoPay = async function confirmDemoPay(planId) {
    try {
      G.demoActivatePlan(state.chat.id, planId);
      G.closeSheet();
      await G.loadBootstrap({ silent: true });
      await G.loadPremium();
      G.renderPremium();
      G.toast(planId==='pro'?'Diez cupos Pro de ejemplo añadidos.':'Plan activado en el grupo de demostración.', "success");
    } catch (error) {
      G.toast(error.message || "No se pudo activar Premium.", "error");
    }
  };

  G.submitRedeem = async function submitRedeem(form) {
    const data = new FormData(form);
    const code = String(data.get("code") || "").trim();
    if (!code) throw new Error("Escribe un código.");
    const result = await G.api.post("/api/premium/redeem", {
      chatId: state.chat.id,
      code,
    });
    form.reset();
    G.toast(result.message || "Código canjeado.", "success");
    await G.loadBootstrap({ silent: true });
    await G.loadPremium();
    G.renderPremium();
  };

  G.exportData = async function exportData() {
    if (!isPremium()) {
      G.openPremiumPrompt("La exportación de datos");
      return;
    }
    try {
      const blob = await G.api.blob("/api/export?chat_id=" + encodeURIComponent(state.chat.id));
      const filename = "gbot-export-" + state.chat.id + "-" + new Date().toISOString().slice(0, 10) + ".json";
      G.downloadBlob(blob, filename);
      G.toast("Exportación descargada.", "success");
    } catch (error) {
      if (error.status === 402) G.openPremiumPrompt("La exportación de datos");
      else throw error;
    }
  };

  // ------------------------------------------------------------
  //  Perfil, selector de grupo y miembros
  // ------------------------------------------------------------

  G.openProfile = function openProfile() {
    const b = state.bootstrap;
    if (!b) return;
    const user = b.user;
    G.openSheet({
      title: "Tu perfil",
      subtitle: "Sesión de Telegram",
      body:
        '<div class="row" style="gap:14px;margin-bottom:14px">' +
        G.avatar(user, "avatar-lg") +
        '<div class="grow"><div class="sheet-title">' +
        G.esc([user.firstName, user.lastName].filter(Boolean).join(" ")) +
        "</div><div class=\"sheet-sub\">" +
        (user.username ? "@" + G.esc(user.username) : "Sin usuario") +
        "</div><div class=\"member-badges mt-8\">" +
        '<span class="badge badge-muted">ID ' +
        G.esc(user.id) +
        "</span>" +
        (state.demo ? '<span class="badge badge-warn">DEMO</span>' : "") +
        (user.dev ? '<span class="badge badge-warn">DEV</span>' : "") +
        
        "</div></div></div>" +
        '<div class="hint" style="margin-bottom:10px">ID de Telegram: <b class="mono">' +
        G.esc(user.id) +
        "</b> · Grupos visibles: <b>" +
        G.fmtInt(state.chats.length) +
        "</b></div>" +
        '<div class="divider"></div>' +
        '<div class="list">' +
        '<div class="list-item"><span class="toggle-icon">' +
        G.icon("i-shield") +
        '</span><div class="list-item-main"><div class="list-item-title">Autenticación</div><div class="list-item-sub">' +
        (state.demo ? "Datos simulados de demostración" : "Verificada con Telegram initData") +
        "</div></div></div>" +
        '<div class="list-item"><span class="toggle-icon">' +
        G.icon("i-users") +
        '</span><div class="list-item-main"><div class="list-item-title">Grupo actual</div><div class="list-item-sub">' +
        G.esc(b.chat.title) +
        "</div></div></div></div>" +
        '<div class="sheet-actions"><button class="btn btn-secondary" type="button" data-action="open-bot">' +
        G.icon("i-send") +
        " Abrir bot</button>" +
        '<button class="btn btn-primary" type="button" data-action="refresh">' +
        G.icon("i-refresh") +
        " Actualizar</button></div>",
    });
  };

  G.openChatPicker = function openChatPicker() {
    if (!state.chats.length) return;
    const options = state.chats
      .map(
        (chat) =>
          '<button class="chat-option" type="button" data-action="switch-chat" data-chat-id="' +
          chat.id +
          '">' +
          '<span class="chat-switcher-avatar" style="background:' +
          G.avatarGradient(chat.id) +
          ';width:38px;height:38px;border-radius:12px;font-size:12px">' +
          '<span class="avatar-fallback">'+G.esc(G.initials(chat.title))+'</span>' +
          (chat.photoUrl?'<img class="avatar-img" src="'+G.esc(chat.photoUrl)+'" alt="" loading="lazy" data-avatar>':'') +
          "</span>" +
          '<div class="chat-option-main"><div class="chat-option-title">' +
          G.esc(chat.title) +
          "</div><div class=\"chat-option-sub\">" +
          (chat.memberCount != null ? G.fmtInt(chat.memberCount) + " miembros · " : "") +
          (chat.premium && chat.premium.active ? "Premium" : "Plan gratis") +
          "</div></div>" +
          (state.chat && state.chat.id === chat.id
            ? '<span class="badge badge-admin">Actual</span>'
            : chat.premium && chat.premium.active
              ? '<span class="badge badge-premium">' + G.icon("i-crown") + " Premium</span>"
              : "") +
          "</button>",
      )
      .join("");
    G.openSheet({
      title: "Tus grupos",
      subtitle: "Elige el grupo que quieres administrar",
      body:
        '<div class="list">' +
        options +
        "</div>" +
        '<div class="divider"></div>' +
        '<button class="btn btn-secondary btn-block" type="button" data-action="open-bot">' +
        G.icon("i-plus") +
        " Añadir el bot a otro grupo</button>",
    });
  };

  G.openMemberSheet = async function openMemberSheet(userId) {
    const chatId = state.chat.id;
    const requestId = (state.memberRequestId || 0) + 1;
    state.memberRequestId = requestId;
    G.openSheet({
      title: "Cargando miembro…",
      body:
        '<div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div>',
    });
    const sheetVersion = state.sheetVersion;
    try {
      const data = await G.api.get(
        "/api/members/" + encodeURIComponent(userId) + "?chat_id=" + encodeURIComponent(state.chat.id),
      );
      if (requestId !== state.memberRequestId || state.chat?.id !== chatId || sheetVersion !== state.sheetVersion || !state.sheetOpen) return;
      state.memberDetail = data;
      G.renderMemberSheet(data);
    } catch (error) {
      if (requestId !== state.memberRequestId || state.chat?.id !== chatId) return;
      G.closeSheet();
      throw error;
    }
  };

  G.renderMemberSheet = function renderMemberSheet(data) {
    const member = data.member;
    const warnings = data.warnings || [];
    const recent = data.recentActions || [];
    const self = state.bootstrap && state.bootstrap.user && member.id === state.bootstrap.user.id;
    const creator = member.status === "creator";
    const restricted = member.status === "restricted";
    const gone = member.status === "kicked" || member.status === "left";
    const admin = isAdminStatus(member.status);
    const actions = [];

    if (!self && !admin && !gone) {
      actions.push(
        '<button class="action-btn warn" type="button" data-action="mod-action" data-mod-action="warn" data-user-id="' +
          member.id +
          '">' +
          G.icon("i-alert-triangle") +
          "Advertir</button>",
      );
    }
    if (!self && !admin) {
      if (restricted) {
        actions.push(
          '<button class="action-btn success" type="button" data-action="mod-action" data-mod-action="unmute" data-user-id="' +
            member.id +
            '">' +
            G.icon("i-volume-2") +
            "Desilenciar</button>",
        );
      } else if (!gone) {
        actions.push(
          '<button class="action-btn warn" type="button" data-action="mod-action" data-mod-action="mute" data-user-id="' +
            member.id +
            '">' +
            G.icon("i-mic-off") +
            "Silenciar</button>",
        );
      }
    }
    if (!self && !admin) {
      if (gone) {
        actions.push(
          '<button class="action-btn success" type="button" data-action="mod-action" data-mod-action="unban" data-user-id="' +
            member.id +
            '">' +
            G.icon("i-user-check") +
            "Desbanear</button>",
        );
      } else {
        actions.push(
          '<button class="action-btn danger" type="button" data-action="mod-action" data-mod-action="ban" data-user-id="' +
            member.id +
            '">' +
            G.icon("i-ban") +
            "Banear</button>",
        );
      }
    }
    if (!self && !admin && !gone) {
      actions.push(
        '<button class="action-btn danger" type="button" data-action="mod-action" data-mod-action="kick" data-user-id="' +
          member.id +
          '">' +
          G.icon("i-user-x") +
          "Expulsar</button>",
      );
    }
    if (!self && !creator) {
      if (admin) {
        actions.push(
          '<button class="action-btn info" type="button" data-action="mod-action" data-mod-action="demote" data-user-id="' +
            member.id +
            '">' +
            G.icon("i-user-minus") +
            "Degradar</button>",
        );
      } else {
        actions.push(
          '<button class="action-btn purple" type="button" data-action="mod-action" data-mod-action="promote" data-user-id="' +
            member.id +
            '">' +
            G.icon("i-user-check") +
            "Promover</button>",
        );
      }
    }

    const warningsHtml = warnings.length
      ? warnings
          .map(
            (warning) =>
              '<div class="content-item"><div class="content-item-main"><div class="content-item-name">' +
              G.esc(warning.reason || "Sin motivo") +
              '</div><div class="content-item-text">' +
              G.fmtDateTime(warning.createdAt) +
              (warning.active===false?' · Histórica':warning.expiresAt?' · Vence '+G.fmtDateTime(warning.expiresAt):'') +
              "</div></div></div>",
          )
          .join("")
      : '<div class="hint">Sin advertencias activas.</div>';

    const recentHtml = recent.length
      ? recent.map(logRow).join("")
      : '<div class="hint" style="padding:8px">Sin acciones recientes.</div>';

    G.openSheet({
      title: memberName(member),
      subtitle: (member.roleLabel ? member.roleLabel + " · " : "") + (member.username ? "@" + member.username + " · " : "") + "ID " + member.id,
      body:
        '<div class="row" style="gap:14px;margin-bottom:12px">' +
        G.avatar(member, "avatar-lg") +
        '<div class="grow"><div class="member-badges">' +
        G.statusBadge(member) +
        (member.customTitle ? '<span class="badge badge-muted">' + G.esc(member.customTitle) + "</span>" : "") +
        "</div>" +
        '<div class="sheet-sub mt-8">' +
        (member.username ? "@" + G.esc(member.username) : "Sin nombre de usuario") +
        "</div></div></div>" +
        '<div class="sheet-stats">' +
        '<div class="sheet-stat"><div class="sheet-stat-value">' +
        G.fmtInt(member.messages) +
        '</div><div class="sheet-stat-label">Mensajes</div></div>' +
        '<div class="sheet-stat"><div class="sheet-stat-value">' +
        G.fmtInt(member.warns) +
        '</div><div class="sheet-stat-label">Warns</div></div>' +
        '<div class="sheet-stat"><div class="sheet-stat-value">' +
        (member.status === "restricted" ? "Mute" : gone ? "Fuera" : admin ? "Admin" : "Activo") +
        '</div><div class="sheet-stat-label">Estado</div></div></div>' +
        (self ? '<div class="hint" style="margin-bottom:10px">Este eres tú. No puedes aplicar acciones de moderación sobre tu propia cuenta.</div>' : "") +
        (creator ? '<div class="hint" style="margin-bottom:10px">El creador del grupo no puede ser moderado desde el panel.</div>' : "") +
        '<div class="action-grid">' +
        (actions.length ? actions.map(html => {
          const action = html.match(/data-mod-action="([a-z]+)"/)?.[1];
          return action && !G.canModerate(action) ? html.replace('<button ', '<button disabled title="Revisa tus permisos y los del bot" ') : html;
        }).join("") : '<div class="hint" style="grid-column:1/-1">No hay acciones disponibles.</div>') +
        "</div>" +
        '<div class="divider"></div>' +
        '<div class="section-header"><div><div class="section-title">Advertencias</div></div>' +
        (warnings.length
          ? '<button class="section-action" type="button" data-action="clear-warnings" data-user-id="' +
            member.id +
            '">Limpiar</button>'
          : "") +
        "</div>" +
        '<div class="card" style="padding:10px;background:var(--hover);box-shadow:none">' +
        warningsHtml +
        "</div>" +
        '<div class="section-header mt-16"><div><div class="section-title">Actividad reciente</div></div></div>' +
        '<div class="list">' +
        recentHtml +
        "</div>" +
        '<div class="hint mt-12">' +
        (member.joinedAt ? "Se unió el " + G.fmtDate(member.joinedAt) : "") +
        (member.lastSeenAt ? " · Última actividad: " + G.fmtDate(member.lastSeenAt) : "") +
        "</div>",
    });
  };

  G.openModerationSheet = function openModerationSheet(action, userId) {
    const detail = state.memberDetail && state.memberDetail.member;
    const member =
      (detail && Number(detail.id) === Number(userId) ? detail : null) ||
      state.members.items.find((item) => Number(item.id) === Number(userId));
    if (!member) {
      G.toast("No se encontró el miembro.", "error");
      return;
    }
    const labels = {
      ban: "Banear",
      unban: "Desbanear",
      kick: "Expulsar",
      mute: "Silenciar",
      unmute: "Quitar silencio",
      warn: "Advertir",
      promote: "Promover",
      demote: "Degradar",
    };
    const descriptions = {
      ban: "El usuario no podrá volver a entrar hasta que se le desbanee.",
      unban: "El usuario podrá volver a unirse al grupo.",
      kick: "El usuario saldrá del grupo, pero podrá volver a entrar.",
      mute: "El usuario no podrá enviar mensajes durante el tiempo indicado.",
      unmute: "El usuario recuperará todos los permisos de escritura.",
      warn: "Se añadirá una advertencia al historial del usuario.",
      promote: "El usuario recibirá permisos de administración.",
      demote: "El usuario perderá los permisos de administración.",
    };
    const tone = ["ban", "kick"].includes(action) ? "danger" : action === "warn" || action === "mute" ? "warning" : action === "promote" ? "success" : "secondary";
    const duration =
      action === "ban" || action === "mute"
        ? '<div class="field"><label class="field-label" for="mod-duration">Duración</label><select class="select" id="mod-duration" name="durationSeconds">' +
          '<option value="3600">1 hora</option><option value="21600">6 horas</option><option value="86400">24 horas</option>' +
          '<option value="604800">7 días</option><option value="2592000">30 días</option>' +
          (action === "ban" ? '<option value="0">Permanente</option>' : '<option value="0">Permanente</option>') +
          "</select></div>"
        : "";
    const preset =
      action === "promote"
        ? '<div class="field"><label class="field-label" for="mod-preset">Permisos</label><select class="select" id="mod-preset" name="preset">' +
          '<option value="moderator">Moderador</option><option value="full">Administrador completo</option></select></div>'
        : "";
    G.openSheet({
      title: labels[action] + " a " + memberName(member),
      subtitle: descriptions[action],
      body:
        '<form data-form="moderation" data-mod-action="' +
        G.esc(action) +
        '" data-user-id="' +
        member.id +
        '">' +
        '<div class="field"><label class="field-label" for="mod-reason">Motivo (opcional)</label>' +
        '<textarea class="textarea" id="mod-reason" name="reason" maxlength="500" placeholder="Explica brevemente el motivo…"></textarea></div>' +
        duration +
        preset +
        '<div class="sheet-actions"><button class="btn btn-secondary" type="button" data-action="close-sheet">Cancelar</button>' +
        '<button class="btn btn-' +
        tone +
        '" type="submit">' +
        G.icon("i-shield") +
        " " +
        labels[action] +
        "</button></div></form>",
    });
  };

  G.submitModeration = async function submitModeration(form) {
    const data = new FormData(form);
    const action = form.dataset.modAction;
    const body = {
      chatId: state.chat.id,
      action,
      userId: Number(form.dataset.userId),
      reason: String(data.get("reason") || "").trim() || undefined,
    };
    const duration = data.get("durationSeconds");
    if (duration != null) body.durationSeconds = Number(duration);
    const preset = data.get("preset");
    if (preset) body.preset = String(preset);
    const result = await G.api.post("/api/moderation", body);
    if (state.chat?.id !== body.chatId) return;
    G.closeSheet();
    G.toast(result.message || "Acción aplicada.", "success");
    await refreshAfterAction();
  };

  G.clearWarnings = function clearWarnings(userId) {
    const chatId = state.chat.id;
    const detail = state.memberDetail && state.memberDetail.member;
    const name = detail ? memberName(detail) : "este usuario";
    G.openConfirm({
      title: "Limpiar advertencias",
      heading: "¿Borrar las advertencias?",
      text: "Se eliminarán todas las advertencias de " + name + ". Esta acción no se puede deshacer.",
      confirmText: "Borrar advertencias",
      icon: "i-check-circle",
      tone: "success",
      onConfirm: async () => {
        const result = await G.api.post("/api/warnings/clear", {
          chatId,
          userId: Number(userId),
        });
        if (state.chat?.id !== chatId) return;
        G.closeSheet();
        G.toast(result.message || "Advertencias borradas.", "success");
        await refreshAfterAction();
      },
    });
  };

  G.lockGroup = function lockGroup(action) {
    const chatId = state.chat.id;
    const closing = action === "lock";
    G.openConfirm({
      title: closing ? "Cerrar grupo" : "Abrir grupo",
      heading: closing ? "¿Cerrar el grupo?" : "¿Abrir el grupo?",
      text: closing
        ? "Solo los administradores podrán enviar mensajes hasta que vuelvas a abrirlo."
        : "Se restaurarán los permisos que tenía el grupo antes del cierre realizado por GBot.",
      confirmText: closing ? "Cerrar grupo" : "Abrir grupo",
      icon: closing ? "i-lock" : "i-volume-2",
      tone: closing ? "danger" : "success",
      onConfirm: async () => {
        const result = await G.api.post("/api/moderation", {
          chatId,
          action,
        });
        if (state.chat?.id !== chatId) return;
        G.closeSheet();
        G.toast(result.message || (closing ? "Grupo cerrado." : "Grupo abierto."), "success");
        await refreshAfterAction();
      },
    });
  };

  async function refreshAfterAction() {
    await G.loadBootstrap({ silent: true });
    if (state.tab === "members") await G.loadMembers(false);
    else if (state.tab === "moderation") await G.loadLogs(false);
    else if (state.tab === "premium") await G.loadPremium();
  }

  // ------------------------------------------------------------
  //  Acciones y formularios
  // ------------------------------------------------------------

  G.registerAction("tab", (target) => G.switchTab(target.dataset.tab));
  G.registerAction("chats", () => G.openChatPicker());
  G.registerAction("profile", () => G.openProfile());
  G.registerAction("switch-chat", (target) => G.switchChat(Number(target.dataset.chatId)));
  G.registerAction("member-open", (target) => G.openMemberSheet(Number(target.dataset.userId)));
  G.registerAction("member-filter", (target) => {
    state.members.filter = target.dataset.filter;
    return G.loadMembers(false);
  });
  G.registerAction("member-clear", () => {
    state.members.query = "";
    state.members.focusSearch = true;
    G.loadMembers(false).catch((error) => G.toast(error.message, "error"));
  });
  G.registerAction("load-more-members", () => G.loadMembers(true));
  G.registerAction("chart-range", (target) => G.setChartRange(Number(target.dataset.days)));
  G.registerAction("log-filter", (target) => {
    state.logs.action = target.dataset.filter;
    state.logs.loaded = false;
    G.loadLogs(false).catch((error) => G.toast(error.message, "error"));
  });
  G.registerAction("load-more-logs", () => G.loadLogs(true));
  G.registerAction("moderate-member", () => {
    G.switchTab("members");
    state.members.focusSearch = true;
    setTimeout(() => {
      const input = document.getElementById("member-search");
      if (input) input.focus();
    }, 120);
  });
  G.registerAction("lock-group", () => G.lockGroup("lock"));
  G.registerAction("unlock-group", () => G.lockGroup("unlock"));
  G.registerAction("mod-action", (target) => G.openModerationSheet(target.dataset.modAction, Number(target.dataset.userId)));
  G.registerAction("clear-warnings", (target) => G.clearWarnings(Number(target.dataset.userId)));
  G.registerAction("buy-plan", (target) => G.buyPlan(target.dataset.planId));
  G.registerAction("confirm-demo-pay", (target) => G.confirmDemoPay(target.dataset.planId));
  G.registerAction("export", () => G.exportData());
  G.registerAction("go-premium", () => {
    G.closeSheet();
    G.switchTab("premium");
  });

  G.registerForm("redeem", (form) => G.submitRedeem(form));
  G.registerForm("moderation", (form) => G.submitModeration(form));
})();
