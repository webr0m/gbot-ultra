import type { FastifyInstance } from "fastify";
import type { Bot } from "grammy";
import type { ChatMember } from "grammy/types";
import type { AppContext } from "../../bot/context.js";
import {
  getMember,
  memberPage,
} from "../../db/repositories/members.js";
import {
  countWarnings,
  listWarnings,
} from "../../db/repositories/warnings.js";
import { listModerationLog } from "../../db/repositories/moderation.js";
import { getChatMemberSafe, isAdminStatus, memberStatusLabel } from "../../utils/telegram.js";
import { avatarUrl } from "../auth.js";
import { config } from "../../config.js";
import { globalRole, globalRoleLabel } from "../../services/roles.js";
import { MEMBER_FILTERS, type MemberFilter } from "../../services/member-filters.js";
import {
  ApiError,
  parseIntParam,
  parseChatId,
  parseString,
  requireAuth,
  requireChat,
} from "../helpers.js";
import { serializeLog, serializeMember } from "../serializers.js";

function displayName(firstName: string, lastName: string | null, username: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim() || username || "Usuario";
}

export function registerMemberRoutes(app: FastifyInstance, bot: Bot<AppContext>): void {
  app.get("/api/members", async (request) => {
    const auth = requireAuth(request);
    const q = request.query as Record<string, unknown>;
    const chatId = parseChatId(q.chat_id ?? q.chatId);
    await requireChat(bot.api, chatId, auth);

    const limit = parseIntParam(q.limit, 50, 1, 200);
    const offset = parseIntParam(q.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const search = parseString(q.q, 100);
    const filter = parseString(q.filter, 20) || "all";
    if (!MEMBER_FILTERS.includes(filter as MemberFilter)) throw new ApiError(400, "Filtro de miembros no válido.");

    const admins = await bot.api.getChatAdministrators(chatId).catch(() => [] as ChatMember[]);
    const page = await memberPage(chatId, search, filter as MemberFilter, offset, limit, admins.map(admin => ({
      user_id: admin.user.id, status: admin.status, first_name: admin.user.first_name,
      last_name: admin.user.last_name ?? null, username: admin.user.username ?? null,
      is_bot: admin.user.is_bot, custom_title: (admin as {custom_title?:string}).custom_title ?? null,
    })));
    return {
      ok: true, ...page, liveAdmins: admins.length,
      members: page.members.map(row => ({...serializeMember(row, chatId, row.warn_count ?? 0), liveAdmin: row.live_admin})),
    };
  });

  app.get("/api/members/:userId", async (request) => {
    const auth = requireAuth(request);
    const params = request.params as Record<string, string>;
    const q = request.query as Record<string, unknown>;
    const chatId = parseChatId(q.chat_id ?? q.chatId);
    const userId = Number(params.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new ApiError(400, "El identificador del usuario no es válido.");
    }
    await requireChat(bot.api, chatId, auth);

    const [dbMember, liveMember, warns, warningRows, logs] = await Promise.all([
      getMember(chatId, userId),
      getChatMemberSafe(bot.api, chatId, userId),
      countWarnings(chatId, userId),
      listWarnings(chatId, userId, 20, true),
      listModerationLog(chatId, 100),
    ]);

    if (!dbMember && !liveMember) {
      throw new ApiError(404, "Ese usuario no está en el grupo.");
    }

    const user = liveMember?.user;
    const member = dbMember
      ? serializeMember(
          {
            ...dbMember,
            username: user?.username ?? null,
            first_name: user?.first_name ?? "",
            last_name: user?.last_name ?? null,
          },
          chatId,
          warns,
        )
      : {
          id: userId,
          roleLabel: globalRoleLabel(globalRole(userId, config.ownerIds)),
          firstName: user?.first_name ?? "Usuario",
          lastName: user?.last_name ?? null,
          username: user?.username ?? null,
          displayName: displayName(user?.first_name ?? "Usuario", user?.last_name ?? null, user?.username ?? null),
          status: liveMember?.status ?? "member",
          statusLabel: memberStatusLabel(liveMember?.status ?? "member"),
          customTitle: (liveMember as { custom_title?: string } | null)?.custom_title ?? null,
          isBot: user?.is_bot ?? false,
          messages: 0,
          warns,
          joinedAt: null,
          lastSeenAt: null,
          lastMessageAt: null,
          avatarUrl: avatarUrl(chatId, userId),
          liveAdmin: Boolean(liveMember && isAdminStatus(liveMember.status)),
        };

    return {
      ok: true,
      member,
      warnings: warningRows.map((row) => ({
        id: row.id,
        reason: row.reason,
        adminId: row.admin_id,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at?.toISOString()??null,
        resolvedAt: row.resolved_at?.toISOString()??null,
        active: !row.resolved_at && (!row.expires_at || row.expires_at.getTime()>Date.now()),
      })),
      recentActions: logs
        .filter((log) => log.target_id === userId)
        .slice(0, 10)
        .map(serializeLog),
    };
  });
}
