import {messageContent,isGuestMessage,moderationUser} from './message-content.js';
import { recordRuleEvent, ruleRevision } from "./rule-quality.js";
import { tr } from "./bot-i18n.js";
import type { Api } from "grammy";
import type { Message, MessageEntity, User } from "grammy/types";
import safeRegex from "safe-regex2";
import { config } from "../config.js";
import type { BlacklistRow, ChatRow, GroupSettings } from "../db/types.js";
import { addWarning, countWarnings, clearWarnings } from "../db/repositories/warnings.js";
import { listBlacklist } from "../db/repositories/filters.js";
import { logger } from "../logger.js";
import { untilDateFromSeconds } from "../utils/duration.js";
import { escapeHtml } from "../utils/format.js";
import { MUTED_PERMISSIONS } from "./moderation.js";
import type { ModerationContext, TargetInfo } from "./moderation.js";
import { banUser, muteUser, warnUser } from "./moderation.js";
import { logModeration } from '../db/repositories/moderation.js';
import { globalBan, invalidateGlobalBan } from './global-bans.js';

interface BlacklistCacheEntry {
  rows: BlacklistRow[];
  expiresAt: number;
}

const blacklistCache = new Map<number, BlacklistCacheEntry>();
const floodTracker = new Map<string, number[]>();

const BLACKLIST_TTL_MS = 60_000;

export function invalidateBlacklist(chatId: number): void {
  blacklistCache.delete(chatId);
}

export function invalidateGban(userId?: number): void {
  invalidateGlobalBan(userId);
}

async function getBlacklist(chatId: number): Promise<BlacklistRow[]> {
  const cached = blacklistCache.get(chatId);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const rows = await listBlacklist(chatId);
  blacklistCache.set(chatId, { rows, expiresAt: Date.now() + BLACKLIST_TTL_MS });
  return rows;
}

function textOf(message: Message): string {return messageContent(message).text;}

export function extractLinks(message: Message): string[] {return messageContent(message).links;}

function hostnameOf(link: string): string | null {
  try {
    const normalized = /^https?:\/\//i.test(link)
      ? link
      : `https://${link.replace(/^\/+/, "")}`;
    return new URL(normalized).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isWhitelisted(link: string, whitelist: string[]): boolean {
  const host = hostnameOf(link);
  if (!host) return false;
  return whitelist.some((entry) => {
    const domain = entry.toLowerCase().replace(/^www\./, "");
    return host === domain || host.endsWith(`.${domain}`);
  });
}

export function matchesBlacklist(message: Message, rows: BlacklistRow[]): BlacklistRow | null {
  const text = textOf(message).toLowerCase();
  if (!text) return null;
  for (const row of rows) {
    if (row.is_regex) {
      if (!safeRegex(row.pattern, { limit: 250 })) continue;
      try {
        if (new RegExp(row.pattern, "iu").test(text)) return row;
      } catch {
        continue;
      }
    } else if (text.includes(row.pattern.toLowerCase())) {
      return row;
    }
  }
  return null;
}

function targetOf(user: User): TargetInfo {
  return {
    userId: user.id,
    name: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || tr("Usuario"),
    username: user.username ?? null,
  };
}

function moderationContext(
  api: Api,
  chat: ChatRow,
  settings: GroupSettings,
  botId: number,
): ModerationContext {
  return {
    api,
    chatId: chat.chat_id,
    chat,
    settings,
    botId,
    actorId: botId,
    actorName: tr("GBot Ultra"),
    source: "bot",
  };
}

async function deleteMessage(api: Api, chatId: number, messageId: number): Promise<boolean> {
  try {
    await api.deleteMessage(chatId, messageId);
    return true;
  } catch {
    return false;
  }
}

async function notifyLog(
  api: Api,
  settings: GroupSettings,
  chatTitle: string,
  text: string,
): Promise<void> {
  if (!settings.logs.enabled || !settings.logs.chatId) return;
  try {
    await api.sendMessage(
      settings.logs.chatId,
      tr("🛡️ <b>Automoderación</b>\n📌 {0}\n{1}", [escapeHtml(chatTitle),text]),
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
  } catch (error) {
    logger.warn({ err: error, logChatId: settings.logs.chatId }, tr("No se pudo notificar al canal de logs"));
  }
}

export type AntispamRule = "blacklist" | "antilink" | "antiflood";

export interface AntispamHit {
  rule: AntispamRule;
  action: string;
  detail: string;
}

/**
 * Evaluador único de lista negra, antienlaces y antiflood, en el orden de
 * aplicación. Es puro: no consulta la base de datos ni cambia contadores.
 */
export function antispamHits(
  message: Message,
  settings: Pick<GroupSettings, "blacklist" | "antilink" | "antiflood">,
  blacklistRows: BlacklistRow[],
  floodCount: number,
): AntispamHit[] {
  const hits: AntispamHit[] = [];
  if (settings.blacklist.enabled) {
    const match = matchesBlacklist(message, blacklistRows);
    if (match) hits.push({ rule: "blacklist", action: settings.blacklist.action, detail: match.pattern });
  }
  if (settings.antilink.enabled) {
    const links = extractLinks(message).filter((link) => !isWhitelisted(link, settings.antilink.whitelist));
    if (links.length > 0) hits.push({ rule: "antilink", action: settings.antilink.action, detail: links[0]!.slice(0, 200) });
  }
  if (settings.antiflood.enabled && floodCount >= settings.antiflood.limit) {
    hits.push({
      rule: "antiflood",
      action: "mute",
      detail: tr("{0} mensajes en {1}s", [settings.antiflood.limit,settings.antiflood.windowSeconds]),
    });
  }
  return hits;
}

export interface AntispamResult {
  handled: boolean;
  reason?: string;
}

/**
 * Aplica gban, lista negra, antienlaces y antiflood a un mensaje de un
 * miembro que no es administrador. Devuelve handled=true si el mensaje
 * fue eliminado y no debe seguir procesándose.
 */
export async function enforceAntispam(
  api: Api,
  chat: ChatRow,
  settings: GroupSettings,
  message: Message,
  user: User,
  botId: number,
  options: {observe?:boolean;global?:'only'|'skip';countFlood?:boolean} = {},
): Promise<AntispamResult> {
  if (config.ownerIds.has(user.id)) return { handled: false };
  const observe=options.observe??false;
  const deleteOnly=Boolean(message.sender_chat)||(isGuestMessage(message)&&!moderationUser(message));
  const chatId = chat.chat_id;
  const target = targetOf(user);
  const context = moderationContext(api, chat, settings, botId);

  // 1. Baneo global
  const global=options.global==='skip'||deleteOnly?{banned:false}:await globalBan(user.id);
  if (global.banned) {
    await deleteMessage(api, chatId, message.message_id);
    try {
      await banUser(context, { target, reason: global.source==='cas'?tr("CAS: registro externo de spam"):global.reason??tr("Baneo global (GBot)"),durationSeconds:global.source==='cas'?86400:null,metadata:{externalSource:global.source,checkedAt:global.checkedAt} });
    } catch (error) {
      logger.warn({ err: error, chatId, userId: user.id }, tr("No se pudo aplicar el baneo global"));
    }
    await notifyLog(api, settings, chat.title, tr("🚫 <b>Baneo global {0}</b>: {1}", [global.source==='cas'?tr("· CAS"):'',escapeHtml(target.name)]));
    return { handled: true, reason: "gban" };
  }
  if(options.global==='only')return {handled:false};

  // 2-4. Lista negra, antienlaces y antiflood: el mismo evaluador que usa el simulador.
  const floodKey = `${chatId}:${user.id}`;
  const now = Date.now();
  const windowMs = settings.antiflood.windowSeconds * 1_000;
  const floodTimes = settings.antiflood.enabled&&!deleteOnly
    ? [...(floodTracker.get(floodKey) ?? []).filter((time) => now - time < windowMs), ...(options.countFlood===false?[]:[now])]
    : [];
  const blacklistRows = settings.blacklist.enabled ? await getBlacklist(chatId) : [];
  const hit = antispamHits(message, settings, blacklistRows, floodTimes.length)[0];
  if (settings.antiflood.enabled && !hit) {
    floodTracker.set(floodKey, floodTimes);
    if (floodTracker.size > 5_000) {
      for (const [entryKey, values] of floodTracker) {
        if (values.every((time) => now - time > windowMs)) floodTracker.delete(entryKey);
      }
    }
  }
  if (hit?.rule === "antiflood") floodTracker.delete(floodKey);
  if (!hit) return { handled: false };

  const revision=ruleRevision({rule:settings[hit.rule],blacklist:hit.rule==='blacklist'?blacklistRows.map(r=>[r.pattern,r.is_regex]):undefined});
  const metric=(outcome:'applied'|'observation'|'error')=>recordRuleEvent(chatId,message.message_id,hit.rule,revision,hit.action,outcome);
  if (observe) {
    await metric('observation');
    const reason =
      hit.rule === "blacklist" ? tr("Lista negra: {0}", [hit.detail]) : hit.rule === "antilink" ? tr("Antienlaces") : tr("Antiflood");
    await logModeration({ chatId, targetId: user.id, action: "observation", reason, metadata: { would: hit.action } });
    return { handled: false, reason: hit.rule };
  }

  let succeeded=await deleteMessage(api, chatId, message.message_id);
  if(deleteOnly){await logModeration({chatId,action:'delete_channel_post',reason:hit.rule,metadata:{guest:isGuestMessage(message),senderChatId:message.guest_bot_caller_chat?.id??message.sender_chat?.id,applied:succeeded}});await metric(succeeded?'applied':'error');return {handled:true,reason:hit.rule};}
  if (hit.rule === "blacklist") {
    try {
      if (hit.action === "warn") {
        await warnUser(context, target, tr("Lista negra: {0}", [hit.detail]));
      } else if (hit.action === "mute") {
        await muteUser(context, { target, reason: tr("Lista negra: {0}", [hit.detail]), durationSeconds: 3_600 });
      } else if (hit.action === "ban") {
        await banUser(context, { target, reason: tr("Lista negra: {0}", [hit.detail]) });
      }
    } catch (error) {
      succeeded=false;
    logger.warn({ err: error, chatId, userId: user.id }, tr("No se pudo aplicar la lista negra"));
    }
    await notifyLog(
      api,
      settings,
      chat.title,
      tr("🚫 <b>Lista negra</b> ({0}): {1}\n", [escapeHtml(hit.action),escapeHtml(target.name)]) +
        tr("Patrón: <code>{0}</code>", [escapeHtml(hit.detail)]),
    );
    await metric(succeeded?'applied':'error');
    return { handled: true, reason: "blacklist" };
  }
  if (hit.rule === "antilink") {
    try {
      if (hit.action === "mute") {
        await muteUser(context, {
          target,
          reason: tr("Enlace no permitido"),
          durationSeconds: settings.antilink.muteSeconds,
        });
      } else if (hit.action === "ban") {
        await banUser(context, { target, reason: tr("Enlace no permitido") });
      }
    } catch (error) {
      succeeded=false;
    logger.warn({ err: error, chatId, userId: user.id }, tr("No se pudo aplicar el antienlaces"));
    }
    await notifyLog(
      api,
      settings,
      chat.title,
      tr("🔗 <b>Antienlaces</b> ({0}): {1}\n", [escapeHtml(hit.action),escapeHtml(target.name)]) +
        `<code>${escapeHtml(hit.detail)}</code>`,
    );
    await metric(succeeded?'applied':'error');
    return { handled: true, reason: "antilink" };
  }
  try {
    await muteUser(context, {
      target,
      reason: tr("Antiflood ({0} mensajes en {1}s)", [settings.antiflood.limit,settings.antiflood.windowSeconds]),
      durationSeconds: settings.antiflood.muteSeconds,
    });
  } catch (error) {
    succeeded=false;
    logger.warn({ err: error, chatId, userId: user.id }, tr("No se pudo aplicar el antiflood"));
  }
  await notifyLog(
    api,
    settings,
    chat.title,
    tr("🌊 <b>Antiflood</b>: {0} silenciado ", [escapeHtml(target.name)]) +
      tr("{0} min.", [Math.round(settings.antiflood.muteSeconds / 60)]),
  );
  await metric(succeeded?'applied':'error');
  return { handled: true, reason: "antiflood" };
}

export function resetFloodTracker(chatId?: number): void {
  if (chatId === undefined) {
    floodTracker.clear();
    return;
  }
  for (const key of floodTracker.keys()) {
    if (key.startsWith(`${chatId}:`)) floodTracker.delete(key);
  }
}
