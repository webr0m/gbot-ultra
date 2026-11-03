import { tr } from "./bot-i18n.js";
import { config } from "../config.js";
import type { ChatRow } from "../db/types.js";
import { incrementActionCounter } from "../db/repositories/stats.js";
import { isPremium } from "./premium.js";

export interface ActionGate {
  allowed: boolean;
  premium: boolean;
  used: number;
  limit: number;
  remaining: number;
}

/**
 * Consume una acción de moderación del cupo diario del grupo.
 * Las acciones se cuentan incluso cuando se supera el límite para que el
 * contador refleje el uso real.
 */
export async function consumeAction(chat: ChatRow): Promise<ActionGate> {
  const premium = isPremium(chat);
  const limit = premium ? config.premiumActionLimit : config.freeActionLimit;
  const used = await incrementActionCounter(chat.chat_id);
  return {
    allowed: used <= limit,
    premium,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

export function limitMessage(gate: ActionGate): string {
  return (
    tr("🚦 <b>Límite diario alcanzado</b>\n\n") +
    tr("Has usado <b>{0}</b> de <b>{1}</b> acciones hoy.\n\n", [gate.used,gate.limit]) +
    tr("Con <b>GBot Ultra Premium</b> tendrías hasta <b>{0}</b> acciones al día.\n", [config.premiumActionLimit]) +
    tr("Usa /premium para ampliar el límite.")
  );
}
