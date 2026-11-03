import { tr } from "./bot-i18n.js";
import { config } from '../config.js';
import type { ChatRow } from '../db/types.js';
export type PremiumTier = 'free' | 'premium' | 'pro' | 'ultra';
export const TIER_RANK: Record<PremiumTier, number> = { free: 0, premium: 1, pro: 2, ultra: 3 };
export const ADVANCED_FEATURES = {
 undoSanctions: {tier: 'pro', label: tr("Deshacer sanciones")},
 ruleQuality: {tier: 'ultra', label: tr("Calidad de reglas")},
 raid: { tier: 'premium', label: tr("Antirraids") },
 locks: { tier: 'premium', label: tr("Bloqueos por contenido") },
 trust: { tier: 'premium', label: tr("Usuarios de confianza") },
 warningExpiry: { tier: 'premium', label: tr("Caducidad de advertencias") },
 filters: { tier: 'pro', label: tr("Respuestas por frases") },
 night: { tier: 'pro', label: tr("Modo nocturno") },
 transfer: { tier: 'pro', label: tr("Importación e historial de ajustes") },
 topics: { tier: 'pro', label: tr("Temas y destinos") },
 silent: { tier: 'pro', label: tr("Moderación silenciosa") },
 joinGate: { tier: 'pro', label: tr("Captcha previo al ingreso") },
 richNotes: { tier: 'pro', label: tr("Notas enriquecidas") },
 scheduledPosts: { tier:'pro',label:tr("Publicaciones programadas") },
 nsfw: { tier:'pro',label:tr("Filtro visual NSFW") },
 setupProfiles:{tier:'pro',label:tr("Perfiles avanzados de instalación")},
 inbox:{tier:'pro',label:tr("Bandeja unificada")},
 inboxGroups:{tier:'ultra',label:tr("Bandeja de varios grupos")},
 alliances: { tier: 'ultra', label: tr("Alianzas GBot") },
 observation: { tier: 'ultra', label: tr("Observación y simulador") },
 ai:{tier:'ultra',label:tr("Asistente de IA")},
 branding:{tier:'ultra',label:tr("Bot con marca propia")},
} as const;
export type AdvancedFeature = keyof typeof ADVANCED_FEATURES;
export function chatTier(chat: Pick<ChatRow, 'premium_until' | 'premium_tier' | 'pro_license_id'> | null, actorId?: number): PremiumTier {
 if (actorId && config.ownerIds.has(actorId)) return 'ultra';
 const permanent=Boolean(chat?.pro_license_id);
 if (!chat?.premium_until || chat.premium_until.getTime() <= Date.now()) return permanent?'pro':'free';
 const subscription=chat.premium_tier === 'premium' || chat.premium_tier === 'pro' ? chat.premium_tier : 'ultra';
 return permanent&&subscription==='premium'?'pro':subscription;
}
export function hasFeature(chat: Pick<ChatRow, 'premium_until' | 'premium_tier' | 'pro_license_id'> | null, feature: AdvancedFeature, actorId?: number): boolean {
 return TIER_RANK[chatTier(chat, actorId)] >= TIER_RANK[ADVANCED_FEATURES[feature].tier];
}
export const TIER_CATALOG = [
 { id: 'premium', label: tr("Premium"), available: true, description: tr("Protección, confianza y advertencias con vencimiento.") },
 { id: 'pro', label: tr("Pro"), available: true, description: tr("135 ⭐ una vez, diez grupos. Premium más horarios, respuestas, temas, notas, publicaciones programadas, filtro visual NSFW y configuración reutilizable.") },
 { id: 'ultra', label: tr("Ultra"), available: true, description: tr("135 ⭐ por 30 días y grupo. Pro más Alianzas GBot, perfiles compartidos, simulación, asistente de IA y bot con marca propia.") },
].map(tier => ({ ...tier, features: Object.entries(ADVANCED_FEATURES).filter(([, f]) => TIER_RANK[f.tier] <= TIER_RANK[tier.id as PremiumTier]).map(([key, f]) => ({key, label:f.label})) }));
