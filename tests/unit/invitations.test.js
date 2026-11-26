import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { InvitationService } from '../../src/services/invitationService.js';
import { acceptInvitationSchema, createInvitationSchema, invitationTokenSchema } from '../../src/validators/schemas.js';

const NOW = new Date('2026-10-28T12:00:00.000Z');
const TOKEN = 'a'.repeat(43);
const PASSWORD = 'Senha-Convite-Segura-123';

function transactionProvider() {
  const trx = { fn: { now: () => NOW } };
  return { trx, database: { transaction: (callback) => callback(trx) } };
}

describe('convites de colaboradores', () => {
  it('valida contratos estritos, senha forte e token opaco', () => {
    expect(createInvitationSchema.safeParse({ email: 'pessoa@example.invalid', nivel_acesso_id: '2' }).success).toBe(true);
    expect(createInvitationSchema.safeParse({ email: 'pessoa@example.invalid', nivel_acesso_id: '2', extra: true }).success).toBe(false);
    expect(invitationTokenSchema.safeParse({ token: TOKEN }).success).toBe(true);
    expect(invitationTokenSchema.safeParse({ token: 'curto' }).success).toBe(false);
    expect(acceptInvitationSchema.safeParse({ token: TOKEN, nome: 'Pessoa', senha: PASSWORD, confirmar_senha: PASSWORD }).success).toBe(true);
    expect(acceptInvitationSchema.safeParse({ token: TOKEN, nome: 'Pessoa', senha: PASSWORD, confirmar_senha: 'Outra-Senha-123' }).success).toBe(false);
  });

  it('normaliza e-mail, persiste somente hash e nunca envia token para auditoria', async () => {
    const { database } = transactionProvider();
    let persisted;
    const repository = {
      database,
      lockEmail: vi.fn(),
      findLevel: vi.fn().mockResolvedValue({ id: '2', nome: 'atendente' }),
      findExistingUserByEmail: vi.fn().mockResolvedValue(null),
      findActivePendingByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn(async (data) => { persisted = data; return { id: '9', ...data, criado_em: NOW, atualizado_em: NOW }; }),
    };
    const audit = { registrar: vi.fn() };
    const service = new InvitationService(repository, {
      audit,
      config: { INVITE_EXPIRATION_HOURS: 48 },
      tokenFactory: vi.fn().mockReturnValue(TOKEN),
      hashToken: vi.fn((value) => `hash:${value.length}`),
      now: () => NOW,
    });
    const response = await service.create(
      { email: '  Pessoa@Example.Invalid ', nivel_acesso_id: '2' },
      { user: { id: '1', nivel: 'admin' }, method: 'POST', endpoint: '/api/v1/admin/convites', requestId: 'request-id' },
    );
    expect(response.token).toBe(TOKEN);
    expect(persisted.email_normalizado).toBe('pessoa@example.invalid');
    expect(persisted.token_hash).toBe(`hash:${TOKEN.length}`);
    expect(JSON.stringify(persisted)).not.toContain(TOKEN);
    expect(JSON.stringify(audit.registrar.mock.calls)).not.toContain(TOKEN);
    expect(response.convite).not.toHaveProperty('token_hash');
  });

  it('aceita uma unica vez sob lock e cria senha somente via hasher Argon2id injetado', async () => {
    const { database } = transactionProvider();
    const invitation = {
      id: '7', email_normalizado: 'pessoa@example.invalid', nivel_acesso_id: '2', nivel: 'atendente',
      nivel_ativo: true, status: 'PENDENTE', expira_em: new Date('2026-10-29T12:00:00.000Z'),
    };
    const repository = {
      database,
      findByTokenHash: vi.fn(async (_hash, _trx, options) => options?.forUpdate ? invitation : invitation),
      findExistingUserByEmail: vi.fn().mockResolvedValue(null),
      createUser: vi.fn().mockResolvedValue({ id: '12' }),
      update: vi.fn(async (_id, data) => { Object.assign(invitation, data); return invitation; }),
    };
    const audit = { registrar: vi.fn() };
    const passwordHasher = vi.fn().mockResolvedValue('$argon2id$fixture');
    const service = new InvitationService(repository, { audit, passwordHasher, hashToken: () => 'hash', now: () => NOW });
    await expect(service.accept({ token: TOKEN, nome: 'Pessoa', senha: PASSWORD }, { method: 'POST', endpoint: '/api/v1/convites/aceitar', requestId: 'request-id' }))
      .resolves.toEqual({ aceito: true, login_necessario: true });
    expect(passwordHasher).toHaveBeenCalledWith(PASSWORD);
    expect(repository.findByTokenHash.mock.calls[0][2]).toEqual({ forUpdate: true });
    expect(invitation.status).toBe('ACEITO');
    await expect(service.accept({ token: TOKEN, nome: 'Pessoa', senha: PASSWORD }, { method: 'POST', endpoint: '/api/v1/convites/aceitar', requestId: 'request-id-2' }))
      .rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });
    expect(repository.createUser).toHaveBeenCalledOnce();
    expect(JSON.stringify(audit.registrar.mock.calls)).not.toContain(TOKEN);
  });

  it('revoga explicitamente o registro expirado antes de reemitir', async () => {
    const { database, trx } = transactionProvider();
    const expired = {
      id: '7', email_normalizado: 'pessoa@example.invalid', nivel_acesso_id: '2',
      status: 'PENDENTE', expira_em: new Date('2026-10-27T12:00:00.000Z'),
    };
    const repository = {
      database,
      findById: vi.fn().mockResolvedValue(expired),
      lockEmail: vi.fn(),
      findByIdForUpdate: vi.fn().mockResolvedValue(expired),
      findExistingUserByEmail: vi.fn().mockResolvedValue(null),
      findLevel: vi.fn().mockResolvedValue({ id: '2', nome: 'atendente' }),
      update: vi.fn().mockResolvedValue({ ...expired, status: 'REVOGADO', revogado_em: NOW }),
      revokeActivePendingByEmail: vi.fn(),
      create: vi.fn().mockResolvedValue({
        id: '8', email_normalizado: expired.email_normalizado, nivel_acesso_id: '2',
        status: 'PENDENTE', expira_em: new Date('2026-10-30T12:00:00.000Z'), criado_em: NOW, atualizado_em: NOW,
      }),
    };
    const audit = { registrar: vi.fn() };
    const service = new InvitationService(repository, {
      audit,
      config: { INVITE_EXPIRATION_HOURS: 48 },
      tokenFactory: () => TOKEN,
      hashToken: () => 'hash',
      now: () => NOW,
    });

    await expect(service.reissue('7', {
      user: { id: '1', nivel: 'admin' }, method: 'POST', endpoint: '/api/v1/admin/convites/7/reemitir', requestId: 'request-id',
    })).resolves.toMatchObject({ token: TOKEN, convite: { id: '8', status: 'PENDENTE' } });
    expect(repository.update).toHaveBeenCalledWith('7', { status: 'REVOGADO', revogado_em: NOW }, trx);
    expect(repository.revokeActivePendingByEmail).toHaveBeenCalledWith(expired.email_normalizado, '7', trx);
  });

  it('usa resposta publica generica e cabecalhos contra cache/referrer', async () => {
    const repository = { database: {}, findByTokenHash: vi.fn().mockResolvedValue(null) };
    const service = new InvitationService(repository, { hashToken: () => 'hash', now: () => NOW });
    await expect(service.validate(TOKEN)).resolves.toEqual({ valido: false });

    const response = await request(app).post('/api/v1/convites/validar').send({ token: 'curto' }).expect(422);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-robots-tag']).toContain('noindex');
  });
});
