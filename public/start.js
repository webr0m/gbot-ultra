/* ============================================================
   GBot Ultra · arranque de la Mini App
   ============================================================ */

(() => {
  "use strict";

  const G = window.GBot;
  if (!G || typeof G.boot !== "function") return;

  function start() {
    G.boot().catch((error) => {
      if (typeof G.showFatal === "function") G.showFatal(error);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
