import { tr } from "../../services/bot-i18n.js";
import type { Bot } from "grammy";
import {
  countCustomCommands,
  countNotes,
  deleteCustomCommand,
  deleteNote,
  getCustomCommand,
  getNote,
  incrementCustomCommandUses,
  incrementNoteUses,
  listCustomCommands,
  listNotes,
  upsertCustomCommand,
  upsertNote,
} from "../../db/repositories/commands.js";
import { commandLimit, noteLimit } from "../../services/limits.js";
import { escapeHtml, truncate } from "../../utils/format.js";
import type { AppContext } from "../context.js";
import { ensureGroupAdmin, replyTemp } from "../middleware.js";

export const RESERVED_COMMAND_NAMES = new Set([
  "start", "help", "id", "info", "rules", "setrules", "panel", "admins", "report", "config", "ajustes", "status", "estado", "setup", "inbox", "quality", "undo", "language",
  "stats", "top", "ban", "unban", "kick", "mute", "unmute", "warn", "warns",
  "unwarn", "resetwarns", "promote", "demote", "lock", "unlock", "purge", "del",
  "pin", "unpin", "unpinall", "welcome", "setwelcome", "resetwelcome", "testwelcome",
  "goodbye", "setgoodbye", "captcha", "antilink", "whitelist", "antiflood",
  "blacklist", "setwarns", "logs", "clean", "autoapprove", "premium", "redeem",
  "addcmd", "delcmd", "cmds", "save", "get", "notes", "clear", "settings",
  "gban", "ungban", "broadcast", "gencode", "botstats", "grant", "leave", "chats",
  "language", "setowner", "antiraid", "locks", "trust", "untrust", "filters", "night", "alliances", "topics", "saverich", "simulate", "schedule", "nsfw", "ia",
]);

const MAX_CONTENT = 2_000;

interface ParsedEntry {
  name: string;
  content: string;
}

function parseEntry(ctx: AppContext): ParsedEntry {
  const reply = ctx.msg?.reply_to_message;
  const raw = String(ctx.match ?? "").trim();
  if (reply) {
    const name = raw.split(/\s+/)[0] ?? "";
    return { name, content: (reply.text ?? reply.caption ?? "").trim() };
  }
  const [name = "", ...rest] = raw.split(/\s+/);
  return { name, content: rest.join(" ").trim() };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/^[/!#]/, "");
}

function validateName(name: string): string | null {
  if (!name) return tr("Indica un nombre.");
  if (!/^[a-z0-9_]{1,32}$/i.test(name)) {
    return tr("El nombre solo puede contener letras, números y guiones bajos (máx. 32).");
  }
  if (RESERVED_COMMAND_NAMES.has(name)) return tr("Ese nombre está reservado por un comando del bot.");
  return null;
}

export function registerContent(bot: Bot<AppContext>): void {
  bot.command("addcmd", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const chat = ctx.app.chatRow!;
    const parsed = parseEntry(ctx);
    const name = normalizeName(parsed.name);
    const nameError = validateName(name);
    if (nameError) {
      await replyTemp(
        ctx,
        tr("⚠️ {0}\n\nUso: <code>/addcmd saludo ¡Hola, {name}!</code>", [escapeHtml(nameError)]),
      );
      return;
    }
    if (!parsed.content) {
      await replyTemp(
        ctx,
        tr("⚠️ Escribe la respuesta o responde a un mensaje.\n\nUso: <code>/addcmd saludo ¡Hola, {name}!</code>"),
      );
      return;
    }
    if (parsed.content.length > MAX_CONTENT) {
      await replyTemp(ctx, tr("⚠️ La respuesta supera los {0} caracteres.", [MAX_CONTENT]));
      return;
    }

    const existing = await getCustomCommand(chat.chat_id, name);
    if (!existing) {
      const count = await countCustomCommands(chat.chat_id);
      const limit = commandLimit(ctx.app.premium);
      if (count >= limit) {
        await replyTemp(
          ctx,
          tr("🔒 <b>Límite de comandos alcanzado</b>\n\n") +
            tr("El plan {0} permite <b>{1}</b> comandos.\n", [ctx.app.premium ? tr("Premium") : "gratuito",limit]) +
            (ctx.app.premium ? "" : tr("Usa /premium para ampliar a 50.")),
        );
        return;
      }
    }

    await upsertCustomCommand(chat.chat_id, name, parsed.content, ctx.from!.id);
    await replyTemp(
      ctx,
      tr("✅ Comando <code>/{0}</code> {1}.\n", [escapeHtml(name),existing ? "actualizado" : "creado"]) +
        tr("Puedes usarlo con <code>/{0}</code> o <code>!{1}</code>.", [escapeHtml(name),escapeHtml(name)]),
    );
  });

  bot.command("delcmd", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const chat = ctx.app.chatRow!;
    const name = normalizeName((ctx.match ?? "").trim().split(/\s+/)[0] ?? "");
    if (!name) {
      await replyTemp(ctx, tr("⚠️ Uso: <code>/delcmd nombre</code>"));
      return;
    }
    const removed = await deleteCustomCommand(chat.chat_id, name);
    await replyTemp(
      ctx,
      removed ? tr("✅ Comando <code>/{0}</code> eliminado.", [escapeHtml(name)]) : tr("ℹ️ Ese comando no existe."),
    );
  });

  bot.command("cmds", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") return;
    const chat = ctx.app.chatRow!;
    const commands = await listCustomCommands(chat.chat_id);
    if (commands.length === 0) {
      await replyTemp(
        ctx,
        tr("📝 No hay comandos personalizados.\n\nCrea uno con <code>/addcmd nombre respuesta</code>."),
      );
      return;
    }
    const limit = commandLimit(ctx.app.premium);
    await replyTemp(
      ctx,
      tr("📝 <b>Comandos personalizados ({0}/{1})</b>\n\n", [commands.length,limit]) +
        commands
          .map(
            (command) =>
              tr("• <code>/{0}</code> — {1} uso(s)\n", [escapeHtml(command.name),command.uses]) +
              `  <i>${escapeHtml(truncate(command.content, 80))}</i>`,
          )
          .join("\n"),
    );
  });

  bot.command("save", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const chat = ctx.app.chatRow!;
    const parsed = parseEntry(ctx);
    const name = normalizeName(parsed.name);
    const nameError = validateName(name);
    if (nameError) {
      await replyTemp(
        ctx,
        tr("⚠️ {0}\n\nUso: <code>/save reglas Texto de la nota</code>", [escapeHtml(nameError)]),
      );
      return;
    }
    if (!parsed.content) {
      await replyTemp(ctx, tr("⚠️ Escribe el contenido o responde a un mensaje con <code>/save nombre</code>."));
      return;
    }
    if (parsed.content.length > MAX_CONTENT) {
      await replyTemp(ctx, tr("⚠️ La nota supera los {0} caracteres.", [MAX_CONTENT]));
      return;
    }

    const existing = await getNote(chat.chat_id, name);
    if (!existing) {
      const count = await countNotes(chat.chat_id);
      const limit = noteLimit(ctx.app.premium);
      if (count >= limit) {
        await replyTemp(
          ctx,
          tr("🔒 <b>Límite de notas alcanzado</b>\n\n") +
            tr("El plan {0} permite <b>{1}</b> notas.\n", [ctx.app.premium ? tr("Premium") : "gratuito",limit]) +
            (ctx.app.premium ? "" : tr("Usa /premium para ampliar a 100.")),
        );
        return;
      }
    }

    await upsertNote(chat.chat_id, name, parsed.content, ctx.from!.id);
    await replyTemp(
      ctx,
      tr("✅ Nota <code>#{0}</code> {1}.\n", [escapeHtml(name),existing ? "actualizada" : "guardada"]) +
        tr("Puedes mostrarla con <code>/get {0}</code> o <code>#{1}</code>.", [escapeHtml(name),escapeHtml(name)]),
    );
  });

  bot.command("get", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") return;
    const chat = ctx.app.chatRow!;
    const name = normalizeName((ctx.match ?? "").trim().split(/\s+/)[0] ?? "");
    if (!name) {
      await replyTemp(ctx, tr("⚠️ Uso: <code>/get nombre</code>"));
      return;
    }
    const note = await getNote(chat.chat_id, name);
    if (!note) {
      await replyTemp(ctx, tr("ℹ️ Esa nota no existe. Usa /notes para ver las disponibles."));
      return;
    }
    await incrementNoteUses(chat.chat_id, name);
    await ctx.reply(note.content, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("notes", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") return;
    const chat = ctx.app.chatRow!;
    const notes = await listNotes(chat.chat_id);
    if (notes.length === 0) {
      await replyTemp(
        ctx,
        tr("📝 No hay notas guardadas.\n\nCrea una con <code>/save nombre contenido</code>."),
      );
      return;
    }
    const limit = noteLimit(ctx.app.premium);
    await replyTemp(
      ctx,
      tr("📝 <b>Notas ({0}/{1})</b>\n\n", [notes.length,limit]) +
        notes
          .map(
            (note) =>
              tr("• <code>#{0}</code> — {1} uso(s)\n", [escapeHtml(note.name),note.uses]) +
              `  <i>${escapeHtml(truncate(note.content, 80))}</i>`,
          )
          .join("\n"),
    );
  });

  bot.command("clear", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const chat = ctx.app.chatRow!;
    const name = normalizeName((ctx.match ?? "").trim().split(/\s+/)[0] ?? "");
    if (!name) {
      await replyTemp(ctx, tr("⚠️ Uso: <code>/clear nombre</code>"));
      return;
    }
    const removed = await deleteNote(chat.chat_id, name);
    await replyTemp(
      ctx,
      removed ? tr("✅ Nota <code>#{0}</code> eliminada.", [escapeHtml(name)]) : tr("ℹ️ Esa nota no existe."),
    );
  });

  // Mantener las funciones de incremento accesibles desde el manejador dinámico.
  void incrementCustomCommandUses;
}
