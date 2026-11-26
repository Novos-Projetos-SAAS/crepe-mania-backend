import { describe, expect, it, vi } from 'vitest';
import { sanitizeAuditPayload } from '../../src/utils/sanitize.js';
import { requirePermission } from '../../src/middlewares/auth.js';
import { classifySeed } from '../../src/database/seeds/seedManifest.js';
import { assertSafeTestDatabase } from '../../src/database/testGuard.js';
import { applySeedDescriptor } from '../../src/database/seeds/runSeeds.js';
import { decryptPushSecret, encryptPushSecret } from '../../src/utils/crypto.js';
import { canReceiveNotifications } from '../../src/services/notificationAccess.js';
import { deliverPushToProvider, isDeliveryAuthorized } from '../../src/notifications/pushWorker.js';
import { subscriptionRegistrationMode } from '../../src/services/notificationService.js';
import {
  canUseAdminSocket,
  notificationRoom,
  revalidateAdminSocket,
  scheduleTokenExpiry,
  startAdminSocketRevalidation,
} from '../../src/realtime/socket.js';
import { privacyRateKey } from '../../src/middlewares/security.js';
import { authService } from '../../src/services/authService.js';
import { sessionCookieOptions } from '../../src/controllers/authController.js';

describe('seguranca, RBAC e seeds', () => {
  it('remove segredos do payload de auditoria', () => {
    const result = sanitizeAuditPayload({ senha: 'x', headers: { authorization: 'Bearer x', cookie: 'x' }, ok: 'valor' });
    expect(result.senha).toBe('[REDACTED]'); expect(result.headers.authorization).toBe('[REDACTED]'); expect(result.ok).toBe('valor');
  });
  it('serializa datas para ISO e preserva redacao de segredos', () => {
    const valid = new Date('2026-11-16T20:15:00.000Z');
    const result = sanitizeAuditPayload({ criado_em: valid, headers: { authorization: 'Bearer segredo' } });
    expect(result.criado_em).toBe(valid.toISOString());
    expect(result.headers.authorization).toBe('[REDACTED]');
    expect(sanitizeAuditPayload({ criado_em: new Date('invalido') }).criado_em).toBeNull();
  });
  it('usa chave Push AES-256 separada e recusa chave errada ou malformada', () => {
    const pushKey = Buffer.alloc(32, 7).toString('base64');
    const otherKey = Buffer.alloc(32, 8).toString('base64');
    const encrypted = encryptPushSecret('p256dh-secreto', pushKey);
    expect(decryptPushSecret(encrypted, pushKey)).toBe('p256dh-secreto');
    expect(() => decryptPushSecret(encrypted, otherKey)).toThrow();
    expect(() => encryptPushSecret('x', 'jwt-secret-que-nao-e-base64')).toThrow();
  });
  it('exige pedidos.listar e notificacoes.receber e confere o dono no worker', () => {
    const attendant = { ativo: true, deletado_em: null, nivel: 'atendente', nivel_ativo: true, permissoes: ['pedidos.listar', 'notificacoes.receber'] };
    expect(canReceiveNotifications(attendant)).toBe(true);
    expect(canReceiveNotifications({ ...attendant, permissoes: ['pedidos.listar'] })).toBe(false);
    expect(canReceiveNotifications({ ...attendant, ativo: false })).toBe(false);
    const delivery = {
      notificacao_usuario_id: '1', subscription_usuario_id: '1', usuario_ativo: true,
      usuario_deletado_em: null, nivel: 'atendente', nivel_ativo: true,
      pode_listar_pedidos: true, pode_receber_notificacoes: true,
    };
    expect(isDeliveryAuthorized(delivery)).toBe(true);
    expect(isDeliveryAuthorized({ ...delivery, subscription_usuario_id: '2' })).toBe(false);
    expect(isDeliveryAuthorized({ ...delivery, pode_receber_notificacoes: false })).toBe(false);
  });
  it('troca A para B e worker nunca chama provedor para entrega antiga de A', async () => {
    expect(subscriptionRegistrationMode({ usuario_id: 'A' }, 'B')).toBe('TRANSFERIR');
    expect(subscriptionRegistrationMode({ usuario_id: 'B' }, 'B')).toBe('ATUALIZAR');
    const sendNotification = vi.fn();
    const delivery = {
      subscription_ativa: true, notificacao_usuario_id: 'A', subscription_usuario_id: 'B',
      usuario_ativo: true, usuario_deletado_em: null, nivel: 'admin', nivel_ativo: true,
      pode_listar_pedidos: false, pode_receber_notificacoes: false,
    };
    await expect(deliverPushToProvider(delivery, { sendNotification, decrypt: vi.fn() })).resolves.toEqual({ sent: false, reason: 'unauthorized' });
    expect(sendNotification).not.toHaveBeenCalled();
  });
  it('socket administrativo respeita permissao atual', () => {
    expect(canUseAdminSocket({ nivel: 'admin', permissoes: [] })).toBe(true);
    expect(canUseAdminSocket({ nivel: 'atendente', permissoes: ['pedidos.listar'] })).toBe(true);
    expect(canUseAdminSocket({ nivel: 'atendente', permissoes: [] })).toBe(false);
    expect(notificationRoom('A')).toBe('usuario:A');
    expect(notificationRoom('A')).not.toBe(notificationRoom('B'));
  });
  it('revalidacao desconecta sessao revogada e aceita reconexao valida', async () => {
    const socket = {
      data: { accessToken: 'token', user: { id: 9 } },
      leave: vi.fn(), disconnect: vi.fn(),
    };
    const auth = vi.spyOn(authService, 'authenticate').mockRejectedValueOnce(new Error('revogada'));
    await expect(revalidateAdminSocket(socket)).resolves.toBe(false);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    auth.mockResolvedValueOnce({ id: 9, nivel: 'atendente', permissoes: ['pedidos.listar'], sessionId: 's' });
    await expect(revalidateAdminSocket(socket)).resolves.toBe(true);
    expect(socket.data.user.sessionId).toBe('s');
    auth.mockRestore();
  });
  it('revalida periodicamente e no vencimento do JWT com timers controlados', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-26T12:00:00.000Z'));
      const periodicSocket = { id: 'periodic' };
      const periodicRevalidate = vi.fn().mockResolvedValue(true);
      const stop = startAdminSocketRevalidation(
        { sockets: new Map([['periodic', periodicSocket]]) },
        { intervalMs: 10000, revalidate: periodicRevalidate },
      );
      await vi.advanceTimersByTimeAsync(9999);
      expect(periodicRevalidate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(periodicRevalidate).toHaveBeenCalledOnce();
      expect(periodicRevalidate).toHaveBeenCalledWith(periodicSocket);
      stop();

      const expiryRevalidate = vi.fn().mockResolvedValue(false);
      const disconnectListeners = {};
      const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 2 })).toString('base64url');
      const expiringSocket = {
        data: { accessToken: `e30.${payload}.fixture` },
        once: (event, listener) => { disconnectListeners[event] = listener; },
      };
      scheduleTokenExpiry(expiringSocket, { revalidate: expiryRevalidate });
      await vi.advanceTimersByTimeAsync(2099);
      expect(expiryRevalidate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(expiryRevalidate).toHaveBeenCalledWith(expiringSocket);
      expect(disconnectListeners.disconnect).toBeTypeOf('function');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  it('marca cookies de sessao como Secure somente no ambiente de producao', () => {
    expect(sessionCookieOptions({ nodeEnv: 'test' })).toMatchObject({ httpOnly: true, secure: false });
    expect(sessionCookieOptions({ nodeEnv: 'production' })).toMatchObject({ httpOnly: true, secure: true });
  });
  it('chaves de rate limit combinam IP e identidade sem expor PII', () => {
    const requestA = { ip: '203.0.113.10' };
    const requestB = { ip: '203.0.113.11' };
    const key = privacyRateKey(requestA, 'login', 'Pessoa@Exemplo.com');
    expect(key).not.toContain('Pessoa');
    expect(key).not.toContain('Exemplo');
    expect(privacyRateKey(requestA, 'login', 'pessoa@exemplo.com')).toBe(key);
    expect(privacyRateKey(requestB, 'login', 'pessoa@exemplo.com')).not.toBe(key);
  });
  it('RBAC bloqueia sem permissao e libera admin', () => {
    const next = vi.fn(); requirePermission('pedidos.listar')({ user: { nivel: 'atendente', permissoes: [] } }, {}, next);
    expect(next.mock.calls[0][0].code).toBe('FORBIDDEN');
    const adminNext = vi.fn(); requirePermission('pedidos.listar')({ user: { nivel: 'admin', permissoes: [] } }, {}, adminNext); expect(adminNext).toHaveBeenCalledWith();
  });
  it('runner classifica seed aplicado, pendente e alterado', () => {
    const descriptor = { file: '001.js', checksum: 'abc' };
    expect(classifySeed(descriptor, [])).toBe('PENDENTE');
    expect(classifySeed(descriptor, [{ nome_arquivo: '001.js', checksum_sha256: 'abc' }])).toBe('APLICADO');
    expect(classifySeed(descriptor, [{ nome_arquivo: '001.js', checksum_sha256: 'def' }])).toBe('ALTERADO');
  });
  it('runner nao importa seed aplicado e bloqueia checksum alterado', async () => {
    const importer = vi.fn();
    const makeDb = (applied) => {
      const trx = vi.fn(() => ({ where: () => ({ first: async () => applied }) }));
      trx.raw = vi.fn(async () => undefined);
      return { transaction: (callback) => callback(trx) };
    };
    const descriptor = { file: '001.js', checksum: 'abc', url: new URL('file:///001.js') };
    await expect(applySeedDescriptor(makeDb({ nome_arquivo: '001.js', checksum_sha256: 'abc' }), descriptor, { importer })).resolves.toEqual({ file: '001.js', status: 'IGNORADO' });
    expect(importer).not.toHaveBeenCalled();
    await expect(applySeedDescriptor(makeDb({ nome_arquivo: '001.js', checksum_sha256: 'def' }), descriptor, { importer })).rejects.toThrow(/Integridade/);
  });
  it('exige opt-in e bloqueia ambiente de producao', async () => {
    await expect(assertSafeTestDatabase('postgres://x/teste', 'postgres://y/dev', { enabled: false })).rejects.toMatchObject({ code: 'INTEGRATION_NOT_ENABLED' });
    await expect(assertSafeTestDatabase('postgres://x/teste', 'postgres://y/dev', { enabled: true, nodeEnv: 'production' })).rejects.toMatchObject({ code: 'PRODUCTION_DATABASE_BLOCKED' });
    await expect(assertSafeTestDatabase('postgres://x@host/neondb', 'postgres://x@host/neondb', { enabled: true, nodeEnv: 'test' })).rejects.toMatchObject({ code: 'UNSAFE_TEST_DATABASE' });
  });
  it('compara identidade real sem depender do nome do banco ou da URL', async () => {
    const tlsIdentity = (systemIdentifier, neon = {}) => ({
      databaseName: 'neondb', databaseOid: '16384', systemIdentifier,
      projectId: neon.projectId ?? null, branchId: neon.branchId ?? null,
      endpointId: neon.endpointId ?? null, tlsProtocol: 'TLSv1.3',
    });
    const sameReader = vi.fn().mockResolvedValue(tlsIdentity('cluster-a'));
    await expect(assertSafeTestDatabase(
      'postgres://outro:segredo@ep-a-pooler.neon.tech/neondb?sslmode=require',
      'postgres://usuario:senha@ep-a.neon.tech/neondb?sslmode=require',
      { enabled: true, nodeEnv: 'test', identityReader: sameReader },
    )).rejects.toMatchObject({ code: 'UNSAFE_TEST_DATABASE' });

    const differentReader = vi.fn()
      .mockResolvedValueOnce(tlsIdentity('cluster-test'))
      .mockResolvedValueOnce(tlsIdentity('cluster-dev'));
    const result = await assertSafeTestDatabase(
      'postgres://x@ep-test.neon.tech/neondb',
      'postgres://y@ep-dev.neon.tech/neondb',
      { enabled: true, nodeEnv: 'test', identityReader: differentReader },
    );
    expect(result.safe).toBe(true);
    expect(result.test.identity_fingerprint).not.toBe(result.development.identity_fingerprint);

    const branchesReader = vi.fn()
      .mockResolvedValueOnce(tlsIdentity('cluster-compartilhado', { projectId: 'projeto', branchId: 'branch-test' }))
      .mockResolvedValueOnce(tlsIdentity('cluster-compartilhado', { projectId: 'projeto', branchId: 'branch-dev' }));
    await expect(assertSafeTestDatabase(
      'postgres://x@ep-test.neon.tech/neondb',
      'postgres://y@ep-dev.neon.tech/neondb',
      { enabled: true, nodeEnv: 'test', identityReader: branchesReader },
    )).resolves.toMatchObject({ safe: true });

    const sameBranchReader = vi.fn()
      .mockResolvedValueOnce(tlsIdentity('compute-a', { projectId: 'projeto', branchId: 'branch-unica', endpointId: 'endpoint-a' }))
      .mockResolvedValueOnce(tlsIdentity('compute-b', { projectId: 'projeto', branchId: 'branch-unica', endpointId: 'endpoint-b' }));
    await expect(assertSafeTestDatabase(
      'postgres://x@ep-a-pooler.neon.tech/neondb?application_name=teste',
      'postgres://y@ep-b.neon.tech/neondb?application_name=desenvolvimento',
      { enabled: true, nodeEnv: 'test', identityReader: sameBranchReader },
    )).rejects.toMatchObject({ code: 'UNSAFE_TEST_DATABASE' });
  });

  it('falha fechado com identidade ausente, parcial, ambigua ou TLS nao comprovado', async () => {
    const base = { databaseName: 'neondb', databaseOid: '1', tlsProtocol: 'TLSv1.3' };
    for (const incomplete of [
      { ...base, tlsProtocol: null, systemIdentifier: 'cluster' },
      { ...base },
      { ...base, projectId: 'project-only' },
      { ...base, branchId: 'branch-only' },
      { ...base, endpointId: 'endpoint-nao-e-identidade-de-branch' },
    ]) {
      const reader = vi.fn().mockResolvedValue(incomplete);
      await expect(assertSafeTestDatabase(
        'postgres://x@ep-test.neon.tech/neondb',
        'postgres://y@ep-dev.neon.tech/neondb',
        { enabled: true, nodeEnv: 'test', identityReader: reader },
      )).rejects.toMatchObject({ code: 'DATABASE_IDENTITY_INCOMPLETE' });
    }
  });
});
