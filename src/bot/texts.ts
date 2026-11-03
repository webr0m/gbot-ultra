import { tr } from "../services/bot-i18n.js";
import { config } from "../config.js";
import { DEFAULT_SETTINGS } from "../services/settings.js";

export function startPrivate(name: string, hasWebapp: boolean): string {
  return (
    tr("👋 <b>Hola, {0}</b>\n\n", [name]) +
    tr("Soy <b>GBot Ultra</b>, el bot que mantiene tu grupo limpio, seguro y activo.\n\n") +
    tr("🛡️ Moderación completa con warns, mute, ban y purga\n") +
    tr("👋 Bienvenidas personalizadas y captcha antibots\n") +
    tr("🔗 Antienlaces, antiflood y lista negra\n") +
    tr("📊 Estadísticas y ranking de miembros\n") +
    tr("👑 Premium con límites ampliados y funciones exclusivas\n\n") +
    (hasWebapp
      ? tr("Abre el <b>panel de control</b> para gestionar todo desde una Mini App.")
      : tr("Añádeme a un grupo y dame permisos de administrador para empezar."))
  );
}

export function startGroup(): string {
  return (
    tr("✅ <b>GBot Ultra está en el grupo</b>\n\nPara activar la protección necesito ser <b>administrador</b> con estos permisos:\n• Eliminar mensajes\n• Restringir miembros\n• Banear miembros\n• Fijar mensajes\n\n⚙️ Panel: /panel\n📚 Comandos: /help\n🛡️ Ajustes rápidos: /settings")
  );
}

export function helpText(section: "main" | "mod" | "settings" | "content" | "premium"): string {
  if (section === "mod") {
    return (
      tr("🛡️ <b>Moderación</b>\n\n<b>Acciones sobre usuarios</b>\n/ban [tiempo] [motivo] — Banea (ej. <code>/ban 7d spam</code>)\n/unban — Desbanea\n/kick — Expulsa sin banear\n/mute [tiempo] — Silencia (ej. <code>/mute 30m</code>)\n/unmute — Quita el silencio\n/warn [motivo] — Añade advertencia\n/warns — Consulta advertencias\n/unwarn — Quita la última\n/resetwarns — Borra todas\n/promote [título] — Promociona a moderador\n/promote full — Promociona con todos los permisos\n/demote — Degrada a miembro\n\n<b>Gestión del grupo</b>\n/lock — Cierra el grupo\n/unlock — Abre el grupo\n/purge [n] — Borra el mensaje respondido o los últimos n\n/del — Borra el mensaje respondido\n/pin — Fija el mensaje respondido\n/unpin — Desfija\n/unpinall — Desfija todo\n\n💡 Responde a un mensaje o usa @usuario / ID.")
    );
  }

  if (section === "settings") {
    return (
      tr("⚙️ <b>Ajustes</b>\n\n/config o /settings — Abre los ajustes de este grupo en la Mini App\n/estado — Revisa los permisos del bot y la protección activa\n/setup — Asistente de instalación con vista previa\n/inbox — Bandeja de revisiones pendientes (Pro)\n/language — Idioma del grupo; en privado, tu idioma personal\n/schedule — Publicaciones programadas y recurrentes (Pro)\n/nsfw — Filtro visual de fotos con revisión o eliminación (Pro)\n/welcome on|off — Bienvenida\n/setwelcome [texto] — Cambia la bienvenida (responde a una foto o vídeo para usar multimedia)\n/testwelcome — Previsualiza la bienvenida\n/goodbye on|off — Despedida\n/setgoodbye [texto] — Cambia la despedida\n/captcha on|off — Captcha de entrada\n/captcha mode button|math — Tipo de captcha\n/captcha timeout 300 — Tiempo límite\n/antilink on|off — Antienlaces\n/antilink delete|mute|ban — Acción\n/whitelist add|remove|list — Dominios permitidos\n/antiflood on|off — Antiflood\n/antiflood limit 8 — Mensajes por ventana\n/antiflood window 10 — Ventana en segundos\n/antiflood mute 10m — Duración del silencio\n/blacklist add|remove|list — Palabras prohibidas\n/setwarns limit 3 — Límite de advertencias\n/setwarns action mute|kick|ban — Acción al límite\n/logs on|off — Canal de registros\n/logs set -1001234567890 — Canal de logs\n/report on|off — Reportes de miembros\n/clean on|off — Borrar mensajes de unión\n/autoapprove on|off — Aprobar solicitudes automáticamente")
    );
  }

  if (section === "content") {
    return (
      tr("📝 <b>Contenido y comandos</b>\n\n<b>Comandos personalizados</b>\n/addcmd <code>nombre</code> <code>respuesta</code> — Crea un comando (o responde a un mensaje)\n/delcmd <code>nombre</code> — Elimina un comando\n/cmds — Lista los comandos\nSe usan con /nombre o !nombre\n\n<b>Notas</b>\n/save <code>nombre</code> <code>contenido</code> — Guarda una nota\n/get <code>nombre</code> — Muestra una nota\n/notes — Lista las notas\n/clear <code>nombre</code> — Elimina una nota\nSe usan con #nombre\n\nVariables disponibles: <code>{name}</code>, <code>{username}</code>, <code>{chat}</code>, <code>{id}</code>")
    );
  }

  if (section === "premium") {
    return (
      tr("👑 <b>GBot Ultra Premium</b>\n\nDesbloquea todo el potencial del bot para tu grupo:\n\n🖼️ Bienvenidas con foto, vídeo, GIF o documento\n🧮 Captcha matemático\n🔗 Antienlaces con mute/ban y lista blanca\n📋 Canal de registros de moderación\n") +
      tr("⚡ Hasta {0} acciones al día\n", [config.premiumActionLimit]) +
      tr("🧩 Hasta 50 comandos y 100 notas\n") +
      tr("📊 Exportación de estadísticas\n") +
      tr("✅ Aprobación automática de solicitudes\n") +
      tr("🧹 Bienvenida autolimpiable\n") +
      tr("🛟 Soporte prioritario\n\n") +
      tr("Usa /premium para ver los planes y precios en ⭐ Stars.")
    );
  }

  return (
    tr("📚 <b>Ayuda de GBot Ultra</b>\n\nElige una categoría para ver todos los comandos:\n\n🛡️ <b>Moderación</b> — ban, mute, warns, purge…\n⚙️ <b>Ajustes</b> — bienvenida, captcha, antilink…\n📝 <b>Contenido</b> — comandos personalizados y notas\n👑 <b>Premium</b> — planes y ventajas\n\n📱 <b>Panel del grupo</b>: /panel · /config\n🩺 <b>Diagnóstico</b>: /estado\nLos ajustes se sincronizan con la Mini App. Los comandos con parámetros siguen funcionando en el grupo.\n\nℹ️ <b>Información del grupo</b>: /info\n📊 <b>Estadísticas</b>: /stats")
  );
}

export function premiumStatusText(
  chatTitle: string,
  active: boolean,
  planLabel: string,
  untilText: string,
  daysLeft: number,
): string {
  if (!active) {
    return (
      tr("👑 <b>Premium · {0}</b>\n\n", [chatTitle]) +
      tr("Este grupo usa el <b>plan gratuito</b>.\n\n") +
      tr("Límite actual: <b>{0} acciones/día</b>, 3 comandos y 5 notas.\n\n", [config.freeActionLimit]) +
      tr("Elige un plan para desbloquear todas las funciones.")
    );
  }
  if (daysLeft <= 0) {
    return (
      tr("👑 <b>Premium activo · {0}</b>\n\n", [chatTitle]) +
      tr("Plan: <b>{0}</b>\n", [planLabel]) +
      tr("Sin vencimiento: los cupos Pro no caducan.\n\n") +
      tr("Límite: <b>{0} acciones/día</b>, 50 comandos y 100 notas.\n\n", [config.premiumActionLimit]) +
      tr("Asigna o mueve los cupos desde /panel → Premium.")
    );
  }
  return (
    tr("👑 <b>Premium activo · {0}</b>\n\n", [chatTitle]) +
    tr("Plan: <b>{0}</b>\n", [planLabel]) +
    tr("Vence: <b>{0}</b>\n", [untilText]) +
    tr("Quedan: <b>{0} día(s)</b>\n\n", [daysLeft]) +
    tr("Límite: <b>{0} acciones/día</b>, 50 comandos y 100 notas.\n\n", [config.premiumActionLimit]) +
    tr("Puedes renovar cuando quieras: los días se suman.")
  );
}

export function rulesText(title: string, rules: string): string {
  if (!rules.trim()) {
    return (
      tr("📜 <b>Normas de {0}</b>\n\n", [title]) +
      tr("Los administradores aún no han configurado las normas.\n\n") +
      tr("💡 Un administrador puede establecerlas con <code>/setrules</code>.")
    );
  }
  return tr("📜 <b>Normas de {0}</b>\n\n{1}", [title,rules]);
}

export function welcomeDefaultText(): string {
  return DEFAULT_SETTINGS.welcome.text;
}

export const PREMIUM_REQUIRED_TEXT =
  tr("🔒 <b>Función Premium</b>\n\nEsta función requiere <b>GBot Ultra Premium</b>.\nUsa /premium para ver los planes disponibles.");
