import { tr } from "./bot-i18n.js";
import { randomInt } from "node:crypto";
import { many, one, withTransaction } from "../db/pool.js";
import type { ChatRow, PaymentRow, PremiumPlan, PremiumStatus } from "../db/types.js";
import { chatTier, TIER_RANK, type PremiumTier } from './entitlements.js';
import { invalidateChat } from './chat-cache.js';
import { purchaseProLicense } from './pro-licenses.js';

export const PREMIUM_PLANS: PremiumPlan[] = [
  {id:'pro',label:tr("Pro permanente · 10 grupos"),days:0,stars:135,perDay:tr("Pago único"),save:null,popular:false,emoji:'🚀',tier:'pro',kind:'license',groups:10},
  {id:'ultra',label:tr("Ultra · 30 días / grupo"),days:30,stars:135,perDay:tr("4,5 ⭐/día"),save:null,popular:false,emoji:'👑',tier:'ultra',kind:'subscription',groups:1},
  {
    id: "monthly",
    label: tr("1 mes"),
    days: 30,
    stars: 50,
    perDay: tr("1,7 ⭐/día"),
    save: null,
    popular: true,
    emoji: "🌙",
  },
  {
    id: "quarterly",
    label: tr("3 meses"),
    days: 90,
    stars: 129,
    perDay: tr("1,4 ⭐/día"),
    save: tr("Ahorra 14 %"),
    popular: false,
    emoji: "🚀",
  },
  {
    id: "yearly",
    label: tr("12 meses"),
    days: 365,
    stars: 399,
    perDay: tr("1,1 ⭐/día"),
    save: tr("Ahorra 34 %"),
    popular: false,
    emoji: "👑",
  },
];

export const PREMIUM_PERKS: { emoji: string; title: string; description: string }[] = [
  { emoji: '🛡️', title: tr("Protección Premium"), description: tr("Antirraids, bloqueos por contenido, confianza y advertencias con vencimiento.") },
  { emoji: "🖼️", title: tr("Bienvenidas con multimedia"), description: tr("Foto, vídeo, GIF o documento en la bienvenida.") },
  { emoji: "🤖", title: tr("Captcha matemático"), description: tr("Verificación más difícil de saltar por bots.") },
  { emoji: "🔗", title: tr("Antienlaces avanzado"), description: tr("Silenciar o banear y lista blanca de dominios.") },
  { emoji: "📋", title: tr("Canal de registros"), description: tr("Envía toda la moderación a un canal privado.") },
  { emoji: "⚡", title: tr("5.000 acciones/día"), description: tr("25 veces más acciones de moderación que el plan gratis.") },
  { emoji: "📊", title: tr("Exportación de estadísticas"), description: tr("Descarga todos los datos del grupo en JSON.") },
  { emoji: "🧩", title: tr("Comandos ilimitados"), description: tr("Hasta 50 comandos personalizados y 100 notas.") },
  { emoji: "✅", title: tr("Solicitudes automáticas"), description: tr("Aprueba automáticamente las solicitudes de entrada.") },
  { emoji: "🧹", title: tr("Bienvenida autolimpiable"), description: tr("Elimina el mensaje de bienvenida tras X segundos.") },
  { emoji: "🛟", title: tr("Soporte prioritario"), description: tr("Atención preferente del equipo de GBot Ultra.") },
];

export function getPlan(planId: string): PremiumPlan | undefined {
  return PREMIUM_PLANS.find((plan) => plan.id === planId);
}

export function isPremium(chat: Pick<ChatRow, "premium_until" | 'pro_license_id'> | null | undefined): boolean {
  return Boolean(chat?.pro_license_id || (chat?.premium_until && chat.premium_until.getTime() > Date.now()));
}

export function getPremiumStatus(
  chat: Pick<ChatRow, "premium_until" | "premium_plan" | 'pro_license_id'> | null | undefined,
): PremiumStatus {
  if (!chat?.premium_until || chat.premium_until.getTime() <= Date.now()) {
    if(chat?.pro_license_id)return {active:true,plan:'pro',until:null,daysLeft:0,autoRenew:false};
    return { active: false, plan: null, until: null, daysLeft: 0, autoRenew: false };
  }
  return {
    active: true,
    plan: chat.premium_plan,
    until: chat.premium_until,
    daysLeft: Math.max(1, Math.ceil((chat.premium_until.getTime() - Date.now()) / 86_400_000)),
    autoRenew: false,
  };
}

export function premiumPlanLabel(planId: string | null | undefined): string {
  if (!planId) return tr("Premium");
  return tr(getPlan(planId)?.label ?? 'Premium');
}

export interface ActivatePremiumOptions {
  tier?: Exclude<PremiumTier,'free'>;
  userId?: number | null;
  chargeId?: string | null;
  payload?: string | null;
  amount?: number;
}

export interface ActivatePremiumResult {
  status: PremiumStatus;
  duplicate: boolean;
}

export async function activatePremium(
  chatId: number,
  planId: string,
  options: ActivatePremiumOptions = {},
): Promise<ActivatePremiumResult> {
  const plan = getPlan(planId);
  if (!plan) throw new Error(tr("Plan desconocido: {0}", [planId]));
  if(plan.kind==='license'){
    if(!options.userId)throw new Error(tr("La licencia Pro requiere un comprador identificado."));
    const result=await purchaseProLicense(options.userId,options.chargeId??null,chatId,options.amount??plan.stars,options.payload??null);
    return {duplicate:result.duplicate,status:getPremiumStatus(await one<ChatRow>('SELECT * FROM chats WHERE chat_id=$1',[chatId]))};
  }

  const result = await withTransaction(async (client) => {
    if(options.chargeId)await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['payment:'+options.chargeId]);
    if (options.chargeId) {
      const existing = await client.query(
        "SELECT 1 FROM payments WHERE charge_id = $1",
        [options.chargeId],
      );
      if (existing.rowCount) {
        const current = await client.query<ChatRow>(
          "SELECT * FROM chats WHERE chat_id = $1",
          [chatId],
        );
        return {
          status: getPremiumStatus(current.rows[0]),
          duplicate: true,
        };
      }
    }

    const locked = await client.query<ChatRow>(
      "SELECT * FROM chats WHERE chat_id = $1 FOR UPDATE",
      [chatId],
    );
    if (!locked.rowCount) throw new Error(tr("El grupo no está registrado en el bot."));

    const currentUntil = locked.rows[0]?.premium_until ?? null;
    const base =
      currentUntil && currentUntil.getTime() > Date.now() ? currentUntil : new Date();
    const newUntil = new Date(base.getTime() + plan.days * 86_400_000);
    const previousTier = chatTier(locked.rows[0]?{...locked.rows[0],pro_license_id:null}:null);
    const requestedTier = options.tier??plan.tier??'premium';
    const tier=TIER_RANK[previousTier]>TIER_RANK[requestedTier]?previousTier:requestedTier;

    await client.query(
      `UPDATE chats
         SET premium_until = $2,
             premium_plan = $3,
             premium_tier = $4,
             premium_reminder_sent = FALSE,
             updated_at = now()
       WHERE chat_id = $1`,
      [chatId, newUntil, plan.id, tier],
    );

    await client.query(
      `INSERT INTO payments (charge_id, user_id, chat_id, amount, currency, plan, days, payload)
       VALUES ($1, $2, $3, $4, 'XTR', $5, $6, $7)
       ON CONFLICT (charge_id) DO NOTHING`,
      [
        options.chargeId ?? null,
        options.userId ?? null,
        chatId,
        options.amount ?? plan.stars,
        plan.id,
        plan.days,
        options.payload ?? null,
      ],
    );

    return {
      status: getPremiumStatus({ premium_until: newUntil, premium_plan: plan.id }),
      duplicate: false,
    };
  });
  invalidateChat(chatId);return result;
}

export function createInvoicePayload(chatId: number, planId: string): string {
  const nonce = randomInt(1_000_000, 9_999_999);
  return `gbot:prem:${chatId}:${planId}:${nonce}`;
}

export interface ParsedInvoicePayload {
  chatId: number;
  planId: string;
}

export function parseInvoicePayload(payload: string): ParsedInvoicePayload | null {
  const match = payload.match(/^gbot:prem:(-?\d+):([a-z]+):(\d+)$/);
  if (!match) return null;
  const chatId = Number(match[1]);
  const planId = match[2] ?? "";
  if (!Number.isSafeInteger(chatId) || !getPlan(planId)) return null;
  return { chatId, planId };
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  const group = () =>
    Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]).join("");
  return `GBOT-${group()}-${group()}`;
}

export async function createPremiumCode(
  days: number,
  plan: string | null,
  createdBy: number | null,
  tier: Exclude<PremiumTier,'free'> = 'premium',
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateCode();
    try {
      await one(
        `INSERT INTO premium_codes (code, days, plan, created_by, premium_tier)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING code`,
        [code, days, plan, createdBy, tier],
      );
      return code;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "23505") throw error;
    }
  }
  throw new Error(tr("No se pudo generar un código único"));
}

export interface RedeemResult {
  days: number;
  plan: string | null;
  status: PremiumStatus;
}

export async function redeemPremiumCode(
  code: string,
  chatId: number,
  userId: number,
): Promise<RedeemResult> {
  const normalized = code.trim().toUpperCase();
  const result = await withTransaction(async (client) => {
    const redeemed = await client.query<{ days: number; plan: string | null; premium_tier: Exclude<PremiumTier,'free'> }>(
      `UPDATE premium_codes
          SET redeemed_by = $2,
              redeemed_chat_id = $3,
              redeemed_at = now()
        WHERE code = $1 AND redeemed_at IS NULL
        RETURNING days, plan, premium_tier`,
      [normalized, userId, chatId],
    );

    if (!redeemed.rowCount) {
      throw new Error(tr("Código inválido o ya utilizado."));
    }

    const row = redeemed.rows[0]!;
    if (row.premium_tier === "pro") throw new Error(tr("Este código no es válido: Pro se activa con una licencia de cupos."));
    // Promotional and legacy codes retain their promised duration. The paid
    // Ultra invoice is monthly, but that must not invalidate existing codes.
    const locked = await client.query<ChatRow>(
      "SELECT * FROM chats WHERE chat_id = $1 FOR UPDATE",
      [chatId],
    );
    if (!locked.rowCount) throw new Error(tr("El grupo no está registrado en el bot."));

    const currentUntil = locked.rows[0]?.premium_until ?? null;
    const base = currentUntil && currentUntil.getTime() > Date.now() ? currentUntil : new Date();
    const newUntil = new Date(base.getTime() + row.days * 86_400_000);
    const oldTier=chatTier(locked.rows[0]?{...locked.rows[0],pro_license_id:null}:null), requestedTier=row.premium_tier??'premium';
    const tier=TIER_RANK[oldTier]>TIER_RANK[requestedTier]?oldTier:requestedTier;

    await client.query(
      `UPDATE chats
          SET premium_until = $2,
              premium_plan = COALESCE($3, premium_plan),
              premium_tier = $4,
              premium_reminder_sent = FALSE,
              updated_at = now()
        WHERE chat_id = $1`,
      [chatId, newUntil, row.plan, tier],
    );

    await client.query(
      `INSERT INTO payments (charge_id, user_id, chat_id, amount, currency, plan, days, payload)
       VALUES ($1, $2, $3, 0, 'XTR', $4, $5, $6)
       ON CONFLICT (charge_id) DO NOTHING`,
      [`code:${normalized}`, userId, chatId, row.plan, row.days, `code:${normalized}`],
    );

    return {
      days: row.days,
      plan: row.plan,
      status: getPremiumStatus({ premium_until: newUntil, premium_plan: row.plan }),
    };
  });
  invalidateChat(chatId);return result;
}

export async function getPaymentHistory(chatId: number, limit = 10): Promise<PaymentRow[]> {
  return many<PaymentRow>(
    `SELECT * FROM payments
      WHERE chat_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [chatId, limit],
  );
}

export async function getTotalStars(): Promise<number> {
  const row = await one<{ total: number | null }>(
    "SELECT COALESCE(SUM(amount), 0)::int AS total FROM payments WHERE currency = 'XTR'",
  );
  return row?.total ?? 0;
}

export async function getPremiumChatCount(): Promise<number> {
  const row = await one<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM chats WHERE active AND (premium_until > now() OR pro_license_id IS NOT NULL)",
  );
  return row?.total ?? 0;
}

export async function getExpiringPremiumChats(days: number): Promise<ChatRow[]> {
  return many<ChatRow>(
    `SELECT * FROM chats
      WHERE active
        AND premium_until IS NOT NULL
        AND premium_until > now()
        AND premium_until <= now() + make_interval(days => $1)
        AND premium_reminder_sent = FALSE
      ORDER BY premium_until ASC`,
    [days],
  );
}

export async function markPremiumReminderSent(chatId: number): Promise<void> {
  await one(
    "UPDATE chats SET premium_reminder_sent = TRUE WHERE chat_id = $1 RETURNING chat_id",
    [chatId],
  );
}
