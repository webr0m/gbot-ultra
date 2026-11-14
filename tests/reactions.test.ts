import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/config.js', () => ({ config: {
  ownerIds: new Set([900000001]), logLevel: 'silent', botToken: 'test-token', databaseUrl: '',
} }));

const queryMock = vi.hoisted(() => vi.fn(async () => ({ rows: [], rowCount: 1 })));
const oneMock = vi.hoisted(() => vi.fn(async () => null));
const clientQueryMock = vi.hoisted(() => vi.fn(async () => ({ rows: [{ version: 0 }] })));
const withTransactionMock = vi.hoisted(() => vi.fn(async (run: (client: unknown) => Promise<unknown>) => run({ query: clientQueryMock })));
const runtimeAdvancedMock = vi.hoisted(() => vi.fn(async () => ({ reactions: { muteAll: false, reportEmoji: '', autoDeleteAfter: 0 } })));
vi.mock('../src/db/pool.js', () => ({ query: queryMock, one: oneMock, many: vi.fn(async () => []), withTransaction: withTransactionMock, withSessionLock: async (_key: string, run: () => Promise<unknown>) => run() }));
vi.mock('../src/services/telegram-cache.js', () => ({ withFreshTelegramReads: async (run: () => Promise<unknown>) => run() }));
vi.mock('../src/services/operations.js', () => ({ onceOperation: async (_key: string, run: () => Promise<unknown>) => run() }));
vi.mock('../src/services/advanced-engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/advanced-engine.js')>();
  return { ...actual, runtimeAdvanced: runtimeAdvancedMock };
});

import { setGroupReactionMode } from '../src/services/moderation.js';
import { handleReactionReport } from '../src/services/reaction-reports.js';
import { previewMemberCleanup, applyMemberCleanup, cleanupCriteriaSchema } from '../src/services/member-cleanup.js';
import type { ModerationContext } from '../src/services/moderation.js';

const pro = { chat_id: -1001, premium_until: new Date(Date.now() + 86400000), premium_tier: 'pro', pro_license_id: null } as never;
const premium = { chat_id: -1001, premium_until: new Date(Date.now() + 86400000), premium_tier: 'premium', pro_license_id: null } as never;
const adminMember = { status: 'administrator', user: { id: 42 }, can_restrict_members: true } as never;

function context(overrides: Partial<ModerationContext> = {}): ModerationContext {
  return {
    api: {
      getChat: vi.fn(async () => ({ type: 'supergroup', permissions: { can_react_to_messages: true, can_send_messages: true } })),
      getChatMember: vi.fn(async () => adminMember),
    } as never,
    chatId: -1001,
    chat: { ...pro, chat_id: -1001, type: 'supergroup' } as never,
    settings: { logs: { enabled: false, chatId: 0 } } as never,
    botId: 42,
    actorId: 900000001,
    actorName: 'Admin',
    source: 'miniapp',
    ...overrides,
  } as ModerationContext;
}

beforeEach(() => {
  queryMock.mockClear();
  queryMock.mockImplementation(async () => ({ rows: [], rowCount: 1 }));
  oneMock.mockReset();
  oneMock.mockResolvedValue(null);
  clientQueryMock.mockClear();
  clientQueryMock.mockImplementation(async () => ({ rows: [{ version: 0 }] }));
  withTransactionMock.mockClear();
  runtimeAdvancedMock.mockResolvedValue({ reactions: { muteAll: false, reportEmoji: '', autoDeleteAfter: 0 } } as never);
});

describe('Reacciones del grupo', () => {
  it('bloquea las reacciones conservando el resto de permisos', async () => {
    const setChatPermissions = vi.fn(async () => true);
    const ctx = context({ api: {
      getChat: vi.fn(async () => ({ type: 'supergroup', permissions: { can_react_to_messages: true, can_send_messages: true, can_send_polls: false } })),
      getChatMember: vi.fn(async () => adminMember),
      setChatPermissions,
    } as never });
    await setGroupReactionMode(ctx, true);
    expect(setChatPermissions).toHaveBeenCalledWith(-1001, { can_react_to_messages: false, can_send_messages: true, can_send_polls: false });
  });

  it('no modifica permisos cuando el grupo ya está en el estado pedido', async () => {
    const setChatPermissions = vi.fn(async () => true);
    const ctx = context({ api: {
      getChat: vi.fn(async () => ({ type: 'supergroup', permissions: { can_react_to_messages: false } })),
      getChatMember: vi.fn(async () => adminMember),
      setChatPermissions,
    } as never });
    await setGroupReactionMode(ctx, true);
    expect(setChatPermissions).not.toHaveBeenCalled();
  });

  it('devuelve las reacciones cuando se levanta el bloqueo', async () => {
    const setChatPermissions = vi.fn(async () => true);
    const ctx = context({ api: {
      getChat: vi.fn(async () => ({ type: 'supergroup', permissions: { can_react_to_messages: false, can_send_messages: true } })),
      getChatMember: vi.fn(async () => adminMember),
      setChatPermissions,
    } as never });
    await setGroupReactionMode(ctx, false);
    expect(setChatPermissions).toHaveBeenCalledWith(-1001, { can_react_to_messages: true, can_send_messages: true });
  });

  it('exige un nivel Pro y un supergrupo', async () => {
    const free = context({ chat: { premium_until: null, premium_tier: null, pro_license_id: null, chat_id: -1001, type: 'supergroup' } as never, actorId: 5 });
    await expect(setGroupReactionMode(free, true)).rejects.toThrow();
    const basic = context({ chat: { ...premium, chat_id: -1001, type: 'group' } as never, actorId: 5 });
    await expect(setGroupReactionMode(basic, true)).rejects.toThrow();
  });

  it('guarda el estado del bloqueo de reacciones en los ajustes avanzados', async () => {
    const ctx = context({ api: {
      getChat: vi.fn(async () => ({ type: 'supergroup', permissions: { can_react_to_messages: true } })),
      getChatMember: vi.fn(async () => adminMember),
      setChatPermissions: vi.fn(async () => true),
    } as never });
    await setGroupReactionMode(ctx, true);
    const inserts = clientQueryMock.mock.calls.filter(call => String(call[0]).includes('INSERT INTO advanced_config'));
    expect(inserts).toHaveLength(1);
    expect(JSON.parse(String(inserts[0][1][1])).reactions.muteAll).toBe(true);
  });
});

describe('Reportes por reacción', () => {
  it('registra el reporte y borra el mensaje al alcanzar el umbral', async () => {
    runtimeAdvancedMock.mockResolvedValue({ reactions: { muteAll: false, reportEmoji: '👀', autoDeleteAfter: 2 } } as never);
    const deleteMessage = vi.fn(async () => true);
    const update = { chat: { id: -1001 }, message_id: 55, user: { id: 7, is_bot: false }, old_reaction: [], new_reaction: [{ type: 'emoji', emoji: '👀' }] } as never;
    oneMock.mockResolvedValue({ total: 2 } as never);
    const handled = await handleReactionReport({ deleteMessage } as never, pro, update);
    expect(handled).toBe(true);
    expect(deleteMessage).toHaveBeenCalledWith(-1001, 55);
  });

  it('ignora reacciones que no son el emoji configurado', async () => {
    runtimeAdvancedMock.mockResolvedValue({ reactions: { muteAll: false, reportEmoji: '👀', autoDeleteAfter: 0 } } as never);
    const update = { chat: { id: -1001 }, message_id: 56, user: { id: 7, is_bot: false }, old_reaction: [], new_reaction: [{ type: 'emoji', emoji: '👍' }] } as never;
    expect(await handleReactionReport({} as never, pro, update)).toBe(false);
  });
});

describe('Poda de miembros inactivos', () => {
  const inactiveRow = { user_id: '9', first_name: 'Inactivo', last_name: null, username: null, joined_at: new Date(0), last_message_at: new Date(0), message_count: '0' };
  function cleanupContext() {
    return context({
      chat: { ...premium, chat_id: -1001, type: 'supergroup' } as never,
      api: {
        getChatMember: vi.fn(async (_chatId: number, userId: number) => userId === 42 ? adminMember : { status: 'member', user: { id: userId } }),
        getChatAdministrators: vi.fn(async () => [{ user: { id: 5 } }]),
      } as never,
    });
  }

  it('selecciona miembros inactivos y deja fuera a los protegidos', async () => {
    queryMock.mockImplementation(async (sql: string) => sql.includes('FROM chat_members') ? { rows: [inactiveRow], rowCount: 1 } : { rows: [], rowCount: 1 });
    const criteria = cleanupCriteriaSchema.parse({ inactiveDays: 30, action: 'kick', limit: 10, reason: 'Limpieza de inactivos' });
    const preview = await previewMemberCleanup(cleanupContext(), criteria);
    expect(preview.items).toHaveLength(1);
    expect(preview.token).toBeTruthy();
    const candidateCall = queryMock.mock.calls.find(call => String(call[0]).includes('FROM chat_members'))!;
    expect(candidateCall[1][2]).toContain(5);
  });

  it('expulsa a los miembros confirmados tras la vista previa', async () => {
    queryMock.mockImplementation(async (sql: string) => sql.includes('FROM chat_members') ? { rows: [inactiveRow], rowCount: 1 } : { rows: [], rowCount: 1 });
    const banChatMember = vi.fn(async () => true);
    const unbanChatMember = vi.fn(async () => true);
    const ctx = cleanupContext();
    (ctx.api as unknown as { banChatMember: unknown }).banChatMember = banChatMember;
    (ctx.api as unknown as { unbanChatMember: unknown }).unbanChatMember = unbanChatMember;
    const criteria = cleanupCriteriaSchema.parse({ inactiveDays: 30, action: 'kick', limit: 10, reason: 'Limpieza de inactivos' });
    const { token } = await previewMemberCleanup(ctx, criteria);
    const result = await applyMemberCleanup(ctx, token!);
    expect(banChatMember).toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({ userId: 9, state: 'applied' });
  });

  it('rechaza un token manipulado', async () => {
    await expect(applyMemberCleanup(cleanupContext(), 'abc.def')).rejects.toThrow();
  });
});
