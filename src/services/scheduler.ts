import { cleanupRuleQuality } from "./rule-quality.js";
import { tr } from "./bot-i18n.js";
import {withBotLanguage} from './bot-i18n.js';
import {settingsOf} from './chat-cache.js';
import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { config } from "../config.js";
import { pool, query } from "../db/pool.js";
import {
  getExpiringPremiumChats,
  markPremiumReminderSent,
} from "./premium.js";
import { expireCaptchas } from "./captcha.js";
import { runAdvancedSchedules } from './advanced-engine.js';
import { validateProLicenses } from './pro-licenses.js';
import { runPublications } from './publications.js';
import { runVisualJobs } from './visual-moderation.js';
import { cleanupAI } from './ai-assistant.js';
import { cleanupBrands } from './branded-bots.js';
import { cleanupInbox } from './inbox.js';
import { logger } from "../logger.js";
import { formatDate } from "../utils/date.js";
import { escapeHtml } from "../utils/format.js";

async function premiumReminders(api: Api, botUsername: string): Promise<void> {
  const chats = await getExpiringPremiumChats(config.premiumReminderDays);
  for (const chat of chats) {
    if (!chat.premium_until) continue;
    const premiumUntil=chat.premium_until;
    await withBotLanguage(settingsOf(chat).language,async()=>{
    const days = Math.max(1, Math.ceil((premiumUntil.getTime() - Date.now()) / 86_400_000));
    const text =
      tr("👑 <b>Tu suscripción Premium está a punto de caducar</b>\n\n") +
      tr("Grupo: <b>{0}</b>\n", [escapeHtml(chat.title)]) +
      tr("Caduca: <b>{0}</b> ({1} día(s))\n\n", [formatDate(premiumUntil),days]) +
      tr("Renueva para no perder las funciones avanzadas, el canal de registros y el límite ampliado de acciones.");
    const keyboard = new InlineKeyboard().url(
      tr("👑 Renovar Premium"),
      `https://t.me/${botUsername}?start=premium_${chat.chat_id}`,
    );

    let sent = false;
    if (chat.owner_id) {
      try {
        await api.sendMessage(chat.owner_id, text, {
          parse_mode: "HTML",
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        });
        sent = true;
      } catch {
        sent = false;
      }
    }
    if (!sent) {
      try {
        await api.sendMessage(chat.chat_id, text, {
          parse_mode: "HTML",
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        });
        sent = true;
      } catch (error) {
        logger.warn({ err: error, chatId: chat.chat_id }, tr("No se pudo enviar el recordatorio Premium"));
      }
    }
    if (sent) await markPremiumReminderSent(chat.chat_id);
    });
  }
}

async function cleanup(): Promise<void> {
    await cleanupRuleQuality();
    await cleanupInbox();
    await cleanupAI();await cleanupBrands();
    await query("DELETE FROM captcha_pending WHERE created_at < now() - interval '1 day'");
    await query("DELETE FROM action_counters WHERE date < current_date - 120");
    await query("DELETE FROM member_daily WHERE date < current_date - 365");
    await query("DELETE FROM daily_stats WHERE date < current_date - 730");
}

/** Runs from an authenticated external cron, independently of Passenger's lifecycle. */
export async function runScheduledTasks(api: Api, botUsername: string): Promise<string[]> {
  const client = await pool.connect();
  const lock = 749302610;
  let locked = false;
  const completed: string[] = [];
  try {
    locked = Boolean((await client.query("SELECT pg_try_advisory_lock($1) AS locked", [lock])).rows[0]?.locked);
    if (!locked) return completed;
    const tasks = [
      { name: "captcha-expiry", seconds: 55, run: () => expireCaptchas(api) },
      { name: "advanced-schedules", seconds: 55, run: () => runAdvancedSchedules(api) },
      { name: 'publications', seconds:55,run:()=>runPublications(api,Number(config.botToken.split(':')[0])) },
      { name: 'visual-moderation', seconds:55,run:()=>runVisualJobs(api,Number(config.botToken.split(':')[0])) },
      { name: "pro-licenses", seconds: 6*3600, run: () => validateProLicenses(api) },
      { name: "premium-reminders", seconds: 6 * 3600, run: () => premiumReminders(api, botUsername) },
      { name: "cleanup", seconds: 12 * 3600, run: cleanup },
    ];
    const failures: unknown[] = [];
    for (const task of tasks) {
      const due = await client.query(
        "SELECT 1 FROM scheduler_runs WHERE name=$1 AND completed_at > now() - make_interval(secs => $2)",
        [task.name, task.seconds],
      );
      if (due.rowCount) continue;
      await client.query("INSERT INTO scheduler_runs(name,completed_at,started_at) VALUES($1,to_timestamp(0),now()) ON CONFLICT(name) DO UPDATE SET started_at=now()", [task.name]);
      try {
      await task.run();
      await client.query(
        "INSERT INTO scheduler_runs (name, completed_at) VALUES ($1, now()) ON CONFLICT (name) DO UPDATE SET completed_at=EXCLUDED.completed_at,failed_at=NULL,failure_count=0",
        [task.name],
      );
      completed.push(task.name);
      } catch (error) {
        await client.query("UPDATE scheduler_runs SET failed_at=now(),failure_count=failure_count+1 WHERE name=$1", [task.name]);
        logger.error({err:error,task:task.name}, tr("Fallo en tarea programada"));
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, tr("Una o más tareas programadas fallaron"));
    return completed;
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock($1)", [lock]);
    } finally {
      client.release();
    }
  }
}

/** Minute checks while Passenger is running; the hosting cron wakes a recycled process. */
export function startExternalScheduler(api: Api, botUsername: string): () => void {
  const run = () => {
    void runScheduledTasks(api, botUsername).catch(error =>
      logger.error({ err: error }, tr("Error en tarea programada externa")));
  };
  const timer = setInterval(run, 60_000);
  timer.unref();
  const initial = setTimeout(run, 10_000);
  initial.unref();
  return () => { clearInterval(timer); clearTimeout(initial); };
}

/**
 * Tareas periódicas: expiración de captchas, recordatorios Premium y limpieza.
 * Devuelve una función para detener todos los intervalos.
 */
export function startScheduler(api: Api, botUsername: string): () => void {
  const timers: NodeJS.Timeout[] = [];

  const every = (ms: number, task: () => Promise<void>, name: string): void => {
    const timer = setInterval(() => {
      task().catch((error) => logger.error({ err: error, task: name }, tr("Error en tarea programada")));
    }, ms);
    timer.unref?.();
    timers.push(timer);
  };

  every(60_000, async () => {
    const expired = await expireCaptchas(api);
    if (expired > 0) logger.info({ expired }, tr("Captchas expirados procesados"));
  }, "captcha-expiry");

  every(6 * 3_600_000, () => premiumReminders(api, botUsername), "premium-reminders");
  every(60_000, () => runAdvancedSchedules(api), "advanced-schedules");
  every(60_000,()=>runPublications(api,Number(config.botToken.split(':')[0])),'publications');
  every(60_000,()=>runVisualJobs(api,Number(config.botToken.split(':')[0])),'visual-moderation');
  every(6*3600_000,()=>validateProLicenses(api),'pro-licenses');
  every(12 * 3_600_000, cleanup, "cleanup");

  // Primera pasada tras el arranque, sin bloquear.
  setTimeout(() => {
    expireCaptchas(api).catch(() => undefined);
    premiumReminders(api, botUsername).catch(() => undefined);
  }, 15_000).unref?.();

  return () => {
    for (const timer of timers) clearInterval(timer);
  };
}
