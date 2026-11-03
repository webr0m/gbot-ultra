import { tr } from "../services/bot-i18n.js";
import {botLanguage} from '../services/bot-i18n.js';
const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  seg: 1,
  segundo: 1,
  segundos: 1,
  m: 60,
  min: 60,
  minuto: 60,
  minutos: 60,
  h: 3_600,
  hora: 3_600,
  horas: 3_600,
  d: 86_400,
  dia: 86_400,
  días: 86_400,
  dias: 86_400,
  w: 604_800,
  sem: 604_800,
  semana: 604_800,
  semanas: 604_800,
  mo: 2_592_000,
  mes: 2_592_000,
  meses: 2_592_000,
};

/**
 * Convierte "10m", "2h", "7d", "1w", "permanent"… a segundos.
 * Devuelve 0 para "permanente" y null si no es válido.
 */
export function parseDuration(
  input: string,
  defaultUnit: "s" | "m" | "h" | "d" | "w" = "m",
): number | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;

  if (["permanent", "permanente", "forever", "siempre", "infinito", "∞"].includes(normalized)) {
    return 0;
  }

  const match = normalized.match(/^(\d{1,6})\s*([a-záéíóúñ]+)?$/u);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = (match[2] ?? defaultUnit) as string;
  const multiplier = UNIT_SECONDS[unit];
  if (!multiplier) return null;

  const seconds = amount * multiplier;
  return seconds > 366 * 86_400 ? 366 * 86_400 : seconds;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds <= 0) return tr("Permanente");

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = Math.floor(seconds % 60);
  if(botLanguage()!=='es'){
    const values:[number,Intl.NumberFormatOptions['unit']][]=[[days,'day'],[hours,'hour'],[minutes,'minute'],...(!days&&!hours?[[secs,'second'] as [number,'second']]:[])];
    return values.filter(([value])=>value>0).slice(0,2).map(([value,unit])=>new Intl.NumberFormat(botLanguage(),{style:'unit',unit,unitDisplay:'short'}).format(value)).join(' ');
  }

  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? tr("día") : tr("días")}`);
  if (hours) parts.push(tr("{0} h", [hours]));
  if (minutes) parts.push(tr("{0} min", [minutes]));
  if (!days && !hours && secs) parts.push(tr("{0} s", [secs]));
  return parts.slice(0, 2).join(" ") || tr("0 s");
}

export interface ParsedModerationArgs {
  seconds: number | null;
  reason: string;
  hasDuration: boolean;
}

/**
 * Interpreta argumentos del estilo "7d spam" o "spam".
 * `defaultUnit` se usa cuando el usuario escribe solo un número.
 */
export function parseModerationArgs(
  rest: string,
  defaultUnit: "m" | "d" = "m",
): ParsedModerationArgs {
  const trimmed = rest.trim();
  if (!trimmed) return { seconds: null, reason: "", hasDuration: false };

  const [first, ...tail] = trimmed.split(/\s+/);
  const parsed = parseDuration(first ?? "", defaultUnit);
  if (parsed !== null) {
    return {
      seconds: parsed,
      reason: tail.join(" ").trim(),
      hasDuration: true,
    };
  }

  return { seconds: null, reason: trimmed, hasDuration: false };
}

export function untilDateFromSeconds(seconds: number | null): number | undefined {
  if (seconds === null || seconds <= 0) return undefined;
  // Telegram interpreta < 30 s como permanente; forzamos un mínimo de 60 s.
  const safe = Math.max(60, seconds);
  return Math.floor(Date.now() / 1000) + safe;
}
