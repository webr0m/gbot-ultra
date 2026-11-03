import { tr } from "./bot-i18n.js";
import { z } from "zod";
import { config } from "../config.js";
import type { GroupSettings } from "../db/types.js";

export const DEFAULT_SETTINGS: GroupSettings = {
  welcome: {
    enabled: true,
    text:
      tr("👋 ¡Bienvenido/a, {mention}!\n\nTe damos la bienvenida a <b>{chat}</b>. Lee las reglas y disfruta de la comunidad."),
    media: null,
    deleteAfter: 0,
  },
  goodbye: {
    enabled: false,
    text: tr("👋 {name} ha salido del grupo. ¡Hasta pronto!"),
  },
  rules: {
    enabled: true,
    text: "",
    button: true,
  },
  captcha: {
    enabled: false,
    mode: "button",
    timeoutSeconds: config.captchaTimeoutSeconds,
  },
  antilink: {
    enabled: true,
    action: "delete",
    muteSeconds: 600,
    whitelist: [],
  },
  antiflood: {
    enabled: true,
    limit: 8,
    windowSeconds: 10,
    muteSeconds: 600,
  },
  blacklist: {
    enabled: true,
    action: "warn",
  },
  warnings: {
    enabled: true,
    limit: 3,
    action: "mute",
    muteSeconds: 3_600,
  },
  reports: { enabled: true },
  logs: { enabled: false, chatId: null },
  serviceMessages: { deleteJoins: false },
  joinRequests: { autoApprove: false },
  language: "es",
};

export function mergeSettings(raw: unknown): GroupSettings {
  const result = structuredClone(DEFAULT_SETTINGS);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;

  const source = raw as Record<string, unknown>;
  for (const key of Object.keys(result) as (keyof GroupSettings)[]) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      const target = result[key];
      if (typeof target === "object" && target !== null) {
        Object.assign(target, value);
      }
    } else if (typeof value === typeof result[key]) {
      (result as unknown as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}

// ------------------------------------------------------------
//  Validación de ajustes
// ------------------------------------------------------------

const mediaSchema = z
  .object({
    type: z.enum(["photo", "video", "animation", "document"]),
    fileId: z.string().min(1).max(500),
  })
  .nullable();

export const settingsPatchSchema = z.object({
  welcome: z
    .object({
      enabled: z.boolean().optional(),
      text: z.string().max(2_000).optional(),
      media: mediaSchema.optional(),
      deleteAfter: z.number().int().min(0).max(86_400).optional(),
    })
    .optional(),
  goodbye: z
    .object({
      enabled: z.boolean().optional(),
      text: z.string().max(1_000).optional(),
    })
    .optional(),
  rules: z
    .object({
      enabled: z.boolean().optional(),
      text: z.string().max(4_000).optional(),
      button: z.boolean().optional(),
    })
    .optional(),
  captcha: z
    .object({
      enabled: z.boolean().optional(),
      mode: z.enum(["button", "math"]).optional(),
      timeoutSeconds: z.number().int().min(30).max(3_600).optional(),
    })
    .optional(),
  antilink: z
    .object({
      enabled: z.boolean().optional(),
      action: z.enum(["delete", "mute", "ban"]).optional(),
      muteSeconds: z.number().int().min(60).max(2_592_000).optional(),
      whitelist: z.array(z.string().min(1).max(253)).max(50).optional(),
    })
    .optional(),
  antiflood: z
    .object({
      enabled: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      windowSeconds: z.number().int().min(1).max(300).optional(),
      muteSeconds: z.number().int().min(60).max(86_400).optional(),
    })
    .optional(),
  blacklist: z
    .object({
      enabled: z.boolean().optional(),
      action: z.enum(["delete", "warn", "mute", "ban"]).optional(),
    })
    .optional(),
  warnings: z
    .object({
      enabled: z.boolean().optional(),
      limit: z.number().int().min(1).max(20).optional(),
      action: z.enum(["mute", "kick", "ban"]).optional(),
      muteSeconds: z.number().int().min(60).max(2_592_000).optional(),
    })
    .optional(),
  reports: z.object({ enabled: z.boolean().optional() }).optional(),
  logs: z
    .object({
      enabled: z.boolean().optional(),
      chatId: z.number().int().safe().nullable().optional(),
    })
    .optional(),
  serviceMessages: z.object({ deleteJoins: z.boolean().optional() }).optional(),
  joinRequests: z.object({ autoApprove: z.boolean().optional() }).optional(),
  language: z
    .enum(["es", "en", "pt", "fr", "de", "it", "ru", "tr", "ar", "zh"])
    .optional(),
});

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export function findPremiumFeature(patch: SettingsPatch): string | null {
  if (patch.welcome?.media && patch.welcome.media !== null) return tr("Bienvenida con foto/vídeo/GIF");
  if (patch.welcome?.deleteAfter !== undefined && patch.welcome.deleteAfter > 0) {
    return tr("Autoeliminar la bienvenida");
  }
  if (patch.captcha?.mode === "math") return tr("Captcha matemático");
  if (
    patch.captcha?.timeoutSeconds !== undefined &&
    patch.captcha.timeoutSeconds !== config.captchaTimeoutSeconds
  ) {
    return tr("Tiempo de captcha personalizado");
  }
  if (patch.antilink?.action !== undefined && patch.antilink.action !== "delete") {
    return tr("Acción antienlaces avanzada");
  }
  if (patch.antilink?.whitelist !== undefined && patch.antilink.whitelist.length > 0) {
    return tr("Lista blanca de enlaces");
  }
  if (patch.antiflood) {
    if (patch.antiflood.limit !== undefined && (patch.antiflood.limit < 3 || patch.antiflood.limit > 20)) {
      return tr("Límite de antiflood personalizado");
    }
    if (
      patch.antiflood.windowSeconds !== undefined &&
      (patch.antiflood.windowSeconds < 5 || patch.antiflood.windowSeconds > 60)
    ) {
      return tr("Ventana de antiflood personalizada");
    }
    if (patch.antiflood.muteSeconds !== undefined && patch.antiflood.muteSeconds !== 600) {
      return tr("Duración de silencio antiflood personalizada");
    }
  }
  if (patch.logs?.enabled === true) return tr("Canal de registros");
  if (patch.joinRequests?.autoApprove === true) return tr("Aprobación automática de solicitudes");
  return null;
}

export function validateSettings(settings: GroupSettings): string | null {
  if (settings.welcome.text.length > 2_000) return tr("La bienvenida es demasiado larga (máx. 2000).");
  if (settings.goodbye.text.length > 1_000) return tr("La despedida es demasiado larga (máx. 1000).");
  if (settings.rules.text.length > 4_000) return tr("Las reglas son demasiado largas (máx. 4000).");
  if (settings.welcome.deleteAfter < 0 || settings.welcome.deleteAfter > 86_400) {
    return tr("El tiempo de autoeliminación debe estar entre 0 y 86400 segundos.");
  }
  if (settings.captcha.timeoutSeconds < 30 || settings.captcha.timeoutSeconds > 3_600) {
    return tr("El tiempo de captcha debe estar entre 30 y 3600 segundos.");
  }
  if (settings.antilink.muteSeconds < 60 || settings.antilink.muteSeconds > 2_592_000) {
    return tr("La duración del silencio antienlaces no es válida.");
  }
  if (settings.antilink.whitelist.length > 50) return tr("La lista blanca admite como máximo 50 dominios.");
  if (settings.antilink.whitelist.some((domain) => !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))) {
    return tr("Hay un dominio no válido en la lista blanca.");
  }
  if (settings.antiflood.limit < 1 || settings.antiflood.limit > 100) {
    return tr("El límite de antiflood debe estar entre 1 y 100 mensajes.");
  }
  if (settings.antiflood.windowSeconds < 1 || settings.antiflood.windowSeconds > 300) {
    return tr("La ventana de antiflood debe estar entre 1 y 300 segundos.");
  }
  if (settings.warnings.limit < 1 || settings.warnings.limit > 20) {
    return tr("El límite de advertencias debe estar entre 1 y 20.");
  }
  return null;
}

export interface SettingsApplyResult {
  ok: boolean;
  settings?: GroupSettings;
  error?: string;
  premiumFeature?: string;
}

export function applySettingsPatch(
  current: GroupSettings,
  patch: SettingsPatch,
  premium: boolean,
): SettingsApplyResult {
  const premiumFeature = findPremiumFeature(patch);
  if (!premium && premiumFeature) {
    return {
      ok: false,
      error: tr("Esta función requiere GBot Ultra Premium."),
      premiumFeature,
    };
  }

  const merged: GroupSettings = structuredClone(current);
  for (const [key, value] of Object.entries(patch) as [keyof GroupSettings, unknown][]) {
    if (value === undefined) continue;
    const target = merged[key];
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof target === "object" &&
      target !== null
    ) {
      Object.assign(target, value);
    } else {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }

  const error = validateSettings(merged);
  if (error) return { ok: false, error };
  return { ok: true, settings: merged };
}

// ------------------------------------------------------------
//  Toggles para menús y Mini App
// ------------------------------------------------------------

export interface ToggleDefinition {
  key: string;
  label: string;
  emoji: string;
  premium: boolean;
  path: [keyof GroupSettings, string];
}

export const TOGGLE_DEFINITIONS: ToggleDefinition[] = [
  { key: "welcome", label: tr("Bienvenida"), emoji: "👋", premium: false, path: ["welcome", "enabled"] },
  { key: "goodbye", label: tr("Despedida"), emoji: "🚪", premium: false, path: ["goodbye", "enabled"] },
  { key: "captcha", label: tr("Captcha"), emoji: "🤖", premium: false, path: ["captcha", "enabled"] },
  { key: "antilink", label: tr("Antienlaces"), emoji: "🔗", premium: false, path: ["antilink", "enabled"] },
  { key: "antiflood", label: tr("Antiflood"), emoji: "🌊", premium: false, path: ["antiflood", "enabled"] },
  { key: "blacklist", label: tr("Lista negra"), emoji: "🚫", premium: false, path: ["blacklist", "enabled"] },
  { key: "warnings", label: tr("Advertencias"), emoji: "⚠️", premium: false, path: ["warnings", "enabled"] },
  { key: "reports", label: tr("Reportes"), emoji: "🚨", premium: false, path: ["reports", "enabled"] },
  { key: "logs", label: tr("Canal de logs"), emoji: "📋", premium: true, path: ["logs", "enabled"] },
  {
    key: "deleteJoins",
    label: tr("Borrar mensajes de unión"),
    emoji: "🧹",
    premium: false,
    path: ["serviceMessages", "deleteJoins"],
  },
  {
    key: "autoApprove",
    label: tr("Aprobar solicitudes"),
    emoji: "✅",
    premium: true,
    path: ["joinRequests", "autoApprove"],
  },
];

export function getToggle(settings: GroupSettings, key: string): boolean {
  const definition = TOGGLE_DEFINITIONS.find((item) => item.key === key);
  if (!definition) return false;
  const [section, property] = definition.path;
  const sectionValue = settings[section] as unknown as Record<string, unknown>;
  return Boolean(sectionValue?.[property]);
}

export function setToggle(settings: GroupSettings, key: string, value: boolean): GroupSettings {
  const definition = TOGGLE_DEFINITIONS.find((item) => item.key === key);
  if (!definition) return settings;
  const [section, property] = definition.path;
  const copy = structuredClone(settings);
  const sectionValue = copy[section] as unknown as Record<string, unknown>;
  sectionValue[property] = value;
  return copy;
}
