/* ============================================================
   GBot Ultra · internacionalización de la Mini App
   ============================================================ */

(() => {
  "use strict";

  const G = (window.GBot = window.GBot || {});

  const LANGUAGES = [
    { code: "es", name: "Español", flag: "🇪🇸" },
    { code: "en", name: "English", flag: "🇬🇧" },
    { code: "pt", name: "Português", flag: "🇵🇹" },
    { code: "fr", name: "Français", flag: "🇫🇷" },
    { code: "de", name: "Deutsch", flag: "🇩🇪" },
    { code: "it", name: "Italiano", flag: "🇮🇹" },
    { code: "ru", name: "Русский", flag: "🇷🇺" },
    { code: "tr", name: "Türkçe", flag: "🇹🇷" },
    { code: "ar", name: "العربية", flag: "🇸🇦" },
    { code: "zh", name: "中文", flag: "🇨🇳" },
  ];

  const STRINGS = {
    es: {
      home: "Inicio", members: "Miembros", moderation: "Moderación",
      settings: "Ajustes", premium: "Premium", changeTheme: "Cambiar tema",
      groups: "Tus grupos", changeGroup: "Cambiar grupo",
      appearance: "Apariencia", nightMode: "Modo noche", dayMode: "Modo día",
    },
    en: {
      home: "Home", members: "Members", moderation: "Moderation",
      settings: "Settings", premium: "Premium", changeTheme: "Change theme",
      groups: "Your groups", changeGroup: "Change group",
      appearance: "Appearance", nightMode: "Night mode", dayMode: "Day mode",
    },
    pt: {
      home: "Início", members: "Membros", moderation: "Moderação",
      settings: "Ajustes", premium: "Premium", changeTheme: "Mudar tema",
      groups: "Seus grupos", changeGroup: "Mudar grupo",
      appearance: "Aparência", nightMode: "Modo noite", dayMode: "Modo dia",
    },
    fr: {
      home: "Accueil", members: "Membres", moderation: "Modération",
      settings: "Paramètres", premium: "Premium", changeTheme: "Changer le thème",
      groups: "Vos groupes", changeGroup: "Changer de groupe",
      appearance: "Apparence", nightMode: "Mode nuit", dayMode: "Mode jour",
    },
    de: {
      home: "Start", members: "Mitglieder", moderation: "Moderation",
      settings: "Einstellungen", premium: "Premium", changeTheme: "Thema wechseln",
      groups: "Deine Gruppen", changeGroup: "Gruppe wechseln",
      appearance: "Erscheinung", nightMode: "Nachtmodus", dayMode: "Tagmodus",
    },
    it: {
      home: "Home", members: "Membri", moderation: "Moderazione",
      settings: "Impostazioni", premium: "Premium", changeTheme: "Cambia tema",
      groups: "I tuoi gruppi", changeGroup: "Cambia gruppo",
      appearance: "Aspetto", nightMode: "Modo notte", dayMode: "Modo giorno",
    },
    ru: {
      home: "Главная", members: "Участники", moderation: "Модерация",
      settings: "Настройки", premium: "Премиум", changeTheme: "Сменить тему",
      groups: "Ваши группы", changeGroup: "Сменить группу",
      appearance: "Внешний вид", nightMode: "Ночной режим", dayMode: "Дневной режим",
    },
    tr: {
      home: "Ana sayfa", members: "Üyeler", moderation: "Moderasyon",
      settings: "Ayarlar", premium: "Premium", changeTheme: "Temayı değiştir",
      groups: "Gruplarınız", changeGroup: "Grup değiştir",
      appearance: "Görünüm", nightMode: "Gece modu", dayMode: "Gündüz modu",
    },
    ar: {
      home: "الرئيسية", members: "الأعضاء", moderation: "الإشراف",
      settings: "الإعدادات", premium: "بريميوم", changeTheme: "تغيير الثيم",
      groups: "مجموعاتك", changeGroup: "تغيير المجموعة",
      appearance: "المظهر", nightMode: "الوضع الليلي", dayMode: "الوضع النهاري",
    },
    zh: {
      home: "首页", members: "成员", moderation: "管理",
      settings: "设置", premium: "高级版", changeTheme: "切换主题",
      groups: "你的群组", changeGroup: "切换群组",
      appearance: "外观", nightMode: "夜间模式", dayMode: "日间模式",
    },
  };

  G.LANGUAGES = LANGUAGES;
  G.t = function t(key, lang) {
    const code = LANGUAGES.some((l) => l.code === lang) ? lang : "es";
    return (STRINGS[code] && STRINGS[code][key]) || (STRINGS.es && STRINGS.es[key]) || key;
  };
  G.currentLang = function currentLang() {
    const s = G.state && (G.state.settings || (G.state.bootstrap && G.state.bootstrap.settings));
    return (s && s.language) || "es";
  };

  // Belcanto's dropdown.js uses this same engine. Load it directly so our
  // Settings control the saved language without a second floating selector.
  let enginePromise = null;
  let appliedLanguage = null;
  let requestId = 0;

  function loadEngine() {
    if (enginePromise) return enginePromise;
    enginePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = setTimeout(() => fail(), 15000);
      function fail() {
        clearTimeout(timeout);
        script.remove();
        reject(new Error("No se pudo cargar el traductor. Revisa tu conexión y vuelve a elegir el idioma."));
      }
      script.src = "https://cdn.gtranslate.net/widgets/latest/lib.min.js";
      script.async = true;
      script.onerror = fail;
      script.onload = () => {
        const engine = window.__GT && window.__GT.translator;
        if (!engine || !engine.libReady) return fail();
        clearTimeout(timeout);
        resolve(engine);
      };
      // The group setting is authoritative; do not restore another group's
      // previously cached language while the engine initializes.
      try { localStorage.removeItem("__GT_TRANSLATE_LANGS"); } catch { /* Storage may be unavailable in a WebView. */ }
      document.body.appendChild(script);
    }).catch((error) => {
      enginePromise = null;
      throw error;
    });
    return enginePromise;
  }

  G.applyLanguage = async function applyLanguage(code) {
    const lang = LANGUAGES.some((item) => item.code === code) ? code : "es";
    document.querySelectorAll(".nav-item[data-tab]").forEach((button) => {
      const label = button.querySelector("span");
      if (label) label.textContent = G.t(button.dataset.tab, lang);
    });
    const id = ++requestId;
    if (appliedLanguage === lang) return;
    if (lang === "es" && !(window.__GT && window.__GT.translator)) {
      try { localStorage.removeItem("__GT_TRANSLATE_LANGS"); } catch { /* Optional cache. */ }
      appliedLanguage = lang;
      return;
    }
    try {
      const engine = await loadEngine();
      if (id !== requestId) return;
      engine.resultCallback = () => {
        if (!engine.error) return;
        appliedLanguage = null;
        G.toast("No se pudo traducir el panel. Revisa tu conexión y vuelve a elegir el idioma.", "error");
      };
      if (!engine.translate("es", lang === "zh" ? "zh-CN" : lang)) {
        throw new Error("El traductor no está disponible. Vuelve a elegir el idioma.");
      }
      appliedLanguage = lang;
    } catch (error) {
      if (id !== requestId) return;
      appliedLanguage = null;
      G.toast(error.message, "error");
    }
  };

})();
