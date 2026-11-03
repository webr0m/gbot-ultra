import { tr } from "../../services/bot-i18n.js";
import type { Bot } from "grammy";
import { formatDateTime } from "../../utils/date.js";
import { formatDuration, parseModerationArgs } from "../../utils/duration.js";
import { escapeHtml, mentionUser } from "../../utils/format.js";
import { recentMessageIds } from "../../services/recent.js";
import { resolveTarget, resolveUserFromReplyOrArgs } from "../../services/targets.js";
import {
  ModerationError,
  banUser,
  demoteUser,
  kickUser,
  lockChat,
  muteUser,
  pinMessage,
  promoteUser,
  purgeMessages,
  unbanUser,
  unlockChat,
  unmuteUser,
  unpinAll,
  unpinMessage,
  warnUser,
  type ModerationContext,
  type TargetInfo,
} from "../../services/moderation.js";
import {
  clearWarnings,
  countWarnings,
  listWarnings,
  removeLastWarning,
} from "../../db/repositories/warnings.js";
import { safeDelete } from "../../utils/telegram.js";
import type { AppContext } from "../context.js";
import { ensureGroupAdmin, guardAction, replyTemp } from "../middleware.js";

function modContext(ctx: AppContext): ModerationContext {
  return {
    api: ctx.api,
    chatId: ctx.app.chatRow!.chat_id,
    chat: ctx.app.chatRow!,
    settings: ctx.app.settings,
    botId: ctx.app.botId,
    actorId: ctx.from!.id,
    actorName: ctx.app.actorName,
    source: "bot",
  };
}

interface PreparedTarget {
  target: TargetInfo;
  reason: string;
  seconds: number | null;
}

async function prepareTarget(
  ctx: AppContext,
  defaultUnit: "m" | "d" = "m",
  requireMember = true,
): Promise<PreparedTarget | null> {
  const chat = ctx.app.chatRow;
  const message = ctx.msg;
  if (!chat || !message) return null;

  const resolved = await resolveTarget(
    ctx.api,
    chat.chat_id,
    message,
    String(ctx.match ?? ""),
    { requireMember },
  );
  if (!resolved.ok || !resolved.userId) {
    await replyTemp(ctx, `⚠️ ${escapeHtml(resolved.error ?? tr("No he podido identificar al usuario."))}`);
    return null;
  }

  const parsed = parseModerationArgs(resolved.rest, defaultUnit);
  return {
    target: {
      userId: resolved.userId,
      name: resolved.name ?? tr("Usuario"),
      username: resolved.username ?? null,
    },
    reason: parsed.reason,
    seconds: parsed.seconds,
  };
}

function targetText(target: TargetInfo): string {
  return mentionUser({
    id: target.userId,
    first_name: target.name,
    username: target.username,
  });
}

function reasonLine(reason: string): string {
  return reason ? tr("\n📝 Motivo: {0}", [escapeHtml(reason)]) : "";
}

async function handleModerationError(ctx: AppContext, error: unknown): Promise<void> {
  if (error instanceof ModerationError) {
    await replyTemp(ctx, `⚠️ ${escapeHtml(error.userMessage)}`);
    return;
  }
  const message = error instanceof Error ? error.message : tr("Error desconocido");
  await replyTemp(ctx, tr("⚠️ No se pudo completar la acción: {0}", [escapeHtml(message)]));
}

export function registerModeration(bot: Bot<AppContext>): void {
  bot.command("ban", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (!(await guardAction(ctx))) return;
    const prepared = await prepareTarget(ctx, "d");
    if (!prepared) return;
    try {
      await banUser(modContext(ctx), {
        target: prepared.target,
        reason: prepared.reason || null,
        durationSeconds: prepared.seconds,
      });
      await replyTemp(
        ctx,
        tr("🚫 <b>Usuario baneado</b>\n👤 {0}\n", [targetText(prepared.target)]) +
          `⏱️ ${formatDuration(prepared.seconds)}${reasonLine(prepared.reason)}`,
      );
    } catch (error) {
      await handleModerationError(ctx, error);
    }
  });

  bot.command("unban", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (!(await guardAction(ctx))) return;
    const chat = ctx.app.chatRow!;
    const message = ctx.msg!;
    const resolved = await resolveUserFromReplyOrArgs(
      ctx.api,
      chat.chat_id,
      message,
      ctx.match ?? "",
    );
    if (!resolved.ok || !resolved.userId) {
      await replyTemp(ctx, `⚠️ ${escapeHtml(resolved.error ?? tr("Usuario no válido."))}`);
      return;
    }
    const target: TargetInfo = {
      userId: resolved.userId,
      name: resolved.name ?? tr("Usuario"),
      username: resolved.username ?? null,
    };
    try {
      await unbanUser(modContext(ctx), target);
      await replyTemp(ctx, tr("✅ <b>Usuario desbaneado</b>\n👤 {0}", [targetText(target)]));
    } catch (error) {
      await handleModerationError(ctx, error);
    }
  });

  bot.command("kick", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (!(await guardAction(ctx))) return;
    const prepared = await prepareTarget(ctx);
    if (!prepared) return;
    try {
      await kickUser(modContext(ctx), {
        target: prepared.target,
        reason: prepared.reason || null,
      });
      await replyTemp(
        ctx,
        tr("👢 <b>Usuario expulsado</b>\n👤 {0}{1}", [targetText(prepared.target),reasonLine(prepared.reason)]),
      );
    } catch (error) {
      await handleModerationError(ctx, error);
    }
  });

  bot.command("mute", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (!(await guardAction(ctx))) return;
    const prepared = await prepareTarget(ctx, "m");
    if (!prepared) return;
    const seconds = prepared.seconds ?? 3_600;
    try {
      await muteUser(modContext(ctx), {
        target: prepared.target,
        reason: prepared.reason || null,
        durationSeconds: seconds,
      });
      await replyTemp(
        ctx,
        tr("🔇 <b>Usuario silenciado</b>\n👤 {0}\n", [targetText(prepared.target)]) +
          `⏱️ ${formatDuration(seconds)}${reasonLine(prepared.reason)}`,
      );
    } catch (error) {
      await handleModerationError(ctx, error);
    }
  });

  bot.command("unmute", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (!(await guardAction(ctx))) return;
    const prepared = await prepareTarget(ctx);
    if (!prepared) return;
    try {
      await unmuteUser(modContext(ctx), prepared.target);
      await replyTemp(ctx, tr("🔊 <b>Usuario desilenciado</b>\n👤 {0}", [targetText(prepared.target)]));
    } catch (error) {
      await handleModerationError(ctx, error);
    }
  });

  bot.command("warn", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (!(await guardAction(ctx))) return;
    const chat = ctx.app.chatRow!;
    const message = ctx.msg!;
    const resolved = await resolveTarget(ctx.api, chat.chat_id, message, ctx.match ?? "");
    if (!resolved.ok || !resolved.userId) {
      await replyTemp(ctx, `⚠️ ${escapeHtml(resolved.error ?? tr("Usuario no válido."))}`);
      return;
    }
    const target: TargetInfo = {
      userId: resolved.userId,
      name: resolved.name ?? tr("Usuario"),
      username: resolved.username ?? null,
    };
    try {
      const result = await warnUser(modContext(ctx), target, resolved.rest || null);
      if (result.actionTaken) {
        await replyTemp(
          ctx,
          tr("🚨 <b>Límite de advertencias alcanzado</b>\n👤 {0}\n", [targetText(target)]) +
            tr("⚠️ {0}/{1} advertencias\n", [result.count,result.limit]) +
            tr("⚙️ Acción aplicada: <b>{0}</b>", [result.actionTaken]),
        );
      } else {
        await replyTemp(
          ctx,
          tr("⚠️ <b>Advertencia añadida</b>\n👤 {0}\n", [targetText(target)]) +
            `📊 ${result.count}/${result.limit}${reasonLine(resolved.rest)}`,
        );
      }
    } catch (error) {
      await handleModerationError(ctx, error);
    }
  });

  bot.command("warns", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") return;
    const chat = ctx.app.chatRow!;
    const message = ctx.msg!;
    const resolved = await resolveTarget(ctx.api, chat.chat_id, message, ctx.match ?? "");
    if (!resolved.ok || !resolved.userId) {
      await replyTemp(ctx, `⚠️ ${escapeHtml(resolved.error ?? tr("Usuario no válido."))}`);
      return;
    }
    const target: TargetInfo = {
      userId: resolved.userId,
      name: resolved.name ?? tr("Usuario"),
      username: resolved.username ?? null,
    };
    const [count, warnings] = await Promise.all([
      countWarnings(chat.chat_id, target.userId),
      listWarnings(chat.chat_id, target.userId, 10),
    ]);
    const lines = [
      tr("⚠️ <b>Advertencias de {0}</b>", [targetText(target)]),
      tr("📊 Total: <b>{0}</b> / {1}", [count,ctx.app.settings.warnings.limit]),
      "",
    ];
    if (warnings.length === 0) lines.push(tr("Sin advertencias registradas."));
    else {
      for (const warning of warnings) {
        lines.push(
          `• ${formatDateTime(warning.created_at)}` +
            (warning.reason ? ` — ${escapeHtml(warning.reason)}` : ""),
        );
      }
    }
    await replyTemp(ctx, lines.join("\n"));
  });

  bot.command("unwarn", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const chat = ctx.app.chatRow!;
    const resolved = await resolveTarget(
      ctx.api,
      chat.chat_id,
      ctx.msg!,
      ctx.match ?? "",
    );
    if (!resolved.ok || !resolved.userId) {
      await replyTemp(ctx, `⚠️ ${escapeHtml(resolved.error ?? tr("Usuario no válido."))}`);
      return;
    }
    const removed = await removeLastWarning(chat.chat_id, resolved.userId);
    if (!removed) {
      await replyTemp(ctx, tr("ℹ️ Ese usuario no tiene advertencias."));
      return;
    }
    const count = await countWarnings(chat.chat_id, resolved.userId);
    await replyTemp(
      ctx,
      tr("✅ Advertencia eliminada de {0}. Quedan <b>{1}</b>.", [mentionUser({
        id: resolved.userId,
        first_name: resolved.name ?? tr("Usuario"),
        username: resolved.username,
      }),count]),
    );
  });

  bot.command("resetwarns", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const chat = ctx.app.chatRow!;
    const resolved = await resolveTarget(
      ctx.api,
      chat.chat_id,
      ctx.msg!,
      ctx.match ?? "",
    );
    if (!resolved.ok || !resolved.userId) {
      await replyTemp(ctx, `⚠️ ${escapeHtml(resolved.error ?? tr("Usuario no válido."))}`);
      return;
    }
    const removed = await clearWarnings(chat.chat_id, resolved.userId);
    await replyTemp(ctx, tr("🧹 Se han eliminado <b>{0}</b> advertencia(s).", [removed]));
  });

  bot.command("promote", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (!(await guardAction(ctx))) return;
    const prepared = await prepareTarget(ctx);
    if (!prepared) return;

    let rest = prepared.reason.trim();
    let preset: "moderator" | "full" = "moderator";
    if (/^full(\s|$)/i.test(rest)) {
      preset = "full";
      rest = rest.replace(/^full\s*/i, "").trim();
    }
    try {
      await promoteUser(modContext(ctx), prepared.target, preset, rest || null);
      await replyTemp(
        ctx,
        tr("⬆️ <b>Usuario promovido</b>\n👤 {0}\n", [targetText(prepared.target)]) +
          tr("⚙️ Nivel: <b>{0}</b>", [preset === "full" ? tr("Administrador completo") : tr("Moderador")]) +
          (rest ? tr("\n🏷️ Título: {0}", [escapeHtml(rest)]) : ""),
      );
    } catch (error) {
      await handleModerationError(ctx, error);
    }
  });

  bot.command("demote", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (!(await guardAction(ctx))) return;
    const prepared = await prepareTarget(ctx);
    if (!prepared) return;
    try {
      await demoteUser(modContext(ctx), prepared.target);
      await replyTemp(ctx, tr("⬇️ <b>Usuario degradado</b>\n👤 {0}", [targetText(prepared.target)]));
    } catch (error) {
      await handleModerationError(ctx, error);
    }
  });

  bot.command("lock", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (!(await guardAction(ctx))) return;
    try {
      await lockChat(modContext(ctx));
      await replyTemp(ctx, tr("🔒 <b>Grupo cerrado</b>\nSolo los administradores pueden escribir."));
    } catch (error) {
      await handleModerationError(ctx, error);
    }
  });

  bot.command("unlock", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (!(await guardAction(ctx))) return;
    try {
      await unlockChat(modContext(ctx));
      await replyTemp(ctx, tr("🔓 <b>Grupo abierto</b>\nTodos los miembros pueden escribir."));
    } catch (error) {
      await handleModerationError(ctx, error);
    }
  });

  bot.command("purge", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (!(await guardAction(ctx))) return;
    const chat = ctx.app.chatRow!;
    const message = ctx.msg!;
    const raw = (ctx.match ?? "").trim();
    const requested = Number(raw);
    const count = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 100) : 1;

    let ids: number[];
    const replied = message.reply_to_message;
    if (replied) {
      const from = replied.message_id;
      const to = message.message_id;
      ids = [];
      for (let id = from; id <= to && ids.length < 100; id += 1) ids.push(id);
    } else {
      ids = recentMessageIds(chat.chat_id, count + 1);
    }

    if (ids.length === 0) {
      await replyTemp(ctx, tr("🧹 No hay mensajes recientes para borrar."));
      return;
    }

    const deleted = await purgeMessages(ctx.api, chat.chat_id, ids);
    await replyTemp(ctx, tr("🧹 <b>{0}</b> mensaje(s) eliminado(s).", [deleted]), { seconds: 8 });
  });

  bot.command("del", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (!(await guardAction(ctx))) return;
    const chat = ctx.app.chatRow!;
    const message = ctx.msg!;
    const replied = message.reply_to_message;
    if (!replied) {
      await replyTemp(ctx, tr("🧹 Responde al mensaje que quieres eliminar."));
      return;
    }
    await safeDelete(ctx.api, chat.chat_id, replied.message_id);
    await safeDelete(ctx.api, chat.chat_id, message.message_id);
  });

  bot.command("pin", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    if (!(await guardAction(ctx))) return;
    const chat = ctx.app.chatRow!;
    const replied = ctx.msg?.reply_to_message;
    if (!replied) {
      await replyTemp(ctx, tr("📌 Responde al mensaje que quieres fijar."));
      return;
    }
    try {
      await pinMessage(ctx.api, chat.chat_id, replied.message_id);
      await replyTemp(ctx, tr("📌 Mensaje fijado."));
    } catch (error) {
      await handleModerationError(ctx, error);
    }
  });

  bot.command("unpin", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const chat = ctx.app.chatRow!;
    const replied = ctx.msg?.reply_to_message;
    try {
      await unpinMessage(ctx.api, chat.chat_id, replied?.message_id);
      await replyTemp(ctx, tr("📌 Mensaje desfijado."));
    } catch (error) {
      await handleModerationError(ctx, error);
    }
  });

  bot.command("unpinall", async (ctx) => {
    if (!(await ensureGroupAdmin(ctx))) return;
    const chat = ctx.app.chatRow!;
    try {
      await unpinAll(ctx.api, chat.chat_id);
      await replyTemp(ctx, tr("📌 Todos los mensajes han sido desfijados."));
    } catch (error) {
      await handleModerationError(ctx, error);
    }
  });
}
