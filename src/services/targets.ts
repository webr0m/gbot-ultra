import { tr } from "./bot-i18n.js";
import type { Api } from "grammy";
import type { Message, User } from "grammy/types";
import { findUserByUsername } from "../db/repositories/users.js";
import { getChatMemberSafe } from "../utils/telegram.js";

export interface ResolvedTarget {
  ok: boolean;
  userId?: number;
  user?: User;
  name?: string;
  username?: string | null;
  rest: string;
  error?: string;
}

function fromUser(user: User, rest: string): ResolvedTarget {
  return {
    ok: true,
    userId: user.id,
    user,
    name: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || tr("Usuario"),
    username: user.username ?? null,
    rest,
  };
}

function error(message: string, rest = ""): ResolvedTarget {
  return { ok: false, error: message, rest };
}

function numericId(value: string): number | null {
  if (!/^-?\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * Resuelve el objetivo de un comando:
 *  1. Mensaje respondido.
 *  2. Mención con entidad text_mention.
 *  3. @usuario (base de datos o getChat).
 *  4. ID numérico.
 */
export async function resolveTarget(
  api: Api,
  chatId: number,
  message: Message,
  args: string,
  options: { requireMember?: boolean } = {},
): Promise<ResolvedTarget> {
  const requireMember = options.requireMember ?? true;
  const reply = message.reply_to_message;
  if (reply?.from) {
    return fromUser(reply.from, args.trim());
  }

  const textMention = message.entities?.find(
    (entity) => entity.type === "text_mention",
  );
  if (textMention && textMention.type === "text_mention" && textMention.user) {
    const mentioned = message.text?.substring(
      textMention.offset,
      textMention.offset + textMention.length,
    );
    const rest = mentioned ? args.replace(mentioned, "").trim() : args.trim();
    return fromUser(textMention.user, rest);
  }

  const trimmed = args.trim();
  if (!trimmed) {
    return error(tr("Responde al mensaje del usuario o indica su @usuario / ID."));
  }

  const [first, ...tail] = trimmed.split(/\s+/);
  const rest = tail.join(" ").trim();

  if (!first) return error(tr("Indica un usuario válido."));

  if (first.startsWith("@")) {
    const username = first.slice(1);
    const stored = await findUserByUsername(username);
    if (stored) {
      return {
        ok: true,
        userId: stored.user_id,
        name: [stored.first_name, stored.last_name].filter(Boolean).join(" ") || stored.username || tr("Usuario"),
        username: stored.username,
        rest,
      };
    }
    try {
      const chat = await api.getChat(`@${username}`);
      if (chat.type !== "private") {
        return error(tr("El usuario indicado no es una cuenta personal."));
      }
      return {
        ok: true,
        userId: chat.id,
        name: [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || tr("Usuario"),
        username: chat.username ?? username,
        rest,
      };
    } catch {
      return error(tr("No encuentro a ese usuario. Prueba respondiendo a su mensaje o usando su ID."));
    }
  }

  const id = numericId(first);
  if (id !== null) {
    const member = await getChatMemberSafe(api, chatId, id);
    if (member) return fromUser(member.user, rest);

    if (requireMember) {
      return error(tr("Ese usuario no está en el grupo o el ID no es correcto."));
    }

    try {
      const chat = await api.getChat(id);
      if (chat.type === "private") {
        return {
          ok: true,
          userId: chat.id,
          name: [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || tr("ID {0}", [id]),
          username: chat.username ?? null,
          rest,
        };
      }
    } catch {
      // Sin información pública: usamos el ID.
    }
    return { ok: true, userId: id, name: tr("ID {0}", [id]), username: null, rest };
  }

  return error(tr("No he podido identificar al usuario. Responde a su mensaje o usa @usuario / ID."));
}

export async function resolveUserFromReplyOrArgs(
  api: Api,
  chatId: number,
  message: Message,
  args: string,
): Promise<ResolvedTarget> {
  return resolveTarget(api, chatId, message, args, { requireMember: false });
}
