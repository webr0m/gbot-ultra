/* ============================================================
   GBot Ultra · arranque de la Mini App
   ============================================================ */

(() => {
  "use strict";

  const G = window.GBot;
  if (!G || typeof G.boot !== "function") return;

  function start() {
    G.applyClientLanguage();
    G.boot().catch((error) => {
      if (typeof G.showFatal === "function") G.showFatal(error);
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") G.applyClientLanguage();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
