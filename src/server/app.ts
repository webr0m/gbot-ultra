import { registerQualityUndoRoutes } from "./routes/quality-undo.js";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import type { AppContext } from "../bot/context.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { runScheduledTasks } from "../services/scheduler.js";
import { ApiError,requireAuth } from "./helpers.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerCoreRoutes } from "./routes/core.js";
import { registerMemberRoutes } from "./routes/members.js";
import { registerModerationRoutes } from "./routes/moderation.js";
import { registerPremiumRoutes } from "./routes/premium.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerAdvancedRoutes } from './routes/advanced.js';
import { ZodError } from 'zod';
import { query } from '../db/pool.js';
import { ModerationError } from '../services/moderation.js';
import { registerGlobalBanRoutes } from './routes/global-bans.js';
import { registerAutomationRoutes } from './routes/automations.js';
import { registerUltraRoutes } from './routes/ultra.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { runtimeForChat,routedTelegramApi,brandWebhookRow,brandRuntime,updateChatId } from '../services/branded-bots.js';
import { botExecution,setPrimaryBot,scopedBot } from '../services/bot-runtime.js';
import { brandedWebhookSecret,vaultConfigured } from '../services/bot-vault.js';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 240;

interface RateEntry {
  count: number;
  resetAt: number;
}

function validSecret(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string" || !expected) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function buildServer(primary: Bot<AppContext>): Promise<FastifyInstance> {
  setPrimaryBot(primary);
  const bot=scopedBot(primary,routedTelegramApi(primary.api));
  const app = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Telegram-Init-Data", "X-Dev-User"],
    maxAge: 86_400,
  });

  const publicDir = path.join(process.cwd(), "public");
  app.addHook('onRoute',route=>{
    const original=route.handler;
    route.handler=async function(request,reply){
      const q=request.query as Record<string,unknown>|undefined,b=request.body as Record<string,unknown>|undefined;
      const chatId=Number(q?.chat_id??q?.chatId??b?.chatId??b?.chat_id);
      // Images authenticate with their signed capability, since <img> cannot
      // attach the Mini App session header. The image handler verifies it first.
      const needsRuntime=request.url.startsWith('/api/')&&!request.url.startsWith('/api/avatar/')&&!request.url.startsWith('/api/premium')&&!request.url.startsWith('/api/ultra')&&Number.isSafeInteger(chatId)&&chatId<0;
      if(needsRuntime)requireAuth(request);
      const runtime=needsRuntime?await runtimeForChat(chatId):null;
      return runtime?botExecution.run(runtime,()=>original.call(this,request,reply)):original.call(this,request,reply);
    };
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    if (["/banner.html", "/banner-adsense.html", "/api/banner/data527", "/api/banner/adsense"].includes(request.url.split("?")[0]!)) {
      reply.header("X-Frame-Options", "SAMEORIGIN");
      // Ad auctions can return creatives from different HTTPS hosts. Keep
      // their policy in the isolated banner document, away from the panel.
      reply.header(
        "Content-Security-Policy",
        "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms; default-src https: data: blob:; script-src https: 'unsafe-inline'; style-src https: 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'",
      );
      return;
    }
    if (!request.url.startsWith("/api/")) {
      reply.header(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' https://telegram.org https://cdn.gtranslate.net https://www.googletagmanager.com",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "connect-src 'self' https://cdn.gtranslate.net https://translate-pa.googleapis.com",
          "font-src 'self' data:",
          "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
        ].join("; "),
      );
    }
  });

  // Register static routes after the security hook so it applies to HTML too.
  await app.register(fastifyStatic, { root: publicDir, prefix: "/", wildcard: false, cacheControl: false });

  const rate = new Map<string, RateEntry>();
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    const key = request.ip;
    const now = Date.now();
    const entry = rate.get(key);
    if (!entry || entry.resetAt <= now) {
      if (rate.size > 5_000) rate.clear();
      rate.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return;
    }
    entry.count += 1;
    if (entry.count > RATE_MAX_REQUESTS) {
      return reply.code(429).send({
        ok: false,
        error: "Demasiadas peticiones. Espera un momento e inténtalo de nuevo.",
      });
    }
  });

  registerCoreRoutes(app, bot);
  registerMemberRoutes(app, bot);
  registerModerationRoutes(app, bot);
  registerSettingsRoutes(app, bot);
  registerPremiumRoutes(app, bot);
  registerAssetRoutes(app, bot);
  registerAdvancedRoutes(app, bot);
  registerGlobalBanRoutes(app, bot);
  registerAutomationRoutes(app, bot);
  registerUltraRoutes(app,bot,primary);
  registerWorkspaceRoutes(app,primary);
  registerQualityUndoRoutes(app,primary);
  app.get('/conoce',async (_request,reply)=>reply.type('text/html; charset=utf-8').sendFile('conoce.html'));
  app.get('/comparar',async (_request,reply)=>reply.redirect('/conoce#comparativa'));

  // Keep provider scripts outside public: LiteSpeed can bypass Node for static HTML.
  for (const provider of ["data527", "adsense"] as const) {
    const html = await readFile(path.join(process.cwd(), "templates", "ads", provider + ".html"), "utf8");
    app.get(`/api/banner/${provider}`, async (_request, reply) =>
      reply.header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(html));
  }

  if (config.botMode === "webhook" && config.webhookSecret) {
    app.post('/telegram/brand/:id',async(request,reply)=>{
      const id=(request.params as {id:string}).id;if(!/^[a-f0-9-]{36}$/.test(id))return reply.code(404).send({ok:false});
      if(!vaultConfigured())return reply.code(503).send({ok:false});
      if(!validSecret(request.headers['x-telegram-bot-api-secret-token'],brandedWebhookSecret(id)))return reply.code(401).send({ok:false});
      const row=await brandWebhookRow(id);if(!row)return reply.code(404).send({ok:false});
      const callback=(request.body as Update).callback_query?.data;
      if(row.state!=='active'&&!/^(?:cap:|jg:)/.test(callback??''))return reply.send({ok:true,paused:true});
      const update=request.body as Update,chatId=updateChatId(update);if(chatId&&chatId<0&&chatId!==row.chat_id)return reply.send({ok:true,ignored:true});
      if(!Number.isSafeInteger(update.update_id)||update.update_id<=0)return reply.send({ok:true});
      const runtime=/^(?:cap:|jg:)/.test(callback??'')?await brandRuntime(row):await runtimeForChat(row.chat_id);
      if(!runtime)return reply.send({ok:true,paused:true});
      const inserted=await query("INSERT INTO branded_update_receipts(bot_id,update_id,state) VALUES($1,$2,'pending') ON CONFLICT DO NOTHING RETURNING update_id",[row.bot_id,update.update_id]);if(!inserted.rowCount)return reply.send({ok:true,duplicate:true});
      try{await botExecution.run(runtime,()=>runtime.bot.handleUpdate(update));await query("UPDATE branded_update_receipts SET state='done' WHERE bot_id=$1 AND update_id=$2",[row.bot_id,update.update_id]);}catch{await query("UPDATE branded_update_receipts SET state='uncertain' WHERE bot_id=$1 AND update_id=$2",[row.bot_id,update.update_id]);}
      return reply.send({ok:true});
    });
    app.post("/telegram/webhook", async (request, reply) => {
      const secret = request.headers["x-telegram-bot-api-secret-token"];
      if (!validSecret(secret, config.webhookSecret)) {
        return reply.code(401).send({ ok: false });
      }
      const update=request.body as Update;
      const tracked=Number.isSafeInteger(update.update_id)&&update.update_id>0&&!update.message?.successful_payment;
      if(tracked){
        const chatId=(update.message??update.edited_message??update.channel_post??update.chat_join_request)?.chat.id??update.callback_query?.message?.chat.id??null;
        const inserted=await query("INSERT INTO update_receipts(update_id,state,chat_id) VALUES($1,'pending',$2) ON CONFLICT DO NOTHING RETURNING update_id",[update.update_id,chatId]);
        if(!inserted.rowCount)return reply.send({ok:true,duplicate:true});
      }
      try{await bot.handleUpdate(update);if(tracked)await query("UPDATE update_receipts SET state='done' WHERE update_id=$1",[update.update_id]);}
      catch(error){if(tracked)await query("UPDATE update_receipts SET state='uncertain' WHERE update_id=$1",[update.update_id]);throw error;}
      return reply.send({ ok: true });
    });
  }

  if (config.schedulerMode === "external") {
    app.post("/api/internal/schedule", async (request, reply) => {
      if (!validSecret(request.headers["x-gbot-cron-secret"], config.internalCronSecret)) {
        return reply.code(401).send({ ok: false });
      }
      const completed = await runScheduledTasks(bot.api, bot.botInfo.username);
      return reply.send({ ok: true, completed });
    });
  }

  app.setErrorHandler((error: unknown, request, reply) => {
    if(error instanceof ZodError)return reply.code(400).send({ok:false,error:error.issues.map(i=>i.message).join(' · ')});
    if(error instanceof ModerationError)return reply.code(403).send({ok:false,error:error.userMessage});
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        ok: false,
        error: error.message,
        ...(error.details ?? {}),
      });
    }

    const err = error as Error & { statusCode?: number };
    const statusCode = typeof err.statusCode === "number" ? err.statusCode : 500;

    if (statusCode >= 500) {
      logger.error(
        { err, url: request.url, method: request.method },
        "Error interno en la API",
      );
      return reply.code(statusCode).send({
        ok: false,
        error: "Error interno del servidor. Inténtalo de nuevo.",
      });
    }

    return reply.code(statusCode).send({
      ok: false,
      error: err.message,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api/")) {
      return reply.type("text/html; charset=utf-8").sendFile("index.html");
    }
    return reply.code(404).send({ ok: false, error: "Ruta no encontrada." });
  });

  return app;
}
