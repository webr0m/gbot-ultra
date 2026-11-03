import "dotenv/config";
import { z } from "zod";
import { DEVELOPER_ID } from "./services/roles.js";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(20, "BOT_TOKEN no es válido"),
  TELEGRAM_API_URL: z.string().default(""),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  OWNER_IDS: z.string().default(""),
  WEBAPP_URL: z.string().default(""),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8090),
  BOT_MODE: z.enum(["polling", "webhook", "off"]).default("polling"),
  SCHEDULER_MODE: z.enum(["interval", "external"]).default("interval"),
  INTERNAL_CRON_SECRET: z.string().default(""),
  CONFIGURE_BOT_ON_START: z.string().default("true"),
  REGISTER_WEBHOOK_ON_START: z.string().default("true"),
  WEBHOOK_URL: z.string().default(""),
  WEBHOOK_SECRET: z.string().default(""),
  DEV_MODE: z.string().default("false"),
  SUPPORT_URL: z.string().default(""),
  CHANNEL_URL: z.string().default(""),
  LOG_LEVEL: z.string().default("info"),
  TZ: z.string().default("UTC"),
  FREE_ACTION_LIMIT: z.coerce.number().int().positive().default(200),
  PREMIUM_ACTION_LIMIT: z.coerce.number().int().positive().default(5000),
  CAPTCHA_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  PREMIUM_REMINDER_DAYS: z.coerce.number().int().positive().default(3),
  AD_BANNER_ENABLED: z.string().default("true"),
  CAS_API_KEY: z.string().default(''),
  CAS_ENABLED: z.string().default('true'),
  OPENAI_MODERATION_API_KEY: z.string().default(''),
  GROQ_FREE_API_KEY:z.string().default(''),
  BOT_VAULT_KEY:z.string().default(''),
  AD_BANNER_TEXT: z.string().default("Patrocinado: mejora tu grupo con GBot Ultra Premium"),
  AD_BANNER_URL: z.string().default("https://t.me/GroupButlerEsp_bot?start=premium"),
  AD_SPONSORED_ENABLED: z.string().default("true"),
  AD_SPONSORED_TEXT: z.string().default("Patrocinado: desbloquea Premium con Telegram Stars"),
  AD_SPONSORED_URL: z.string().default("https://t.me/GroupButlerEsp_bot?start=premium"),
  NODE_ENV: z.string().default("development"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Configuración inválida (.env):");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;
const webappUrl = env.WEBAPP_URL.trim().replace(/\/+$/, "");
const telegramApiUrl = env.TELEGRAM_API_URL.trim().replace(/\/+$/, "");
const ownerIds = new Set(
  env.OWNER_IDS.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value > 0),
);
if (DEVELOPER_ID > 0) ownerIds.add(DEVELOPER_ID);

if (env.BOT_MODE === "webhook" && (!env.WEBHOOK_URL || !env.WEBHOOK_SECRET)) {
  console.error("❌ BOT_MODE=webhook requiere WEBHOOK_URL y WEBHOOK_SECRET.");
  process.exit(1);
}

if (env.SCHEDULER_MODE === "external" && env.INTERNAL_CRON_SECRET.length < 32) {
  console.error("❌ SCHEDULER_MODE=external requiere INTERNAL_CRON_SECRET de al menos 32 caracteres.");
  process.exit(1);
}

if (webappUrl && !webappUrl.startsWith("https://")) {
  console.warn("⚠️  WEBAPP_URL no es HTTPS: Telegram no mostrará los botones de Mini App.");
}

export const config = {
  groqApiKey:env.GROQ_FREE_API_KEY,
  botVaultKey:env.BOT_VAULT_KEY,
  moderationApiKey:env.OPENAI_MODERATION_API_KEY,
  casApiKey:env.CAS_API_KEY,
  casEnabled:env.CAS_ENABLED==='true'&&Boolean(env.CAS_API_KEY),
  botToken: env.BOT_TOKEN,
  telegramApiUrl,
  databaseUrl: env.DATABASE_URL,
  ownerIds,
  webappUrl,
  hasWebapp: webappUrl.startsWith("https://"),
  host: env.HOST,
  port: env.PORT,
  botMode: env.BOT_MODE,
  schedulerMode: env.SCHEDULER_MODE,
  internalCronSecret: env.INTERNAL_CRON_SECRET,
  configureBotOnStart: env.CONFIGURE_BOT_ON_START === "true",
  registerWebhookOnStart: env.REGISTER_WEBHOOK_ON_START === "true",
  webhookUrl: env.WEBHOOK_URL,
  webhookSecret: env.WEBHOOK_SECRET,
  devMode: env.DEV_MODE === "true" || env.DEV_MODE === "1",
  supportUrl: env.SUPPORT_URL,
  channelUrl: env.CHANNEL_URL,
  logLevel: env.LOG_LEVEL,
  timezone: env.TZ,
  freeActionLimit: env.FREE_ACTION_LIMIT,
  premiumActionLimit: env.PREMIUM_ACTION_LIMIT,
  captchaTimeoutSeconds: env.CAPTCHA_TIMEOUT_SECONDS,
  premiumReminderDays: env.PREMIUM_REMINDER_DAYS,
  adBannerEnabled: env.AD_BANNER_ENABLED === "true" || env.AD_BANNER_ENABLED === "1",
  adBannerText: env.AD_BANNER_TEXT,
  adBannerUrl: env.AD_BANNER_URL,
  adSponsoredEnabled: env.AD_SPONSORED_ENABLED === "true" || env.AD_SPONSORED_ENABLED === "1",
  adSponsoredText: env.AD_SPONSORED_TEXT,
  adSponsoredUrl: env.AD_SPONSORED_URL,
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  version: "2.6.0",
} as const;

export function isOwner(userId: number | undefined | null): boolean {
  return Boolean(userId && config.ownerIds.has(userId));
}

export function webappUrlForChat(chatId: number, tab?: "home" | "settings" | "members" | "moderation" | "premium"): string {
  if (!config.webappUrl) return "";
  const url = new URL(config.webappUrl);
  url.searchParams.set("chat_id", String(chatId));
  if (tab && tab !== "home") url.searchParams.set("tab", tab);
  return url.toString();
}

export function deepLink(username: string, payload?: string): string {
  const base = `https://t.me/${username.replace(/^@/, "")}`;
  return payload ? `${base}?start=${encodeURIComponent(payload)}` : base;
}

/** Raíz de la Bot API: servidor local si está configurado, si no la oficial. */
export function telegramApiRoot(): string {
  return config.telegramApiUrl || "https://api.telegram.org";
}

/** URL de descarga de un archivo devuelto por getFile. */
export function telegramFileUrl(filePath: string,token=config.botToken): string {
  return `${telegramApiRoot()}/file/bot${token}/${filePath.replace(/^\/+/, "")}`;
}
