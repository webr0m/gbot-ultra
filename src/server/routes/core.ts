import { COMMUNITY } from "../../services/community.js";
import { DEVELOPER_ID } from "../../services/roles.js";
import type { FastifyInstance } from "fastify";
import type { Bot } from "grammy";
import type { AppContext } from "../../bot/context.js";
import { config } from "../../config.js";
import { mapConcurrent } from "../../utils/concurrency.js";
import { globalRole, globalRoleLabel } from "../../services/roles.js";
import { chatTier } from '../../services/entitlements.js';
import {
  getActiveChats,
  getAdminChatsForUser,
  getChatsOwnedBy,
} from "../../db/repositories/chats.js";
import { countCustomCommands, countNotes } from "../../db/repositories/commands.js";
import { listModerationLog } from "../../db/repositories/moderation.js";
import { getActionCount } from "../../db/repositories/stats.js";
import { query } from "../../db/pool.js";
import { settingsOf } from "../../services/chat-cache.js";
import { commandLimit, noteLimit } from "../../services/limits.js";
import {
  PREMIUM_PERKS,
  PREMIUM_PLANS,
  getPaymentHistory,
  getPremiumStatus,
  premiumPlanLabel,
} from "../../services/premium.js";
import { getChartData, getGroupStats, getTopMembers } from "../../services/stats.js";
import { getBotRightsMap, getChatMemberSafe, isAdminStatus } from "../../utils/telegram.js";
import { avatarUrl } from "../auth.js";
import { operationsStatus } from '../../services/operations-status.js';
import {
  parseIntParam,
  parseChatId,
  requireAuth,
  requireChat,
} from "../helpers.js";
import {
  serializeChatSummary,
  serializeLog,
  serializePayment,
  serializePlan,
} from "../serializers.js";

export function registerCoreRoutes(app: FastifyInstance, bot: Bot<AppContext>): void {
  app.get('/api/operations',async(request,reply)=>{
    const auth=requireAuth(request),q=request.query as Record<string,unknown>;
    await requireChat(bot.api,parseChatId(q.chat_id??q.chatId),auth);
    reply.header('Cache-Control','no-store');
    return {ok:true,...await operationsStatus()};
  });
  app.get("/api/health", async (_request, reply) => {
    let database = "ok";
    try {
      await query("SELECT 1");
    } catch {
      database = "error";
    }
    const healthy = database === "ok";
    return reply.code(healthy ? 200 : 503).send({
      ok: healthy,
      version: config.version,
      uptime: Math.round(process.uptime()),
      botMode: config.botMode,
      schedulerMode: config.schedulerMode,
      database,
      bot: {
        id: bot.botInfo.id,
        username: bot.botInfo.username,
        name: bot.botInfo.first_name,
      },
      serverTime: new Date().toISOString(),
    });
  });

  app.get("/api/plans", async () => ({
    ok: true,
    plans: PREMIUM_PLANS.map(serializePlan),
    perks: PREMIUM_PERKS,
    limits: {
      freeActions: config.freeActionLimit,
      premiumActions: config.premiumActionLimit,
      freeCommands: commandLimit(false),
      premiumCommands: commandLimit(true),
      freeNotes: noteLimit(false),
      premiumNotes: noteLimit(true),
    },
  }));

  app.get("/api/chats", async (request) => {
    const auth = requireAuth(request);
    const [adminChats, ownedChats] = await Promise.all([
      getAdminChatsForUser(auth.user.id),
      getChatsOwnedBy(auth.user.id),
    ]);

    let chats = [...adminChats, ...ownedChats];
    if (config.ownerIds.has(auth.user.id)) {
      chats = [...chats, ...(await getActiveChats())];
    } else {
      // Incluye grupos donde el usuario es administrador en Telegram,
      // aunque todavía no esté registrado en la base de datos local.
      const active = await getActiveChats();
      const missing = active.filter(
        (chat) => !chats.some((item) => item.chat_id === chat.chat_id),
      );
      const checks = await mapConcurrent(missing, 5, async (chat) => {
          const member = await getChatMemberSafe(bot.api, chat.chat_id, auth.user.id).catch(
            () => null,
          );
          return member && isAdminStatus(member.status) ? chat : null;
        });
      for (const chat of checks) {
        if (chat) chats.push(chat);
      }
    }

    const unique = new Map(chats.map((chat) => [chat.chat_id, chat]));
    return {
      ok: true,
      chats: [...unique.values()]
        .sort((left, right) => left.title.localeCompare(right.title, "es"))
        .map(serializeChatSummary),
    };
  });

  app.get("/api/bootstrap", async (request) => {
    const auth = requireAuth(request);
    const q = request.query as Record<string, unknown>;
    const chatId = parseChatId(q.chat_id ?? q.chatId);
    const chat = await requireChat(bot.api, chatId, auth);
    const settings = settingsOf(chat);
    const premium = getPremiumStatus(chat);
    const owner = config.ownerIds.has(auth.user.id);
    const effectivePremium = premium.active || owner;

    const [stats, chart, top, rights, logs, payments, commands, notes, liveChat, actor] =
      await Promise.all([
        getGroupStats(bot.api, chatId, chat),
        getChartData(chatId, effectivePremium ? 14 : 7),
        getTopMembers(chatId, "week", 5),
        getBotRightsMap(bot.api, chatId, bot.botInfo.id),
        listModerationLog(chatId, 8),
        getPaymentHistory(chatId, 3),
        countCustomCommands(chatId),
        countNotes(chatId),
        bot.api.getChat(chatId).catch(() => null),
        owner ? Promise.resolve(null) : getChatMemberSafe(bot.api, chatId, auth.user.id),
      ]);

    const actionCount = stats.actionsToday;

    const limit = effectivePremium ? config.premiumActionLimit : config.freeActionLimit;

    return {
      ok: true,
      community: COMMUNITY,
      access: { owner, broadcast: DEVELOPER_ID>0&&auth.user.id===DEVELOPER_ID, role: globalRole(auth.user.id, config.ownerIds), actorRights: {
        can_restrict_members: owner || actor?.status === "creator" || (actor?.status === "administrator" && actor.can_restrict_members),
        can_promote_members: owner || actor?.status === "creator" || (actor?.status === "administrator" && actor.can_promote_members),
      } },
      user: {
        id: auth.user.id,
        role: globalRole(auth.user.id, config.ownerIds),
        roleLabel: globalRoleLabel(globalRole(auth.user.id, config.ownerIds)),
        firstName: auth.user.first_name,
        lastName: auth.user.last_name ?? null,
        username: auth.user.username ?? null,
        languageCode: auth.user.language_code ?? null,
        avatarUrl: avatarUrl(chatId, auth.user.id),
        dev: auth.dev,
      },
      chat: {
        id: chat.chat_id,
        photoUrl: avatarUrl(chat.chat_id,chat.chat_id),
        title: liveChat?.title ?? chat.title,
        username: liveChat?.username ?? chat.username,
        type: chat.type,
        description: liveChat?.description ?? chat.description,
        memberCount: stats.memberCount,
        adminCount: stats.adminCount,
        botCount: stats.botCount,
        trackedMembers: stats.trackedMembers,
        boosts: stats.boosts,
        premium: {
          tier: chatTier(chat,auth.user.id),
          active: premium.active,
          plan: premium.plan,
          planLabel: premiumPlanLabel(premium.plan),
          until: premium.until?.toISOString() ?? null,
          daysLeft: premium.daysLeft,
        },
      },
      stats,
      chart,
      top: top.map((member) => ({
        id: member.user_id,
        firstName: member.first_name,
        username: member.username,
        messages: Number(member.messages),
        avatarUrl: avatarUrl(chatId, member.user_id),
      })),
      settings,
      limits: {
        actions: {
          used: actionCount,
          limit,
          remaining: Math.max(0, limit - actionCount),
        },
        commands: { used: commands, limit: commandLimit(effectivePremium) },
        notes: { used: notes, limit: noteLimit(effectivePremium) },
      },
      ads: {
        enabled: config.adBannerEnabled && !effectivePremium,
        text: config.adBannerText,
        url: config.adBannerUrl,
      },
      plans: PREMIUM_PLANS.map(serializePlan),
      perks: PREMIUM_PERKS,
      payments: payments.map(serializePayment),
      logs: logs.map(serializeLog),
      botRights: rights,
      serverTime: new Date().toISOString(),
    };
  });

  app.get("/api/stats", async (request) => {
    const auth = requireAuth(request);
    const q = request.query as Record<string, unknown>;
    const chatId = parseChatId(q.chat_id ?? q.chatId);
    const chat = await requireChat(bot.api, chatId, auth);
    const premium = getPremiumStatus(chat).active || config.ownerIds.has(auth.user.id);
    const requested = parseIntParam(q.days, 14, 7, 90);
    const days = premium ? requested : Math.min(requested, 7);

    const [stats, chart, top] = await Promise.all([
      getGroupStats(bot.api, chatId),
      getChartData(chatId, days),
      getTopMembers(chatId, days <= 7 ? "week" : "month", 10),
    ]);

    return {
      ok: true,
      days,
      premium,
      limited: days < requested,
      stats,
      chart,
      top: top.map((member) => ({
        id: member.user_id,
        firstName: member.first_name,
        username: member.username,
        messages: Number(member.messages),
        avatarUrl: avatarUrl(chatId, member.user_id),
      })),
    };
  });
}
