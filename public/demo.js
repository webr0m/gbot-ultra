/* ============================================================
   GBot Ultra · datos y API simulada para ?demo=1
   ============================================================ */

(() => {
  "use strict";

  const G = window.GBot;
  if (!G) return;

  const PLANS = [
    {id:'pro',label:'Pro permanente · 10 grupos',kind:'license',tier:'pro',groups:10,days:0,stars:135,perDay:'Pago único',emoji:'🚀'},
    {id:'ultra',label:'Ultra · 30 días / grupo',kind:'subscription',tier:'ultra',groups:1,days:30,stars:135,perDay:'4,5 ⭐/día',emoji:'👑'},
    {
      id: "monthly",
      label: "1 mes",
      days: 30,
      stars: 50,
      perDay: "1,7 ⭐/día",
      save: null,
      popular: true,
      emoji: "🌙",
    },
    {
      id: "quarterly",
      label: "3 meses",
      days: 90,
      stars: 129,
      perDay: "1,4 ⭐/día",
      save: "Ahorra 14 %",
      popular: false,
      emoji: "🚀",
    },
    {
      id: "yearly",
      label: "12 meses",
      days: 365,
      stars: 399,
      perDay: "1,1 ⭐/día",
      save: "Ahorra 34 %",
      popular: false,
      emoji: "👑",
    },
  ];

  const PERKS = [
    { emoji: "🖼️", title: "Bienvenidas con multimedia", description: "Foto, vídeo, GIF o documento en la bienvenida." },
    { emoji: "🤖", title: "Captcha matemático", description: "Verificación más difícil de saltar por bots." },
    { emoji: "🔗", title: "Antienlaces avanzado", description: "Silenciar o banear y lista blanca de dominios." },
    { emoji: "📋", title: "Canal de registros", description: "Envía toda la moderación a un canal privado." },
    { emoji: "⚡", title: "5.000 acciones/día", description: "25 veces más acciones de moderación que el plan gratis." },
    { emoji: "📊", title: "Exportación de estadísticas", description: "Descarga todos los datos del grupo en JSON." },
    { emoji: "🧩", title: "Comandos ilimitados", description: "Hasta 50 comandos personalizados y 100 notas." },
    { emoji: "✅", title: "Solicitudes automáticas", description: "Aprueba automáticamente las solicitudes de entrada." },
    { emoji: "🧹", title: "Bienvenida autolimpiable", description: "Elimina el mensaje de bienvenida tras X segundos." },
    { emoji: "🛟", title: "Soporte prioritario", description: "Atención preferente del equipo de GBot Ultra." },
  ];

  const USER = {
    id: 10001,
    firstName: "Alex",
    lastName: "Ríos",
    username: "alexr",
    displayName: "Alex Ríos",
    languageCode: "es",
    avatarUrl: null,
    dev: false,
  };

  const STATUS_LABELS = {
    creator: "Creador",
    administrator: "Administrador",
    restricted: "Restringido",
    left: "Salió",
    kicked: "Expulsado",
    member: "Miembro",
  };

  const store = {
    proSlots: 0,
    proGroups: [],
    chats: [],
    nextWarningId: 900,
    nextLogId: 7000,
    nextPaymentId: 500,
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isoOffset(days, hours) {
    return new Date(
      Date.now() + Number(days || 0) * 86400000 + Number(hours || 0) * 3600000,
    ).toISOString();
  }

  function dayKey(offset) {
    const date = new Date(Date.now() + offset * 86400000);
    return date.toISOString().slice(0, 10);
  }

  function planLabel(planId) {
    const plan = PLANS.find((item) => item.id === planId);
    return plan ? plan.label : "Premium";
  }

  function premiumState(planId, days, offsetDays) {
    if (!planId) {
      return { active: false, plan: null, planLabel: "Premium", until: null, daysLeft: 0 };
    }
    return {
      active: true,
      plan: planId,
      planLabel: planLabel(planId),
      until: isoOffset(offsetDays == null ? days : offsetDays),
      daysLeft: Math.max(1, days),
    };
  }

  function makeSettings(kind) {
    const premium = kind !== "free";
    return {
      welcome: {
        enabled: true,
        text:
          "👋 ¡Bienvenido/a, {mention}!\n\n" +
          "Ya eres parte de <b>{chat}</b>. Lee las normas, preséntate y disfruta de la comunidad.",
        media: null,
        deleteAfter: premium ? 45 : 0,
      },
      goodbye: {
        enabled: true,
        text: "👋 {name} ha salido del grupo. ¡Hasta pronto!",
      },
      rules: {
        enabled: true,
        text:
          "<b>Normas de la comunidad</b>\n\n" +
          "1. Respeta a todos los miembros.\n" +
          "2. Nada de spam, publicidad ni enlaces sin permiso.\n" +
          "3. Usa los temas y comandos adecuados.\n" +
          "4. Los administradores pueden moderar para mantener el orden.",
        button: true,
      },
      captcha: {
        enabled: true,
        mode: premium ? "math" : "button",
        timeoutSeconds: 300,
      },
      antilink: {
        enabled: true,
        action: premium ? "mute" : "delete",
        muteSeconds: 600,
        whitelist: premium ? ["telegram.org", "github.com"] : [],
      },
      antiflood: {
        enabled: true,
        limit: premium ? 6 : 8,
        windowSeconds: 10,
        muteSeconds: 600,
      },
      blacklist: { enabled: true, action: "warn" },
      warnings: {
        enabled: true,
        limit: 3,
        action: "mute",
        muteSeconds: 3600,
      },
      reports: { enabled: true },
      logs: {
        enabled: premium,
        chatId: premium ? -1001234567000 : null,
      },
      serviceMessages: { deleteJoins: true },
      joinRequests: { autoApprove: premium },
      language: "es",
    };
  }

  function makeChart(base, wave) {
    const points = [];
    for (let index = 29; index >= 0; index -= 1) {
      const date = dayKey(-index);
      const factor = 0.68 + Math.sin((29 - index + wave) / 2.7) * 0.18;
      const messages = Math.max(8, Math.round(base * factor));
      points.push({
        date,
        label: date.slice(8, 10),
        messages,
        joins: Math.max(1, Math.round(messages * 0.045 + ((29 - index + wave) % 4))),
        leaves: Math.max(0, Math.round(messages * 0.012)),
      });
    }
    return points;
  }

  function makeMembers() {
    const people = [
      [10001, "Alex", "Ríos", "alexr", "creator", 0, 1240, "Fundador", false],
      [1002, "Lucía", "Fernández", "luciaf", "administrator", 0, 982, "Moderación", false],
      [1003, "Marco", "Antonio", "marcoa", "administrator", 0, 760, "Soporte", false],
      [1004, "Sofía", "Martínez", "sofiam", "member", 0, 644, null, false],
      [1005, "Diego", "López", "diegol", "restricted", 2, 321, null, false],
      [1006, "Valeria", "Gómez", "valeriag", "member", 1, 598, null, false],
      [1007, "Javier", "Ruiz", "javierr", "member", 0, 455, null, false],
      [1008, "Carmen", "Díaz", "carmend", "member", 0, 410, null, false],
      [1009, "Pablo", "Sánchez", "pablos", "member", 0, 388, null, false],
      [1010, "Elena", "Torres", "elenat", "member", 0, 356, null, false],
      [10011, "GBot", "Moderador", "gbot_mod", "administrator", 0, 210, "Bot", true],
      [1012, "Nerea", "Castro", "nereac", "member", 0, 299, null, false],
      [1013, "Iván", "Romero", "ivanr", "member", 0, 250, null, false],
      [1014, "Alba", "Navarro", "alban", "restricted", 3, 180, null, false],
      [1015, "Hugo", "Ortega", "hugoo", "member", 0, 160, null, false],
      [1016, "Andrés", "Molina", "andresm", "kicked", 1, 95, null, false],
    ];

    return people.map((item, index) => ({
      id: item[0],
      firstName: item[1],
      lastName: item[2],
      username: item[3],
      displayName: (item[1] + " " + item[2]).trim(),
      status: item[4],
      statusLabel: STATUS_LABELS[item[4]] || "Miembro",
      customTitle: item[7],
      isBot: item[8],
      messages: item[6],
      warns: item[5],
      joinedAt: isoOffset(-(120 - index * 5)),
      lastSeenAt: isoOffset(-(index % 5), -(index % 7)),
      lastMessageAt: isoOffset(-(index % 4), -(index % 6)),
      avatarUrl: null,
    }));
  }

  function makeWarnings(members) {
    const rows = [];
    const reasons = [
      "Spam repetido en el chat",
      "Enlace no permitido",
      "Lenguaje inapropiado",
      "Publicidad sin permiso",
    ];
    members.forEach((member, index) => {
      for (let count = 0; count < Number(member.warns || 0); count += 1) {
        rows.push({
          id: store.nextWarningId++,
          chat_id: 0,
          user_id: member.id,
          admin_id: 1002,
          reason: reasons[(index + count) % reasons.length],
          created_at: isoOffset(-(index + count + 1), -2),
        });
      }
    });
    return rows;
  }

  function makeLogs(members) {
    const actions = ["ban", "mute", "warn", "kick", "promote", "unmute", "lock", "unlock"];
    const reasons = [
      "Incumplimiento de las normas",
      "Spam en el grupo",
      "Enlace no autorizado",
      "Conducta inapropiada",
      "Solicitud de un administrador",
    ];
    const rows = [];
    for (let index = 0; index < 24; index += 1) {
      const action = actions[index % actions.length];
      const target = members[(index + 3) % members.length];
      const actor = members[index % 3];
      rows.push({
        id: store.nextLogId++,
        action,
        reason: action === "lock" || action === "unlock" ? null : reasons[index % reasons.length],
        durationSeconds: action === "mute" ? 3600 : action === "ban" ? 0 : null,
        createdAt: isoOffset(0, -(index * 3 + 1)),
        metadata: {},
        actor: { id: actor.id, name: actor.displayName, username: actor.username },
        target: { id: target.id, name: target.displayName, username: target.username },
      });
    }
    return rows;
  }

  function makeCommands(kind) {
    const all = [
      { name: "reglas", content: "📋 Lee las normas del grupo y respétalas. ¡Gracias!", uses: 47 },
      { name: "redes", content: "🌐 Síguenos en nuestras redes: @gbotultra", uses: 18 },
      { name: "soporte", content: "🛟 ¿Necesitas ayuda? Escribe a @GroupButlerEsp_bot", uses: 12 },
      { name: "tutorial", content: "🎓 Tutorial rápido: usa /help para ver todo lo que puedo hacer.", uses: 9 },
      { name: "precios", content: "👑 Consulta los planes Premium con /premium", uses: 7 },
    ];
    return (kind === "free" ? all.slice(0, 2) : all).map((item) => ({
      chat_id: 0,
      name: item.name,
      content: item.content,
      created_by: 10001,
      uses: item.uses,
      created_at: isoOffset(-30),
    }));
  }

  function makeNotes(kind) {
    const all = [
      { name: "bienvenida", content: "👋 ¡Hola! Preséntate y cuéntanos de qué te gusta hablar.", uses: 64 },
      { name: "enlaces", content: "🔗 Los enlaces se comparten solo en el tema #recursos.", uses: 28 },
      { name: "faq", content: "❓ Preguntas frecuentes: usa /help y luego el comando que necesites.", uses: 15 },
      { name: "eventos", content: "📅 Consulta el calendario de eventos fijado en el grupo.", uses: 8 },
      { name: "normas", content: "📜 Las normas completas están en /rules.", uses: 5 },
      { name: "staff", content: "🛡️ Equipo: @alexr, @luciaf y @marcoa.", uses: 4 },
    ];
    return (kind === "free" ? all.slice(0, 3) : all).map((item) => ({
      chat_id: 0,
      name: item.name,
      content: item.content,
      created_by: 1002,
      uses: item.uses,
      created_at: isoOffset(-22),
    }));
  }

  function makeBlacklist(kind) {
    const rows = [
      { pattern: "spam", is_regex: false },
      { pattern: "http://bit.ly", is_regex: false },
      { pattern: "(?:free|gratis)[ _-]?(?:crypto|btc)", is_regex: true },
    ];
    return (kind === "free" ? rows.slice(0, 2) : rows).map((item) => ({
      chat_id: 0,
      pattern: item.pattern,
      is_regex: item.is_regex,
      created_by: 10001,
      created_at: isoOffset(-18),
    }));
  }

  function makePayments(kind) {
    if (kind === "free") return [];
    if (kind === "yearly") {
      return [
        {
          id: store.nextPaymentId++,
          amount: 399,
          currency: "XTR",
          plan: "yearly",
          planLabel: "12 meses",
          days: 365,
          createdAt: isoOffset(-185),
        },
      ];
    }
    return [
      {
        id: store.nextPaymentId++,
        amount: 50,
        currency: "XTR",
        plan: "monthly",
        planLabel: "1 mes",
        days: 30,
        createdAt: isoOffset(-7),
      },
      {
        id: store.nextPaymentId++,
        amount: 50,
        currency: "XTR",
        plan: "monthly",
        planLabel: "1 mes",
        days: 30,
        createdAt: isoOffset(-38),
      },
    ];
  }

  function buildStore() {
    const baseMembers = makeMembers();

    const chats = [
      {
        id: -1001234567890,
        title: "Comunidad GBot Ultra",
        username: "gbotultra",
        type: "supergroup",
        description:
          "La comunidad oficial de GBot Ultra. Administración, automatización y buen ambiente.",
        memberCount: 1248,
        adminCount: 5,
        botCount: 3,
        trackedMembers: 487,
        boosts: 12,
        kind: "premium",
        premium: premiumState("monthly", 23),
        settings: makeSettings("premium"),
        stats: {
          memberCount: 1248,
          adminCount: 5,
          botCount: 3,
          trackedMembers: 487,
          messagesToday: 342,
          messages7d: 2451,
          messages30d: 10422,
          messagesTotal: 83421,
          joinsToday: 18,
          joins7d: 126,
          leavesToday: 4,
          warnings: 6,
          boosts: 12,
          actionsToday: 47,
          moderationToday: 31,
          moderationTotal: 1580,
        },
        chart: makeChart(330, 2),
        members: baseMembers,
        warnings: makeWarnings(baseMembers),
        logs: makeLogs(baseMembers),
        commands: makeCommands("premium"),
        notes: makeNotes("premium"),
        blacklist: makeBlacklist("premium"),
        payments: makePayments("premium"),
        locked: false,
      },
      {
        id: -1009876543210,
        title: "Cocina Creativa",
        username: "cocina_creativa_es",
        type: "supergroup",
        description: "Recetas, trucos y comunidad para cocinar cada día mejor.",
        memberCount: 356,
        adminCount: 3,
        botCount: 1,
        trackedMembers: 142,
        boosts: 4,
        kind: "free",
        premium: premiumState(null, 0),
        settings: makeSettings("free"),
        stats: {
          memberCount: 356,
          adminCount: 3,
          botCount: 1,
          trackedMembers: 142,
          messagesToday: 86,
          messages7d: 612,
          messages30d: 2340,
          messagesTotal: 18220,
          joinsToday: 5,
          joins7d: 34,
          leavesToday: 2,
          warnings: 2,
          boosts: 4,
          actionsToday: 12,
          moderationToday: 7,
          moderationTotal: 224,
        },
        chart: makeChart(78, 7),
        members: baseMembers.slice(0, 10),
        warnings: makeWarnings(baseMembers.slice(0, 10)),
        logs: makeLogs(baseMembers.slice(0, 10)),
        commands: makeCommands("free"),
        notes: makeNotes("free"),
        blacklist: makeBlacklist("free"),
        payments: [],
        locked: false,
      },
      {
        id: -1005550001111,
        title: "Gamers España",
        username: "gamers_esp",
        type: "supergroup",
        description: "Comunidad de videojuegos, torneos y directos en español.",
        memberCount: 2874,
        adminCount: 8,
        botCount: 4,
        trackedMembers: 1032,
        boosts: 31,
        kind: "yearly",
        premium: premiumState("yearly", 180),
        settings: makeSettings("premium"),
        stats: {
          memberCount: 2874,
          adminCount: 8,
          botCount: 4,
          trackedMembers: 1032,
          messagesToday: 728,
          messages7d: 5120,
          messages30d: 22844,
          messagesTotal: 182041,
          joinsToday: 42,
          joins7d: 287,
          leavesToday: 11,
          warnings: 14,
          boosts: 31,
          actionsToday: 96,
          moderationToday: 54,
          moderationTotal: 4321,
        },
        chart: makeChart(720, 11),
        members: baseMembers,
        warnings: makeWarnings(baseMembers),
        logs: makeLogs(baseMembers),
        commands: makeCommands("premium"),
        notes: makeNotes("premium"),
        blacklist: makeBlacklist("premium"),
        payments: makePayments("yearly"),
        locked: false,
      },
    ];

    chats.forEach((chat) => {
      chat.warnings.forEach((warning) => {
        warning.chat_id = chat.id;
      });
      chat.commands.forEach((row) => {
        row.chat_id = chat.id;
      });
      chat.notes.forEach((row) => {
        row.chat_id = chat.id;
      });
      chat.blacklist.forEach((row) => {
        row.chat_id = chat.id;
      });
    });

    store.chats = chats;
  }

  buildStore();

  function chatById(chatId) {
    const chat = store.chats.find((item) => item.id === Number(chatId));
    if (!chat) throw G.makeError("Grupo no encontrado en la demo.", 404);
    return chat;
  }

  function summary(chat) {
    return {
      id: chat.id,
      title: chat.title,
      username: chat.username,
      type: chat.type,
      photoUrl: null,
      boosts: chat.boosts,
      memberCount: chat.memberCount,
      premium: clone(chat.premium),
    };
  }

  function premiumPayload(chat) {
    return clone(chat.premium);
  }

  function premiumStatus(chat) {
    return {
      active: chat.premium.active,
      plan: chat.premium.plan,
      planLabel: chat.premium.planLabel,
      until: chat.premium.until,
      daysLeft: chat.premium.daysLeft,
    };
  }

  function memberById(chat, userId) {
    return chat.members.find((item) => item.id === Number(userId));
  }

  function counts(chat) {
    const commandLimit = chat.premium.active ? 50 : 3;
    const noteLimit = chat.premium.active ? 100 : 5;
    const blacklistLimit = chat.premium.active ? 500 : 50;
    return {
      commands: { used: chat.commands.length, limit: commandLimit },
      notes: { used: chat.notes.length, limit: noteLimit },
      blacklist: { used: chat.blacklist.length, limit: blacklistLimit },
    };
  }

  function bootstrapFor(chat) {
    const limits = counts(chat);
    const actionLimit = chat.premium.active ? 5000 : 200;
    const top = chat.members
      .slice()
      .sort((left, right) => right.messages - left.messages)
      .slice(0, 5)
      .map((member) => ({
        id: member.id,
        firstName: member.firstName,
        username: member.username,
        messages: member.messages,
        avatarUrl: null,
      }));

    return {
      ok: true,
      user: clone(USER),
      chat: {
        id: chat.id,
        title: chat.title,
        username: chat.username,
        type: chat.type,
        description: chat.description,
        memberCount: chat.memberCount,
        adminCount: chat.adminCount,
        botCount: chat.botCount,
        trackedMembers: chat.trackedMembers,
        boosts: chat.boosts,
        premium: premiumPayload(chat),
      },
      stats: clone(chat.stats),
      chart: clone(chat.chart.slice(-14)),
      top,
      settings: clone(chat.settings),
      limits: {
        actions: {
          used: chat.stats.actionsToday,
          limit: actionLimit,
          remaining: Math.max(0, actionLimit - chat.stats.actionsToday),
        },
        commands: limits.commands,
        notes: limits.notes,
      },
      plans: clone(PLANS),
      perks: clone(PERKS),
      payments: clone(chat.payments.slice(0, 3)),
      logs: clone(chat.logs.slice(0, 8)),
      botRights: {
        isAdmin: true,
        can_manage_chat: true,
        can_delete_messages: true,
        can_restrict_members: true,
        can_promote_members: true,
        can_change_info: true,
        can_invite_users: true,
        can_pin_messages: true,
        can_manage_video_chats: true,
        can_manage_topics: true,
      },
      serverTime: new Date().toISOString(),
    };
  }

  function addLog(chat, action, actor, target, reason, durationSeconds) {
    const row = {
      id: store.nextLogId++,
      action,
      reason: reason || null,
      durationSeconds: durationSeconds == null ? null : Number(durationSeconds),
      createdAt: new Date().toISOString(),
      metadata: {},
      actor: actor
        ? { id: actor.id, name: actor.displayName || actor.firstName, username: actor.username }
        : null,
      target: target
        ? { id: target.id, name: target.displayName || target.firstName, username: target.username }
        : null,
    };
    chat.logs.unshift(row);
    chat.stats.actionsToday += 1;
    chat.stats.moderationToday += 1;
    chat.stats.moderationTotal += 1;
    return row;
  }

  function moderation(chat, body) {
    const action = String(body.action || "");
    const allowed = ["ban", "unban", "kick", "mute", "unmute", "warn", "promote", "demote", "lock", "unlock"];
    if (!allowed.includes(action)) throw G.makeError("Acción de moderación no válida.", 400);
    const target = body.userId ? memberById(chat, body.userId) : null;
    if (!target && action !== "lock" && action !== "unlock") {
      throw G.makeError("Ese usuario no está en el grupo.", 404);
    }

    if (action === "ban") {
      target.status = "kicked";
      target.statusLabel = STATUS_LABELS.kicked;
    } else if (action === "kick") {
      target.status = "left";
      target.statusLabel = STATUS_LABELS.left;
    } else if (action === "mute") {
      target.status = "restricted";
      target.statusLabel = STATUS_LABELS.restricted;
    } else if (action === "unmute" || action === "unban") {
      target.status = "member";
      target.statusLabel = STATUS_LABELS.member;
    } else if (action === "promote") {
      target.status = "administrator";
      target.statusLabel = STATUS_LABELS.administrator;
    } else if (action === "demote") {
      target.status = "member";
      target.statusLabel = STATUS_LABELS.member;
    } else if (action === "warn") {
      target.warns = Number(target.warns || 0) + 1;
      chat.warnings.unshift({
        id: store.nextWarningId++,
        chat_id: chat.id,
        user_id: target.id,
        admin_id: USER.id,
        reason: body.reason || "Sin motivo indicado",
        created_at: new Date().toISOString(),
      });
      chat.stats.warnings = chat.warnings.length;
    } else if (action === "lock" || action === "unlock") {
      chat.locked = action === "lock";
    }

    addLog(chat, action, USER, target, body.reason || null, body.durationSeconds);
    const labels = {
      ban: "Usuario baneado",
      unban: "Usuario desbaneado",
      kick: "Usuario expulsado",
      mute: "Usuario silenciado",
      unmute: "Usuario desilenciado",
      warn: "Advertencia añadida",
      promote: "Usuario promovido",
      demote: "Usuario degradado",
      lock: "Grupo cerrado",
      unlock: "Grupo abierto",
    };
    const limit = chat.premium.active ? 5000 : 200;
    return {
      ok: true,
      action,
      message:
        (labels[action] || action) + (target ? ": " + (target.displayName || target.firstName) + "." : "."),
      target: target
        ? { id: target.id, name: target.displayName, username: target.username }
        : null,
      gate: {
        allowed: true,
        used: chat.stats.actionsToday,
        limit,
        remaining: Math.max(0, limit - chat.stats.actionsToday),
        premium: chat.premium.active,
      },
    };
  }

  function premiumFeature(patch) {
    if (patch.welcome && patch.welcome.media) return "Bienvenida con multimedia";
    if (patch.welcome && Number(patch.welcome.deleteAfter || 0) > 0) return "Autoeliminar la bienvenida";
    if (patch.captcha && patch.captcha.mode === "math") return "Captcha matemático";
    if (patch.antilink && patch.antilink.action && patch.antilink.action !== "delete") {
      return "Acción antienlaces avanzada";
    }
    if (patch.antilink && patch.antilink.whitelist && patch.antilink.whitelist.length) {
      return "Lista blanca de enlaces";
    }
    if (patch.logs && patch.logs.enabled === true) return "Canal de registros";
    if (patch.joinRequests && patch.joinRequests.autoApprove === true) {
      return "Aprobación automática de solicitudes";
    }
    if (patch.antiflood) {
      if (patch.antiflood.limit != null && (patch.antiflood.limit < 3 || patch.antiflood.limit > 20)) {
        return "Límite de antiflood personalizado";
      }
      if (patch.antiflood.windowSeconds != null && (patch.antiflood.windowSeconds < 5 || patch.antiflood.windowSeconds > 60)) {
        return "Ventana de antiflood personalizada";
      }
      if (patch.antiflood.muteSeconds != null && patch.antiflood.muteSeconds !== 600) {
        return "Duración de silencio antiflood personalizada";
      }
    }
    return null;
  }

  function mergeSettings(current, patch) {
    const next = clone(current);
    Object.entries(patch || {}).forEach(([key, value]) => {
      if (value == null) return;
      if (typeof value === "object" && !Array.isArray(value) && next[key] && typeof next[key] === "object") {
        Object.assign(next[key], value);
      } else {
        next[key] = value;
      }
    });
    return next;
  }

  function applySettings(chat, patch) {
    const feature = premiumFeature(patch);
    if (!chat.premium.active && feature) {
      const error = G.makeError("Esta función requiere GBot Ultra Premium.", 402, {
        premiumFeature: feature,
      });
      error.premiumFeature = feature;
      throw error;
    }
    chat.settings = mergeSettings(chat.settings, patch);
    return { ok: true, settings: clone(chat.settings), premium: premiumStatus(chat) };
  }

  function contentPayload(chat) {
    return {
      ok: true,
      commands: clone(chat.commands),
      notes: clone(chat.notes),
      blacklist: clone(chat.blacklist),
      limits: counts(chat),
    };
  }

  function normalizeName(raw) {
    return String(raw || "").trim().toLowerCase().replace(/^[/!#]/, "");
  }

  function saveContent(chat, kind, body) {
    const isCommand = kind === "command";
    const isNote = kind === "note";
    if (!isCommand && !isNote) throw G.makeError("Tipo de contenido no válido.", 400);
    const name = normalizeName(body.name);
    if (!/^[a-z0-9_]{1,32}$/.test(name)) {
      throw G.makeError("El nombre solo puede contener letras, números y guiones bajos.", 400);
    }
    const content = String(body.content || "").trim();
    if (!content) throw G.makeError("El contenido no puede estar vacío.", 400);
    const list = isCommand ? chat.commands : chat.notes;
    const existing = list.find((item) => item.name === name);
    const limit = isCommand ? (chat.premium.active ? 50 : 3) : chat.premium.active ? 100 : 5;
    if (!existing && list.length >= limit) {
      throw G.makeError(
        "El plan " + (chat.premium.active ? "Premium" : "gratuito") + " permite " + limit + (isCommand ? " comandos." : " notas."),
        402,
      );
    }
    if (existing) {
      existing.content = content;
    } else {
      list.push({
        chat_id: chat.id,
        name,
        content,
        created_by: USER.id,
        uses: 0,
        created_at: new Date().toISOString(),
      });
      list.sort((left, right) => left.name.localeCompare(right.name, "es"));
    }
    return { ok: true, [isCommand ? "command" : "note"]: clone(existing || list.find((item) => item.name === name)), updated: Boolean(existing) };
  }

  function deleteContent(chat, kind, body) {
    const name = normalizeName(body.name);
    if (kind === "command") {
      const index = chat.commands.findIndex((item) => item.name === name);
      if (index < 0) throw G.makeError("Ese comando no existe.", 404);
      chat.commands.splice(index, 1);
    } else if (kind === "note") {
      const index = chat.notes.findIndex((item) => item.name === name);
      if (index < 0) throw G.makeError("Esa nota no existe.", 404);
      chat.notes.splice(index, 1);
    } else {
      throw G.makeError("Tipo de contenido no válido.", 400);
    }
    return { ok: true };
  }

  function saveBlacklist(chat, body) {
    const pattern = String(body.pattern || "").trim();
    if (!pattern) throw G.makeError("Escribe un patrón.", 400);
    const isRegex = Boolean(body.isRegex);
    if (isRegex && pattern.length > 120) throw G.makeError("La expresión regular es demasiado larga.", 400);
    const existing = chat.blacklist.find((item) => item.pattern === pattern);
    if (!existing && chat.blacklist.length >= (chat.premium.active ? 500 : 50)) {
      throw G.makeError("Has alcanzado el límite de patrones de tu plan.", 402);
    }
    if (existing) {
      existing.is_regex = isRegex;
    } else {
      chat.blacklist.push({
        chat_id: chat.id,
        pattern,
        is_regex: isRegex,
        created_by: USER.id,
        created_at: new Date().toISOString(),
      });
      chat.blacklist.sort((left, right) => left.pattern.localeCompare(right.pattern, "es"));
    }
    return { ok: true, entry: clone(existing || chat.blacklist.find((item) => item.pattern === pattern)) };
  }

  function deleteBlacklist(chat, body) {
    const pattern = String(body.pattern || "").trim();
    const index = chat.blacklist.findIndex((item) => item.pattern === pattern);
    if (index < 0) throw G.makeError("Ese patrón no existe.", 404);
    chat.blacklist.splice(index, 1);
    return { ok: true };
  }

  function activateDemoPlan(chatId, planId) {
    const chat = chatById(chatId);
    const plan = PLANS.find((item) => item.id === planId);
    if (!plan) throw G.makeError("Plan no válido.", 400);
    if(plan.kind==='license'){
      store.proSlots+=10;
      chat.payments.unshift({id:store.nextPaymentId++,amount:135,currency:'XTR',plan:'pro',planLabel:plan.label,days:0,createdAt:new Date().toISOString()});
      return premiumPayload(chat);
    }
    const current = chat.premium.until ? new Date(chat.premium.until).getTime() : 0;
    const base = chat.premium.active && current > Date.now() ? current : Date.now();
    const until = new Date(base + plan.days * 86400000).toISOString();
    chat.premium = {
      active: true,
      plan: plan.id,
      planLabel: plan.label,
      until,
      daysLeft: Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 86400000)),
    };
    chat.stats.premium = true;
    chat.stats.premiumDaysLeft = chat.premium.daysLeft;
    chat.payments.unshift({
      id: store.nextPaymentId++,
      amount: plan.stars,
      currency: "XTR",
      plan: plan.id,
      planLabel: plan.label,
      days: plan.days,
      createdAt: new Date().toISOString(),
    });

    const summaryChat = G.state.chats.find((item) => item.id === chat.id);
    if (summaryChat) summaryChat.premium = clone(chat.premium);
    if (G.state.chat && G.state.chat.id === chat.id) G.state.chat.premium = clone(chat.premium);
    if (G.state.bootstrap && G.state.bootstrap.chat.id === chat.id) {
      G.state.bootstrap.chat.premium = clone(chat.premium);
      G.state.bootstrap.limits.actions.limit = 5000;
      G.state.bootstrap.limits.actions.remaining = Math.max(
        0,
        5000 - G.state.bootstrap.limits.actions.used,
      );
    }
    return premiumPayload(chat);
  }

  G.demoChats = function demoChats() {
    return store.chats.map(summary);
  };

  G.demoActivatePlan = activateDemoPlan;

  G.demoExport = function demoExport() {
    const chat = stateChat();
    return {
      generatedAt: new Date().toISOString(),
      version: 1,
      chat: {
        id: chat.id,
        title: chat.title,
        username: chat.username,
        type: chat.type,
        description: chat.description,
      },
      settings: clone(chat.settings),
      stats: clone(chat.stats),
      chart: clone(chat.chart),
      members: clone(chat.members),
      warnings: clone(chat.warnings),
      moderation: clone(chat.logs),
      payments: clone(chat.payments),
      commands: clone(chat.commands),
      notes: clone(chat.notes),
      blacklist: clone(chat.blacklist),
    };
  };

  function stateChat() {
    if (G.state.chat) return chatById(G.state.chat.id);
    return store.chats[0];
  }

  G.demoRequest = async function demoRequest(path, options) {
    const method = String((options && options.method) || "GET").toUpperCase();
    let body = null;
    if (options && options.body) {
      try {
        body = JSON.parse(options.body);
      } catch {
        body = null;
      }
    }
    const url = new URL(path, window.location.origin);
    const route = url.pathname;
    const query = url.searchParams;
    const chatId = Number(query.get("chat_id") || (body && body.chatId) || 0);

    await G.delay(110);

    if (route === "/api/health") {
      return {
        ok: true,
        version: "1.0.0",
        uptime: 420,
        botMode: "demo",
        database: "ok",
        bot: { id: 440241489, username: G.BOT_USERNAME, name: "GB Multitask BOT" },
        serverTime: new Date().toISOString(),
      };
    }

    if (route === "/api/plans") {
      return {
        ok: true,
        plans: clone(PLANS),
        perks: clone(PERKS),
        limits: {
          freeActions: 200,
          premiumActions: 5000,
          freeCommands: 3,
          premiumCommands: 50,
          freeNotes: 5,
          premiumNotes: 100,
        },
      };
    }

    if (route === "/api/chats") {
      return { ok: true, chats: store.chats.map(summary) };
    }

    const chat = chatById(chatId);

    if (route === "/api/bootstrap") {
      return bootstrapFor(chat);
    }

    if (route === "/api/stats") {
      const requested = Number(query.get("days") || 14);
      const days = chat.premium.active ? Math.min(90, Math.max(7, requested)) : 7;
      const chart = chat.chart.slice(-days);
      const top = chat.members
        .slice()
        .sort((left, right) => right.messages - left.messages)
        .slice(0, 10)
        .map((member) => ({
          id: member.id,
          firstName: member.firstName,
          username: member.username,
          messages: member.messages,
          avatarUrl: null,
        }));
      return {
        ok: true,
        days,
        premium: chat.premium.active,
        limited: days < requested,
        stats: clone(chat.stats),
        chart: clone(chart),
        top,
      };
    }

    if (route === "/api/members" && method === "GET") {
      const search = String(query.get("q") || "").trim().toLowerCase();
      const limit = Math.max(1, Math.min(200, Number(query.get("limit") || 50)));
      const offset = Math.max(0, Number(query.get("offset") || 0));
      const filtered = chat.members.filter((member) => {
        if (!search) return true;
        return (
          (member.firstName || "").toLowerCase().includes(search) ||
          (member.lastName || "").toLowerCase().includes(search) ||
          (member.username || "").toLowerCase().includes(search) ||
          (member.displayName || "").toLowerCase().includes(search)
        );
      });
      const groups = { all: filtered, admins: filtered.filter(member => member.status === "creator" || member.status === "administrator"), restricted: filtered.filter(member => member.status === "restricted"), warned: filtered.filter(member => member.warns > 0), kicked: filtered.filter(member => member.status === "kicked" || member.status === "left") };
      const selected = groups[query.get("filter") || "all"] || filtered;
      const page = selected.slice(offset, offset + limit);
      return {
        ok: true,
        total: selected.length,
        counts: Object.fromEntries(Object.entries(groups).map(([name, list]) => [name, list.length])),
        tracked: chat.members.filter((item) => item.status !== "left" && item.status !== "kicked").length,
        liveAdmins: chat.adminCount,
        hasMore: offset + limit < selected.length,
        members: clone(page),
      };
    }

    const memberMatch = route.match(/^\/api\/members\/(\d+)$/);
    if (memberMatch && method === "GET") {
      const userId = Number(memberMatch[1]);
      const member = memberById(chat, userId);
      if (!member) throw G.makeError("Ese usuario no está en el grupo.", 404);
      const warnings = chat.warnings.filter((item) => item.user_id === userId);
      const recent = chat.logs.filter((item) => item.target && item.target.id === userId).slice(0, 10);
      return { ok: true, member: clone(member), warnings: clone(warnings), recentActions: clone(recent) };
    }

    if (route === "/api/moderation/log" && method === "GET") {
      const action = String(query.get("action") || "");
      const limit = Math.max(1, Math.min(100, Number(query.get("limit") || 30)));
      const offset = Math.max(0, Number(query.get("offset") || 0));
      const filtered = chat.logs.filter((item) => !action || item.action === action);
      return {
        ok: true,
        total: filtered.length,
        hasMore: offset + limit < filtered.length,
        items: clone(filtered.slice(offset, offset + limit)),
      };
    }

    if (route === "/api/moderation" && method === "POST") {
      return moderation(chat, body || {});
    }

    if (route === "/api/warnings/clear" && method === "POST") {
      const userId = Number(body && body.userId);
      const member = memberById(chat, userId);
      if (!member) throw G.makeError("Ese usuario no está en el grupo.", 404);
      const before = chat.warnings.length;
      chat.warnings = chat.warnings.filter((item) => item.user_id !== userId);
      member.warns = 0;
      chat.stats.warnings = chat.warnings.length;
      addLog(chat, "clearwarns", USER, member, "Advertencias borradas", null);
      return {
        ok: true,
        removed: before - chat.warnings.length,
        message: "Se han borrado las advertencias de " + member.displayName + ".",
      };
    }

    if (route === "/api/settings" && method === "GET") {
      return {
        ok: true,
        settings: clone(chat.settings),
        premium: premiumStatus(chat),
        limits: counts(chat),
      };
    }

    if (route === "/api/settings" && method === "PATCH") {
      return applySettings(chat, (body && body.patch) || {});
    }

    if (route === "/api/content" && method === "GET") {
      return contentPayload(chat);
    }

    if (route === "/api/content/command" && method === "POST") {
      return saveContent(chat, "command", body || {});
    }

    if (route === "/api/content/command" && method === "DELETE") {
      return deleteContent(chat, "command", body || {});
    }

    if (route === "/api/content/note" && method === "POST") {
      return saveContent(chat, "note", body || {});
    }

    if (route === "/api/content/note" && method === "DELETE") {
      return deleteContent(chat, "note", body || {});
    }

    if (route === "/api/content/blacklist" && method === "POST") {
      return saveBlacklist(chat, body || {});
    }

    if (route === "/api/content/blacklist" && method === "DELETE") {
      return deleteBlacklist(chat, body || {});
    }

    if (route === "/api/premium" && method === "GET") {
      return {
        ok: true,
        status: premiumStatus(chat),
        plans: clone(PLANS),
        perks: clone(PERKS),
        payments: clone(chat.payments),
        licenses: {slots:store.proSlots,used:store.proGroups.length,groups:clone(store.proGroups)},
      };
    }
    if(route==='/api/premium/license'&&method==='POST'){
      const target=chatById(Number(body.chatId));
      if(body.action==='assign'&&!store.proGroups.some(g=>g.chat_id===target.id)){
        if(store.proGroups.length>=store.proSlots)throw G.makeError('No tienes cupos de demostración libres.',402);
        store.proGroups.push({chat_id:target.id,title:target.title,active:true});
      }else if(body.action==='release')store.proGroups=store.proGroups.filter(g=>g.chat_id!==target.id);
      return {ok:true,demo:true};
    }

    if (route === "/api/premium/invoice" && method === "POST") {
      const plan = PLANS.find((item) => item.id === (body && body.planId));
      if (!plan) throw G.makeError("Plan no válido.", 400);
      return {
        ok: true,
        demo: true,
        url: "",
        plan: clone(plan),
        payload: "gbot:prem:" + chat.id + ":" + plan.id + ":demo",
        note: "Modo demo: el pago es simulado.",
      };
    }

    if (route === "/api/premium/redeem" && method === "POST") {
      const code = String((body && body.code) || "").trim().toUpperCase();
      if (code !== "GBOT-DEMO" && code !== "PREMIUM30") {
        throw G.makeError("Código inválido o ya utilizado. En la demo usa GBOT-DEMO.", 400);
      }
      const status = activateDemoPlan(chat.id, "monthly");
      return {
        ok: true,
        days: 30,
        plan: "monthly",
        status: {
          active: status.active,
          plan: status.plan,
          planLabel: status.planLabel,
          until: status.until,
          daysLeft: status.daysLeft,
        },
        message:
          "✅ Código canjeado: 30 días de Premium. Activo hasta " + G.fmtDate(status.until) + ".",
      };
    }

    if (route === "/api/export" && method === "GET") {
      return G.demoExport();
    }

    throw G.makeError("Ruta de demostración no encontrada: " + route, 404);
  };
})();
