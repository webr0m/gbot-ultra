import type { Api } from "grammy";
import { upsertUser } from "../db/repositories/users.js";
import { upsertMember } from "../db/repositories/members.js";
import { invalidateAdminCache } from "../utils/telegram.js";

/**
 * Sincroniza la lista de administradores de Telegram con la base de datos.
 * Se usa al añadir el bot a un grupo y al detectar cambios de administrador.
 */
export async function syncAdmins(api: Api, chatId: number): Promise<void> {
  const admins = await api.getChatAdministrators(chatId);
  for (const member of admins) {
    await upsertUser({
      id: member.user.id,
      username: member.user.username ?? null,
      first_name: member.user.first_name ?? "",
      last_name: member.user.last_name ?? null,
      language_code: member.user.language_code ?? null,
      is_bot: member.user.is_bot,
    });
    await upsertMember({
      chatId,
      userId: member.user.id,
      status: member.status,
      isBot: member.user.is_bot,
      customTitle: (member as { custom_title?: string }).custom_title ?? null,
    });
  }
  invalidateAdminCache(chatId);
}
