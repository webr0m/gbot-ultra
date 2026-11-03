import type { FastifyInstance } from "fastify";
import type { Bot } from "grammy";
import { z } from "zod";
import type { AppContext } from "../../bot/context.js";
import {
  PREMIUM_PERKS,
  PREMIUM_PLANS,
  createInvoicePayload,
  getPaymentHistory,
  getPlan,
  getPremiumStatus,
  premiumPlanLabel,
  redeemPremiumCode,
} from "../../services/premium.js";
import { formatDate } from "../../utils/date.js";
import {
  ApiError,
  bodyOf,
  parseChatId,
  requireAuth,
  requireChat,
} from "../helpers.js";
import { serializePayment, serializePlan } from "../serializers.js";
import { TIER_CATALOG, chatTier } from '../../services/entitlements.js';
import { config } from '../../config.js';
import { licenseOverview, assignProLicense, releaseProLicense } from '../../services/pro-licenses.js';

const invoiceSchema = z.object({
  chatId: z.number().int().safe(),
  planId: z.enum(["monthly", "quarterly", "yearly",'pro','ultra']),
});

const redeemSchema = z.object({
  chatId: z.number().int().safe(),
  code: z.string().min(4).max(64),
});

export function registerPremiumRoutes(
  app: FastifyInstance,
  bot: Bot<AppContext>,
): void {
  app.get("/api/premium", async (request) => {
    const auth = requireAuth(request);
    const q = request.query as Record<string, unknown>;
    const chatId = parseChatId(q.chat_id ?? q.chatId);
    const chat = await requireChat(bot.api, chatId, auth);
    const status = getPremiumStatus(chat);
    const payments = await getPaymentHistory(chatId, 25);
    return {
      ok: true,
      status: {
        active: status.active,
        plan: status.plan,
        planLabel: premiumPlanLabel(status.plan),
        until: status.until?.toISOString() ?? null,
        daysLeft: status.daysLeft,
      },
      plans: PREMIUM_PLANS.map(serializePlan),
      tiers: TIER_CATALOG,
      tier: chatTier(chat,auth.user.id),
      permanentAccess: config.ownerIds.has(auth.user.id),
      licenses: config.ownerIds.has(auth.user.id)?{unlimited:true,slots:null,used:0,groups:[]}:await licenseOverview(auth.user.id),
      perks: PREMIUM_PERKS,
      payments: payments.map(serializePayment),
    };
  });

  app.post("/api/premium/invoice", async (request) => {
    const auth = requireAuth(request);
    if(config.ownerIds.has(auth.user.id))throw new ApiError(400,'Tu acceso global es permanente. No necesitas comprar ningún plan.');
    const parsed = invoiceSchema.safeParse(bodyOf(request));
    if (!parsed.success) throw new ApiError(400, "Plan no válido.");
    const chat = await requireChat(bot.api, parsed.data.chatId, auth);
    const plan = getPlan(parsed.data.planId);
    if (!plan) throw new ApiError(400, "Plan no válido.");

    const payload = createInvoicePayload(chat.chat_id, plan.id);
    const url = await bot.api.createInvoiceLink(
      `GBot Ultra Premium · ${plan.label}`,
      plan.kind==='license'?'Licencia Pro permanente para hasta 10 grupos que administres. Asigna y mueve los cupos desde el panel.':`Nivel ${plan.tier??'premium'} para "${chat.title}" durante ${plan.days} días. Sin renovación automática.`,
      payload,
      "",
      "XTR",
      [{ label: plan.label, amount: plan.stars }],
    );

    return {
      ok: true,
      url,
      plan: serializePlan(plan),
      payload,
      note: "Abre la factura y paga con Telegram Stars. El Premium se activa automáticamente.",
    };
  });
  app.post('/api/premium/license',async request=>{
    const auth=requireAuth(request);if(config.ownerIds.has(auth.user.id))return {ok:true,unlimited:true,message:'Acceso global permanente, sin cupos.'};
    const body=z.object({chatId:z.number().int().safe(),action:z.enum(['assign','release'])}).parse(bodyOf(request));
    if(body.action==='assign'){await requireChat(bot.api,body.chatId,auth);await assignProLicense(bot.api,body.chatId,auth.user.id);}
    else await releaseProLicense(body.chatId,auth.user.id);
    return {ok:true,licenses:await licenseOverview(auth.user.id)};
  });

  app.post("/api/premium/redeem", async (request) => {
    const auth = requireAuth(request);
    const parsed = redeemSchema.safeParse(bodyOf(request));
    if (!parsed.success) throw new ApiError(400, "Código no válido.");
    const chat = await requireChat(bot.api, parsed.data.chatId, auth);

    try {
      const result = await redeemPremiumCode(
        parsed.data.code,
        chat.chat_id,
        auth.user.id,
      );
      return {
        ok: true,
        days: result.days,
        plan: result.plan,
        status: {
          active: result.status.active,
          plan: result.status.plan,
          planLabel: premiumPlanLabel(result.status.plan),
          until: result.status.until?.toISOString() ?? null,
          daysLeft: result.status.daysLeft,
        },
        message:
          `✅ Código canjeado: ${result.days} días de Premium.` +
          (result.status.until ? ` Activo hasta ${formatDate(result.status.until)}.` : ""),
      };
    } catch (error) {
      throw new ApiError(
        400,
        (error as { message?: string }).message ?? "No se pudo canjear el código.",
      );
    }
  });
}
