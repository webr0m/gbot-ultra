import type { FastifyInstance } from "fastify";
import type { Bot } from "grammy";
import { config } from "../../config.js";
import safeRegex from "safe-regex2";
import { z } from "zod";
import type { AppContext } from "../../bot/context.js";
import { RESERVED_COMMAND_NAMES } from "../../bot/handlers/content.js";
import {
  countCustomCommands,
  countNotes,
  deleteCustomCommand,
  deleteNote,
  getCustomCommand,
  getNote,
  listCustomCommands,
  listNotes,
  upsertCustomCommand,
  upsertNote,
} from "../../db/repositories/commands.js";
import {
  addBlacklist,
  listBlacklist,
  removeBlacklist,
} from "../../db/repositories/filters.js";
import { invalidateBlacklist } from "../../services/antispam.js";
import { patchChatSettings, settingsOf } from "../../services/chat-cache.js";
import { commandLimit, noteLimit } from "../../services/limits.js";
import { getPremiumStatus } from "../../services/premium.js";
import {
  applySettingsPatch,
  settingsPatchSchema,
} from "../../services/settings.js";
import {
  ApiError,
  bodyOf,
  parseChatId,
  requireAuth,
  requireChat,
} from "../helpers.js";

const patchSchema = z.object({
  chatId: z.number().int().safe(),
  patch: z.record(z.string(), z.unknown()),
});

const commandSchema = z.object({
  chatId: z.number().int().safe(),
  name: z.string().min(1).max(64),
  content: z.string().min(1).max(2_000),
});

const nameSchema = z.object({
  chatId: z.number().int().safe(),
  name: z.string().min(1).max(64),
});

const blacklistSchema = z.object({
  chatId: z.number().int().safe(),
  pattern: z.string().min(1).max(200),
  isRegex: z.boolean().optional(),
});

function normalizeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/^[/!#]/, "");
}

function validCommandName(raw: string): string {
  const name = normalizeName(raw);
  if (!/^[a-z0-9_]{1,32}$/.test(name)) {
    throw new ApiError(
      400,
      "El nombre solo puede contener letras, números y guiones bajos (máx. 32).",
    );
  }
  if (RESERVED_COMMAND_NAMES.has(name)) {
    throw new ApiError(400, "Ese nombre está reservado por un comando del bot.");
  }
  return name;
}

function validNoteName(raw: string): string {
  const name = normalizeName(raw);
  if (!/^[a-z0-9_]{1,32}$/.test(name)) {
    throw new ApiError(
      400,
      "El nombre solo puede contener letras, números y guiones bajos (máx. 32).",
    );
  }
  return name;
}

export function registerSettingsRoutes(
  app: FastifyInstance,
  bot: Bot<AppContext>,
): void {
  app.get("/api/settings", async (request) => {
    const auth = requireAuth(request);
    const q = request.query as Record<string, unknown>;
    const chatId = parseChatId(q.chat_id ?? q.chatId);
    const chat = await requireChat(bot.api, chatId, auth);
    const premium = getPremiumStatus(chat);
    const owner = config.ownerIds.has(auth.user.id);
    const effectivePremium = premium.active || owner;
    return {
      ok: true,
      settings: settingsOf(chat),
      premium,
      limits: {
        commands: { used: await countCustomCommands(chatId), limit: commandLimit(effectivePremium) },
        notes: { used: await countNotes(chatId), limit: noteLimit(effectivePremium) },
      },
    };
  });

  app.patch("/api/settings", async (request) => {
    const auth = requireAuth(request);
    const parsed = patchSchema.safeParse(bodyOf(request));
    if (!parsed.success) {
      throw new ApiError(400, "Datos de ajustes no válidos.");
    }
    const chat = await requireChat(bot.api, parsed.data.chatId, auth);
    const patch = settingsPatchSchema.safeParse(parsed.data.patch);
    if (!patch.success) {
      throw new ApiError(400, "Ajuste no válido.", {
        issues: patch.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }

    const premium = getPremiumStatus(chat).active;
    const owner = config.ownerIds.has(auth.user.id);
    const effectivePremium = premium || owner;
    const result = await patchChatSettings(chat.chat_id, patch.data, effectivePremium);
    if (!result.ok || !result.settings) {
      throw new ApiError(result.premiumFeature ? 402 : 400, result.error ?? "No se pudo aplicar el ajuste.", {
        premiumFeature: result.premiumFeature ?? null,
      });
    }

    return { ok: true, settings: result.settings, premium: effectivePremium };
  });

  app.get("/api/content", async (request) => {
    const auth = requireAuth(request);
    const q = request.query as Record<string, unknown>;
    const chatId = parseChatId(q.chat_id ?? q.chatId);
    const chat = await requireChat(bot.api, chatId, auth);
    const premium = getPremiumStatus(chat).active || config.ownerIds.has(auth.user.id);

    const [commands, notes, blacklist, commandCount, noteCount] = await Promise.all([
      listCustomCommands(chatId),
      listNotes(chatId),
      listBlacklist(chatId),
      countCustomCommands(chatId),
      countNotes(chatId),
    ]);

    return {
      ok: true,
      commands,
      notes,
      blacklist,
      limits: {
        commands: { used: commandCount, limit: commandLimit(premium) },
        notes: { used: noteCount, limit: noteLimit(premium) },
        blacklist: { used: blacklist.length, limit: premium ? 500 : 50 },
      },
    };
  });

  app.post("/api/content/command", async (request) => {
    const auth = requireAuth(request);
    const parsed = commandSchema.safeParse(bodyOf(request));
    if (!parsed.success) throw new ApiError(400, "Datos no válidos.");
    const chat = await requireChat(bot.api, parsed.data.chatId, auth);
    const premium = getPremiumStatus(chat).active || config.ownerIds.has(auth.user.id);
    const name = validCommandName(parsed.data.name);
    const existing = await getCustomCommand(chat.chat_id, name);
    if (!existing) {
      const count = await countCustomCommands(chat.chat_id);
      if (count >= commandLimit(premium)) {
        throw new ApiError(
          402,
          `El plan ${premium ? "Premium" : "gratuito"} permite ${commandLimit(premium)} comandos.`,
        );
      }
    }
    const command = await upsertCustomCommand(
      chat.chat_id,
      name,
      parsed.data.content,
      auth.user.id,
    );
    return { ok: true, command, updated: Boolean(existing) };
  });

  app.delete("/api/content/command", async (request) => {
    const auth = requireAuth(request);
    const parsed = nameSchema.safeParse(bodyOf(request));
    if (!parsed.success) throw new ApiError(400, "Datos no válidos.");
    const chat = await requireChat(bot.api, parsed.data.chatId, auth);
    const name = normalizeName(parsed.data.name);
    const removed = await deleteCustomCommand(chat.chat_id, name);
    if (!removed) throw new ApiError(404, "Ese comando no existe.");
    return { ok: true };
  });

  app.post("/api/content/note", async (request) => {
    const auth = requireAuth(request);
    const parsed = commandSchema.safeParse(bodyOf(request));
    if (!parsed.success) throw new ApiError(400, "Datos no válidos.");
    const chat = await requireChat(bot.api, parsed.data.chatId, auth);
    const premium = getPremiumStatus(chat).active || config.ownerIds.has(auth.user.id);
    const name = validNoteName(parsed.data.name);
    const existing = await getNote(chat.chat_id, name);
    if (!existing) {
      const count = await countNotes(chat.chat_id);
      if (count >= noteLimit(premium)) {
        throw new ApiError(
          402,
          `El plan ${premium ? "Premium" : "gratuito"} permite ${noteLimit(premium)} notas.`,
        );
      }
    }
    const note = await upsertNote(chat.chat_id, name, parsed.data.content, auth.user.id);
    return { ok: true, note, updated: Boolean(existing) };
  });

  app.delete("/api/content/note", async (request) => {
    const auth = requireAuth(request);
    const parsed = nameSchema.safeParse(bodyOf(request));
    if (!parsed.success) throw new ApiError(400, "Datos no válidos.");
    const chat = await requireChat(bot.api, parsed.data.chatId, auth);
    const name = normalizeName(parsed.data.name);
    const removed = await deleteNote(chat.chat_id, name);
    if (!removed) throw new ApiError(404, "Esa nota no existe.");
    return { ok: true };
  });

  app.post("/api/content/blacklist", async (request) => {
    const auth = requireAuth(request);
    const parsed = blacklistSchema.safeParse(bodyOf(request));
    if (!parsed.success) throw new ApiError(400, "Datos no válidos.");
    const chat = await requireChat(bot.api, parsed.data.chatId, auth);
    const isRegex = parsed.data.isRegex ?? false;
    const pattern = parsed.data.pattern.trim();
    if (isRegex && !safeRegex(pattern, { limit: 250 })) {
      throw new ApiError(400, "La expresión regular es demasiado compleja o insegura.");
    }
    const entry = await addBlacklist(chat.chat_id, pattern, isRegex, auth.user.id);
    invalidateBlacklist(chat.chat_id);
    return { ok: true, entry };
  });

  app.delete("/api/content/blacklist", async (request) => {
    const auth = requireAuth(request);
    const parsed = blacklistSchema.safeParse(bodyOf(request));
    if (!parsed.success) throw new ApiError(400, "Datos no válidos.");
    const chat = await requireChat(bot.api, parsed.data.chatId, auth);
    const removed = await removeBlacklist(chat.chat_id, parsed.data.pattern.trim());
    if (!removed) throw new ApiError(404, "Ese patrón no existe.");
    invalidateBlacklist(chat.chat_id);
    return { ok: true };
  });
}
