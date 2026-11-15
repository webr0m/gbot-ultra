import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const queryMock = vi.hoisted(() => vi.fn(async () => ({ rows: [], rowCount: 0 })));
const manyMock = vi.hoisted(() => vi.fn(async () => []));
const oneMock = vi.hoisted(() => vi.fn(async () => null));
const getChatMock = vi.hoisted(() => vi.fn(async () => null));
const chatTierMock = vi.hoisted(() => ({ current: 'premium' as 'free' | 'premium' | 'pro' | 'ultra' }));

vi.mock('../src/config.js', () => ({
  config: {
    ownerIds: new Set([900000001]),
    logLevel: 'silent',
    databaseUrl: '',
    botMode: 'webhook',
    botToken: 'test-token',
    devMode: true,
    nodeEnv: 'test',
    isProduction: true,
  },
}));
vi.mock('../src/db/pool.js', () => ({
  query: queryMock,
  one: oneMock,
  many: manyMock,
  withTransaction: vi.fn(),
  withSessionLock: async (_key: string, run: () => Promise<unknown>) => run(),
}));
vi.mock('../src/db/repositories/chats.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/db/repositories/chats.js')>();
  return { ...actual, getChat: getChatMock };
});
vi.mock('../src/services/branded-bots.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/branded-bots.js')>();
  return { ...actual, runtimeForChat: async () => null };
});
vi.mock('../src/utils/telegram.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/telegram.js')>();
  return {
    ...actual,
    getChatMemberSafe: async () => ({ status: 'administrator', can_restrict_members: true }),
  };
});

import { hasFeature } from '../src/services/entitlements.js';
import { RULE_RETENTION_DAYS, RULE_WINDOWS, cleanupRuleQuality, ruleQuality } from '../src/services/rule-quality.js';
import { registerQualityUndoRoutes } from '../src/server/routes/quality-undo.js';
import { ApiError } from '../src/server/helpers.js';

const ACTOR = 424242;
const chatRow = (tier: 'premium' | 'pro' | 'ultra') => ({
  chat_id: -1001,
  title: 'Comunidad',
  username: 'comunidad',
  type: 'supergroup',
  description: null,
  owner_id: null,
  premium_until: new Date(Date.now() + 86400000),
  premium_plan: null,
  premium_tier: tier,
  pro_license_id: null,
  premium_reminder_sent: false,
  active: true,
  settings: {},
  boosts: 0,
  created_at: new Date(),
  updated_at: new Date(),
});

let app: FastifyInstance;
const bot = {
  api: {},
  botInfo: { id: 999, username: 'test_bot' },
} as never;

beforeEach(async () => {
  queryMock.mockClear();
  queryMock.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  manyMock.mockReset();
  manyMock.mockImplementation(async () => []);
  oneMock.mockReset();
  oneMock.mockResolvedValue(null);
  getChatMock.mockReset();
  app = Fastify();
  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ ok: false, error: error.message });
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(statusCode).send({ ok: false, error: 'Error interno del servidor.' });
  });
  registerQualityUndoRoutes(app, bot);
  await app.ready();
});

describe('Presupuesto de conservación por nivel', () => {
  it('mantiene 30 días en el plan gratuito y Premium y amplía Pro y Ultra', () => {
    expect(RULE_RETENTION_DAYS).toEqual({ free: 30, premium: 30, pro: 100, ultra: 365 });
  });

  it('solo ofrece a Premium los períodos de un mes', () => {
    expect(RULE_WINDOWS.premium).toEqual([7, 14, 30]);
    expect(RULE_WINDOWS.free).toEqual([7, 14, 30]);
  });

  it('ofrece a Pro el trimestre y los cien días de Combot', () => {
    expect(RULE_WINDOWS.pro).toEqual([7, 14, 30, 90, 100]);
  });

  it('ofrece a Ultra el año completo de retención', () => {
    expect(RULE_WINDOWS.ultra).toEqual([7, 14, 30, 90, 365]);
  });

  it('nunca ofrece un período mayor que la conservación del nivel', () => {
    for (const tier of ['free', 'premium', 'pro', 'ultra'] as const) {
      expect(Math.max(...RULE_WINDOWS[tier])).toBeLessThanOrEqual(RULE_RETENTION_DAYS[tier]);
    }
  });
});

describe('Niveles con acceso a la calidad de reglas', () => {
  it('abre la calidad de reglas a Pro y Ultra', () => {
    expect(hasFeature(chatRow('pro'), 'ruleQuality')).toBe(true);
    expect(hasFeature(chatRow('ultra'), 'ruleQuality')).toBe(true);
  });

  it('mantiene la calidad de reglas fuera de Premium y del plan gratuito', () => {
    expect(hasFeature(chatRow('premium'), 'ruleQuality')).toBe(false);
    expect(hasFeature({ ...chatRow('premium'), premium_until: null }, 'ruleQuality')).toBe(false);
  });

  it('sigue reservando los roles temporales y el simulador a Ultra', () => {
    expect(hasFeature(chatRow('pro'), 'delegatedRoles')).toBe(false);
    expect(hasFeature(chatRow('pro'), 'observation')).toBe(false);
    expect(hasFeature(chatRow('ultra'), 'delegatedRoles')).toBe(true);
  });
});

describe('Consulta de la calidad de reglas', () => {
  it('devuelve la conservación y los períodos disponibles del nivel', async () => {
    const result = await ruleQuality(-1001, 90, 0, 'pro');
    expect(result.retentionDays).toBe(100);
    expect(result.windows).toEqual([7, 14, 30, 90, 100]);
    expect(result.days).toBe(90);
  });

  it('anuncia el año de conservación a los grupos Ultra', async () => {
    const result = await ruleQuality(-1002, 365, 0, 'ultra');
    expect(result.retentionDays).toBe(365);
    expect(result.windows).toContain(365);
  });

  it('conserva el filtro por grupo y período en las consultas', async () => {
    await ruleQuality(-1003, 30, 0, 'premium');
    const select = manyMock.mock.calls.filter(([sql]) => String(sql).includes('FROM rule_events'));
    expect(select.length).toBeGreaterThan(0);
    for (const [sql, params] of select) {
      expect(params).toContain(-1003);
      expect(params).toContain(30);
    }
  });
});

describe('Poda por nivel', () => {
  it('agrupa los grupos por su conservación y borra con su propio plazo', async () => {
    manyMock.mockImplementation(async (sql: string) => {
      if (String(sql).includes('FROM chats c')) {
        return [
          { chat_id: -1001, premium_until: new Date(Date.now() + 86400000), premium_tier: 'ultra', pro_license_id: null },
          { chat_id: -1002, premium_until: new Date(Date.now() + 86400000), premium_tier: 'pro', pro_license_id: null },
          { chat_id: -1003, premium_until: new Date(Date.now() + 86400000), premium_tier: 'premium', pro_license_id: null },
        ];
      }
      return [];
    });
    await cleanupRuleQuality();
    const deletions = queryMock.mock.calls.filter(([sql]) => String(sql).includes('DELETE FROM rule_events'));
    expect(deletions.length).toBe(3);
    const byDays = new Map<number, number[]>();
    for (const [, params] of deletions) byDays.set(Number(params?.[1]), params?.[0] as number[]);
    expect(byDays.get(365)).toEqual([-1001]);
    expect(byDays.get(100)).toEqual([-1002]);
    expect(byDays.get(30)).toEqual([-1003]);
  });

  it('no borra eventos cuando ningún grupo tiene métricas registradas', async () => {
    manyMock.mockImplementation(async () => []);
    await cleanupRuleQuality();
    expect(queryMock.mock.calls.filter(([sql]) => String(sql).includes('DELETE FROM rule_events')).length).toBe(0);
  });

  it('conserva el historial de sanciones interrumpidas para revisión manual', async () => {
    manyMock.mockImplementation(async () => []);
    await cleanupRuleQuality();
    const sanctions = queryMock.mock.calls.filter(([sql]) => String(sql).includes('DELETE FROM sanction_actions'));
    expect(sanctions.length).toBe(1);
    expect(String(sanctions[0]?.[0])).toContain("undo_state IN ('none','done')");
  });
});

describe('Validación del período en la API', () => {
  const call = async (tier: 'premium' | 'pro' | 'ultra', days: number) => {
    getChatMock.mockImplementation(async () => chatRow(tier));
    return app.inject({ method: 'GET', url: `/api/review/quality?chat_id=-1001&days=${days}`, headers: { 'x-dev-user': String(ACTOR) } });
  };

  it('rechaza con 400 un período que el nivel no ofrece', async () => {
    const response = await call('pro', 365);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Elige un período disponible');
  });

  it('exige Pro o Ultra antes de mirar el período solicitado', async () => {
    const response = await call('premium', 90);
    expect(response.statusCode).toBe(402);
    expect(response.json().error).toContain('Pro o Ultra');
  });

  it('acepta un período disponible para el nivel', async () => {
    const response = await call('pro', 100);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, retentionDays: 100, days: 100 });
  });

  it('acepta el año para Ultra y lo rechaza para Pro', async () => {
    expect((await call('ultra', 365)).statusCode).toBe(200);
    expect((await call('pro', 365)).statusCode).toBe(400);
  });

  it('exige Pro o Ultra con 402', async () => {
    const response = await call('premium', 30);
    expect(response.statusCode).toBe(402);
    expect(response.json().error).toContain('Pro o Ultra');
  });
});
