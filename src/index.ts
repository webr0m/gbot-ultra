import type { Bot } from "grammy";
import { createBot, configureBot } from "./bot/index.js";
import type { AppContext } from "./bot/context.js";
import { config } from "./config.js";
import { closePool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { logger } from "./logger.js";
import { buildServer } from "./server/app.js";
import { startScheduler, startExternalScheduler } from "./services/scheduler.js";

const ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "my_chat_member",
  "chat_member",
  "chat_join_request",
  "chat_boost",
  "removed_chat_boost",
  "pre_checkout_query",
] as const;

function maskedToken(): string {
  const token = config.botToken;
  return token.length > 12 ? `${token.slice(0, 6)}***${token.slice(-4)}` : "***";
}

async function main(): Promise<void> {
  logger.info(
    {
      version: config.version,
      mode: config.botMode,
      api: config.telegramApiUrl || "https://api.telegram.org",
      webapp: config.hasWebapp ? config.webappUrl : "(sin HTTPS)",
      token: maskedToken(),
    },
    "Iniciando GBot Ultra",
  );

  if (!config.hasWebapp) {
    logger.warn(
      "WEBAPP_URL no es una URL HTTPS: los botones de Mini App no aparecerán en Telegram. " +
        "La interfaz seguirá disponible en el navegador para pruebas.",
    );
  }

  await runMigrations();

  const bot: Bot<AppContext> = createBot();
  await bot.init();
  if (config.configureBotOnStart) await configureBot(bot);
  logger.info(
    { botId: bot.botInfo.id, username: bot.botInfo.username },
    "Bot autenticado en Telegram",
  );

  const app = await buildServer(bot);
  await app.listen({ host: config.host, port: config.port });
  logger.info(
    { host: config.host, port: config.port },
    `Panel disponible en http://localhost:${config.port}`,
  );

  const stopScheduler = config.schedulerMode === "interval"
    ? startScheduler(bot.api, bot.botInfo.username)
    : startExternalScheduler(bot.api, bot.botInfo.username);

  let polling = false;
  if (config.botMode === "polling") {
    await bot.api
      .deleteWebhook({ drop_pending_updates: false })
      .catch((error) => logger.warn({ err: error }, "No se pudo eliminar el webhook anterior"));
    polling = true;
    void bot
      .start({
        allowed_updates: ALLOWED_UPDATES,
        onStart: (info) => {
          logger.info({ username: info.username }, "Long polling activo");
        },
      })
      .catch((error) => {
        logger.error(
          { err: error },
          "El long polling se detuvo. Si el error es 409 Conflict, otra instancia " +
            "(probablemente el bot Lua antiguo) sigue usando el mismo token: deténla y reinicia.",
        );
      });
  } else if (config.botMode === "webhook" && config.registerWebhookOnStart) {
    const webhookUrl = new URL(
      "/telegram/webhook",
      config.webhookUrl.endsWith("/") ? config.webhookUrl : `${config.webhookUrl}/`,
    ).toString();
    await bot.api.setWebhook(webhookUrl, {
      secret_token: config.webhookSecret,
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: false,
    });
    logger.info({ webhookUrl: webhookUrl.replace(config.webhookSecret, "***") }, "Webhook configurado");
  } else if (config.botMode === "off") {
    logger.info("BOT_MODE=off: el bot no recibirá actualizaciones; el panel y la API siguen activos.");
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Apagando GBot Ultra…");
    stopScheduler();
    if (polling) {
      await bot.stop().catch(() => undefined);
    }
    await app.close().catch(() => undefined);
    await closePool().catch(() => undefined);
    logger.info("Apagado completado");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Promesa rechazada sin manejar");
});

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Excepción no capturada");
  process.exit(1);
});

main().catch((error) => {
  logger.fatal({ err: error }, "No se pudo iniciar GBot Ultra");
  process.exit(1);
});
