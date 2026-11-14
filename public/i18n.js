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
    { code: "uk", name: "Українська", flag: "🇺🇦" },
    { code: "pl", name: "Polski", flag: "🇵🇱" },
    { code: "nl", name: "Nederlands", flag: "🇳🇱" },
    { code: "ro", name: "Română", flag: "🇷🇴" },
    { code: "ja", name: "日本語", flag: "🇯🇵" },
    { code: "ko", name: "한국어", flag: "🇰🇷" },
    { code: "hi", name: "हिन्दी", flag: "🇮🇳" },
    { code: "id", name: "Bahasa Indonesia", flag: "🇮🇩" },
    { code: "vi", name: "Tiếng Việt", flag: "🇻🇳" },
    { code: "fa", name: "فارسی", flag: "🇮🇷" },
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
    uk: {
      home: "Головна", members: "Учасники", moderation: "Модерація",
      settings: "Налаштування", premium: "Преміум", changeTheme: "Змінити тему",
      groups: "Ваші групи", changeGroup: "Змінити групу",
      appearance: "Вигляд", nightMode: "Нічний режим", dayMode: "Денний режим",
    },
    pl: {
      home: "Start", members: "Członkowie", moderation: "Moderacja",
      settings: "Ustawienia", premium: "Premium", changeTheme: "Zmień motyw",
      groups: "Twoje grupy", changeGroup: "Zmień grupę",
      appearance: "Wygląd", nightMode: "Tryb nocny", dayMode: "Tryb dzienny",
    },
    nl: {
      home: "Start", members: "Leden", moderation: "Moderatie",
      settings: "Instellingen", premium: "Premium", changeTheme: "Thema wijzigen",
      groups: "Je groepen", changeGroup: "Groep wijzigen",
      appearance: "Weergave", nightMode: "Nachtmodus", dayMode: "Dagmodus",
    },
    ro: {
      home: "Acasă", members: "Membri", moderation: "Moderare",
      settings: "Setări", premium: "Premium", changeTheme: "Schimbă tema",
      groups: "Grupurile tale", changeGroup: "Schimbă grupul",
      appearance: "Aspect", nightMode: "Mod de noapte", dayMode: "Mod de zi",
    },
    ja: {
      home: "ホーム", members: "メンバー", moderation: "モデレーション",
      settings: "設定", premium: "プレミアム", changeTheme: "テーマを変更",
      groups: "あなたのグループ", changeGroup: "グループを変更",
      appearance: "外観", nightMode: "夜間モード", dayMode: "昼間モード",
    },
    ko: {
      home: "홈", members: "멤버", moderation: "관리",
      settings: "설정", premium: "프리미엄", changeTheme: "테마 변경",
      groups: "내 그룹", changeGroup: "그룹 변경",
      appearance: "화면", nightMode: "야간 모드", dayMode: "주간 모드",
    },
    hi: {
      home: "होम", members: "सदस्य", moderation: "मॉडरेशन",
      settings: "सेटिंग्स", premium: "प्रीमियम", changeTheme: "थीम बदलें",
      groups: "आपके समूह", changeGroup: "समूह बदलें",
      appearance: "दिखावट", nightMode: "रात्रि मोड", dayMode: "दिन मोड",
    },
    id: {
      home: "Beranda", members: "Anggota", moderation: "Moderasi",
      settings: "Pengaturan", premium: "Premium", changeTheme: "Ubah tema",
      groups: "Grup Anda", changeGroup: "Ganti grup",
      appearance: "Tampilan", nightMode: "Mode malam", dayMode: "Mode siang",
    },
    vi: {
      home: "Trang chủ", members: "Thành viên", moderation: "Kiểm duyệt",
      settings: "Cài đặt", premium: "Premium", changeTheme: "Đổi giao diện",
      groups: "Nhóm của bạn", changeGroup: "Đổi nhóm",
      appearance: "Giao diện", nightMode: "Chế độ ban đêm", dayMode: "Chế độ ban ngày",
    },
    fa: {
      home: "خانه", members: "اعضا", moderation: "مدیریت",
      settings: "تنظیمات", premium: "ویژه", changeTheme: "تغییر پوسته",
      groups: "گروه‌های شما", changeGroup: "تغییر گروه",
      appearance: "ظاهر", nightMode: "حالت شب", dayMode: "حالت روز",
    },
  };

  G.LANGUAGES = LANGUAGES;
  // All panel languages also have local bot catalogs for shared group replies.
  // Selecting a group language still never overrides the client's panel language.
  G.GROUP_LANGUAGES = LANGUAGES;
  G.normalizeLanguage = function normalizeLanguage(value) {
    const code = typeof value === "string" ? value.trim().toLowerCase().split(/[-_]/)[0] : "";
    return LANGUAGES.some((lang) => lang.code === code) ? code : "en";
  };
  G.t = function t(key, lang) {
    const code = G.normalizeLanguage(lang);
    return (STRINGS[code] && STRINGS[code][key]) || STRINGS.en[key] || key;
  };
  G.currentLang = function currentLang() {
    // Telegram is authoritative. Never use the group's setting, browser locale
    // or a cached selection to choose a user's Mini App language.
    const client = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
    const verified = G.state?.bootstrap?.user?.languageCode;
    return G.normalizeLanguage(client ?? verified);
  };

  G.applyClientLanguage = function applyClientLanguage() {
    return G.applyLanguage(G.currentLang());
  };

  // Reuse the existing full-panel translator without adding a language widget.
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
        reject(new Error("Could not load the translator. Check your connection and reload the Mini App."));
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
      // A previously cached selection must not override the Telegram client.
      try { localStorage.removeItem("__GT_TRANSLATE_LANGS"); } catch { /* Storage may be unavailable in a WebView. */ }
      document.body.appendChild(script);
    }).catch((error) => {
      enginePromise = null;
      throw error;
    });
    return enginePromise;
  }

  G.applyLanguage = async function applyLanguage(code) {
    const lang = G.normalizeLanguage(code);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
    document.documentElement.dir = ["ar", "fa"].includes(lang) ? "rtl" : "ltr";
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
        G.toast("Could not translate the panel. Check your connection and reload the Mini App.", "error");
      };
      if (!engine.translate("es", lang === "zh" ? "zh-CN" : lang)) {
        throw new Error("The translator is unavailable. Reload the Mini App to retry.");
      }
      appliedLanguage = lang;
    } catch (error) {
      if (id !== requestId) return;
      appliedLanguage = null;
      G.toast(error.message, "error");
    }
  };

})();
