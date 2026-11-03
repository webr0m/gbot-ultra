import type { FastifyInstance } from "fastify";
import type { Bot } from "grammy";
import { z } from "zod";
import { config } from "../../config.js";
import type { AppContext } from "../../bot/context.js";
import {
  countModerationLog,
  listModerationLog,
} from "../../db/repositories/moderation.js";
import { getUser } from "../../db/repositories/users.js";
import { clearWarnings } from "../../db/repositories/warnings.js";
import { settingsOf } from "../../services/chat-cache.js";
import { consumeAction, limitMessage } from "../../services/actions.js";
import {
  ModerationError,
  assertActorRight,
  banUser,
  demoteUser,
  kickUser,
  lockChat,
  muteUser,
  promoteUser,
  unbanUser,
  unlockChat,
  unmuteUser,
  warnUser,
  type ModerationContext,
  type TargetInfo,
} from "../../services/moderation.js";
import { getChatMemberSafe } from "../../utils/telegram.js";
import { displayName } from "../../utils/format.js";
import {
  ApiError,
  bodyOf,
  parseIntParam,
  parseChatId,
  requireAuth,
  requireChat,
} from "../helpers.js";
import { serializeLog } from "../serializers.js";

const actionSchema = z.enum([
  "ban",
  "unban",
  "kick",
  "mute",
  "unmute",
  "warn",
  "promote",
  "demote",
  "lock",
  "unlock",
]);

const moderationSchema = z.object({
  chatId: z.number().int().safe(),
  action: actionSchema,
  userId: z.number().int().safe().positive().optional(),
  reason: z.string().max(500).optional(),
  durationSeconds: z.number().int().min(0).max(2_592_000).optional(),
  preset: z.enum(["moderator", "full"]).optional(),
});

const clearWarningsSchema = z.object({
  chatId: z.number().int().safe(),
  userId: z.number().int().safe().positive(),
});

const ACTION_LABELS: Record<string, string> = {
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

async function resolveTarget(
  api: Bot<AppContext>["api"],
  chatId: number,
  userId: number,
): Promise<TargetInfo> {
  const member = await getChatMemberSafe(api, chatId, userId);
  if (member) {
    return {
      userId,
      name: displayName(member.user),
      username: member.user.username ?? null,
    };
  }
  const user = await getUser(userId);
  if (user) {
    return {
      userId,
      name: displayName({
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
      }),
      username: user.username,
    };
  }
  throw new ApiError(404, "Ese usuario no existe o no está en el grupo.");
}

export function registerModerationRoutes(
  app: FastifyInstance,
  bot: Bot<AppContext>,
): void {
  app.get("/api/moderation/log", async (request) => {
    const auth = requireAuth(request);
    const q = request.query as Record<string, unknown>;
    const chatId = parseChatId(q.chat_id ?? q.chatId);
    await requireChat(bot.api, chatId, auth);

    const limit = parseIntParam(q.limit, 30, 1, 100);
    const offset = parseIntParam(q.offset, 0, 0, 20_000);
    const action = typeof q.action === "string" ? q.action.trim().slice(0, 40) : "";

    const [items, total] = await Promise.all([
      listModerationLog(chatId, limit, offset, action),
      countModerationLog(chatId, action),
    ]);

    return {
      ok: true,
      total,
      hasMore: offset + limit < total,
      items: items.map(serializeLog),
    };
  });

  app.post("/api/moderation", async (request) => {
    const auth = requireAuth(request);
    const parsed = moderationSchema.safeParse(bodyOf(request));
    if (!parsed.success) {
      throw new ApiError(400, "Datos de moderación no válidos.", {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }
    const body = parsed.data;
    const chat = await requireChat(bot.api, body.chatId, auth);

    const needsTarget = !["lock", "unlock"].includes(body.action);
    if (needsTarget && !body.userId) {
      throw new ApiError(400, "Indica el usuario sobre el que aplicar la acción.");
    }

    const settings = settingsOf(chat);
    const target = body.userId ? await resolveTarget(bot.api, chat.chat_id, body.userId) : null;
    const isOwner = config.ownerIds.has(auth.user.id);

    const context: ModerationContext = {
      api: bot.api,
      chatId: chat.chat_id,
      chat,
      settings,
      botId: bot.botInfo.id,
      actorId: auth.user.id,
      actorName: displayName(auth.user),
      source: "miniapp",
    };
    try {
      await assertActorRight(context, ["promote", "demote"].includes(body.action) ? "can_promote_members" : "can_restrict_members");
    } catch (error) {
      if (error instanceof ModerationError) throw new ApiError(403, error.userMessage);
      throw error;
    }
    const gate = isOwner
      ? { allowed: true, premium: true, used: 0, limit: 999999, remaining: 999999 }
      : await consumeAction(chat);
    if (!gate.allowed) throw new ApiError(429, limitMessage(gate), { gate });

    try {
      switch (body.action) {
        case "ban":
          await banUser(context, {
            target: target!,
            reason: body.reason ?? "Desde el panel",
            durationSeconds: body.durationSeconds ?? null,
          });
          break;
        case "unban":
          await unbanUser(context, target!);
          break;
        case "kick":
          await kickUser(context, {
            target: target!,
            reason: body.reason ?? "Desde el panel",
          });
          break;
        case "mute":
          await muteUser(context, {
            target: target!,
            reason: body.reason ?? "Desde el panel",
            durationSeconds: body.durationSeconds ?? 3_600,
          });
          break;
        case "unmute":
          await unmuteUser(context, target!);
          break;
        case "warn": {
          const result = await warnUser(context, target!, body.reason ?? null);
          return {
            ok: true,
            action: body.action,
            message: `⚠️ Advertencia ${result.count}/${result.limit} para ${target!.name}.`,
            warn: result,
            gate,
          };
        }
        case "promote":
          await promoteUser(context, target!, body.preset ?? "moderator", body.reason ?? null);
          break;
        case "demote":
          await demoteUser(context, target!);
          break;
        case "lock":
          await lockChat(context);
          break;
        case "unlock":
          await unlockChat(context);
          break;
      }
    } catch (error) {
      if (error instanceof ModerationError) {
        throw new ApiError(400, error.userMessage);
      }
      throw error;
    }

    return {
      ok: true,
      action: body.action,
      message: target
        ? `${ACTION_LABELS[body.action] ?? body.action}: ${target.name}.`
        : (ACTION_LABELS[body.action] ?? body.action),
      target,
      gate,
    };
  });

  app.post("/api/warnings/clear", async (request) => {
    const auth = requireAuth(request);
    const parsed = clearWarningsSchema.safeParse(bodyOf(request));
    if (!parsed.success) {
      throw new ApiError(400, "Datos no válidos.");
    }
    const chat = await requireChat(bot.api, parsed.data.chatId, auth);
    try {
      await assertActorRight({ api: bot.api, chatId: chat.chat_id, chat, settings: settingsOf(chat), botId: bot.botInfo.id, actorId: auth.user.id, actorName: displayName(auth.user), source: "miniapp" }, "can_restrict_members");
    } catch (error) {
      if (error instanceof ModerationError) throw new ApiError(403, error.userMessage);
      throw error;
    }
    const target = await resolveTarget(bot.api, chat.chat_id, parsed.data.userId);
    const removed = await clearWarnings(chat.chat_id, target.userId);
    return { ok: true, removed, message: `Se han borrado ${removed} advertencia(s) de ${target.name}.` };
  });
}
