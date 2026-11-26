import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { AuthService } from '../../src/services/authService.js';
import { OrderService } from '../../src/services/orderService.js';
import { ImageStorageService } from '../../src/services/imageStorageService.js';
import { maintenanceTargetNames, runMaintenance } from '../../src/services/maintenanceService.js';
import { parseMaintenanceArgs } from '../../scripts/manutencao.js';
import { changePasswordSchema, createOrderSchema, resetPasswordSchema } from '../../src/validators/schemas.js';
import { openapi } from '../../src/docs/openapi.js';

const PASSWORD = 'Senha-Antiga-Segura-123';
const NEW_PASSWORD = 'Senha-Nova-Segura-456';

describe('entregas da etapa 2', () => {
  it('valida troca e redefinicao de senha forte', () => {
    expect(changePasswordSchema.safeParse({ senha_atual: PASSWORD, nova_senha: NEW_PASSWORD, confirmar_nova_senha: NEW_PASSWORD }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ senha_atual: PASSWORD, nova_senha: 'fraca', confirmar_nova_senha: 'fraca' }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ senha_atual: PASSWORD, nova_senha: NEW_PASSWORD, confirmar_nova_senha: PASSWORD }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ nova_senha: NEW_PASSWORD }).success).toBe(true);
  });

  it('troca senha, revoga todas as sessoes e nao audita segredo', async () => {
    const { hashPassword } = await import('../../src/utils/password.js');
    const previousHash = await hashPassword(PASSWORD);
    const trx = { fn: { now: () => new Date() } };
    const repository = {
      database: { transaction: (callback) => callback(trx) },
      findUserForPasswordUpdate: vi.fn().mockResolvedValue({ id: 7, ativo: true, senha_hash: previousHash }),
      updatePasswordHash: vi.fn().mockResolvedValue(1),
      revokeAll: vi.fn().mockResolvedValue(2),
    };
    const audit = { registrar: vi.fn().mockResolvedValue(undefined) };
    const service = new AuthService(repository, audit);
    await expect(service.changePassword(7, 'errada', NEW_PASSWORD, {})).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' });
    await expect(service.changePassword(7, PASSWORD, PASSWORD, {})).rejects.toMatchObject({ code: 'PASSWORD_REUSED' });
    await expect(service.changePassword(7, PASSWORD, NEW_PASSWORD, { method: 'POST', endpoint: '/auth/alterar-senha', requestId: 'id' })).resolves.toEqual({ login_necessario: true });
    expect(repository.revokeAll).toHaveBeenCalledWith(7, trx);
    expect(JSON.stringify(audit.registrar.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(audit.registrar.mock.calls)).not.toContain(NEW_PASSWORD);
  });

  it('pedido manual aceita ENTREGA e RETIRADA sem confiar em totais', async () => {
    for (const tipo of ['ENTREGA', 'RETIRADA']) {
      const orders = { database: { transaction: (callback) => callback({}) } };
      const service = new OrderService({ orders, catalog: {}, store: {} });
      const order = { id: tipo === 'ENTREGA' ? 1 : 2, criado_em: new Date(), tipo_entrega: tipo, status: 'PENDENTE', subtotal: '10.00', taxa_entrega: tipo === 'ENTREGA' ? '5.00' : '0.00', total: tipo === 'ENTREGA' ? '15.00' : '10.00', itens: [] };
      service.persist = vi.fn().mockResolvedValue({ order, notifiedUserIds: [] });
      const input = { tipo_entrega: tipo };
      await expect(service.createAdmin(input, { user: { id: 9 } })).resolves.toMatchObject({ pedido_id: order.id, taxa_entrega: order.taxa_entrega });
      expect(service.persist).toHaveBeenCalledWith({}, input, 'PAINEL', 9, expect.anything());
    }
    expect(createOrderSchema.safeParse({ cliente: { nome: 'A', telefone: '18999999999' }, tipo_entrega: 'RETIRADA', endereco: null, metodo_pagamento_id: 1, itens: [{ produto_id: 1, quantidade: 1, adicionais: [] }], total: '0.01' }).success).toBe(false);
  });

  it('reencoda imagem real em WebP e recusa conteudo forjado', async () => {
    const client = { send: vi.fn().mockResolvedValue({}) };
    const audit = { registrar: vi.fn().mockResolvedValue(undefined) };
    const config = {
      R2_ENABLED: true, R2_ACCOUNT_ID: 'account', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'bucket', R2_PUBLIC_BASE_URL: 'https://img.exemplo.com',
      IMAGE_UPLOAD_MAX_BYTES: 5 * 1024 * 1024, IMAGE_UPLOAD_MAX_PIXELS: 40000000,
    };
    const service = new ImageStorageService({ config, client, audit });
    const jpeg = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#ff0000' } }).jpeg().toBuffer();
    const result = await service.upload('produtos', { buffer: jpeg }, { user: { id: 1 }, method: 'POST', endpoint: '/uploads/produtos', requestId: 'id' });
    expect(result).toMatchObject({ formato: 'webp', largura: 20, altura: 10 });
    expect(result.url).toMatch(/^https:\/\/img\.exemplo\.com\/imagens\/produtos\/[0-9a-f-]+\.webp$/);
    expect(client.send).toHaveBeenCalledOnce();
    await expect(service.prepare({ buffer: Buffer.from('<svg><script>x</script></svg>') }, 'logo')).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('propaga falha do R2 sem afetar outros servicos', async () => {
    const client = { send: vi.fn().mockRejectedValue(new Error('R2 indisponivel')) };
    const config = {
      R2_ENABLED: true, R2_ACCOUNT_ID: 'account', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'bucket', R2_PUBLIC_BASE_URL: 'https://img.exemplo.com',
      IMAGE_UPLOAD_MAX_BYTES: 5 * 1024 * 1024, IMAGE_UPLOAD_MAX_PIXELS: 40000000,
    };
    const service = new ImageStorageService({ config, client, audit: { registrar: vi.fn() } });
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer();
    await expect(service.upload('logo', { buffer: png }, { user: { id: 1 } })).rejects.toThrow(/R2 indisponivel/);
  });

  it('storage ausente falha apenas no recurso especifico', async () => {
    const service = new ImageStorageService({ config: { R2_ENABLED: false }, client: { send: vi.fn() } });
    await expect(service.upload('logo', { buffer: Buffer.from('x') }, { user: { id: 1 } })).rejects.toMatchObject({ code: 'IMAGE_STORAGE_NOT_CONFIGURED' });
  });

  it('recusa arquivo acima do limite antes de decodificar', async () => {
    const service = new ImageStorageService({ config: { IMAGE_UPLOAD_MAX_BYTES: 4, IMAGE_UPLOAD_MAX_PIXELS: 1000000 } });
    await expect(service.prepare({ buffer: Buffer.alloc(5) }, 'logo')).rejects.toMatchObject({ statusCode: 413, code: 'IMAGE_TOO_LARGE' });
  });

  it('valida magic bytes e decode de JPEG, PNG e WebP e remove metadados', async () => {
    const config = { IMAGE_UPLOAD_MAX_BYTES: 1024 * 1024, IMAGE_UPLOAD_MAX_PIXELS: 1000000 };
    const service = new ImageStorageService({ config });
    const source = sharp({ create: { width: 12, height: 8, channels: 3, background: '#123456' } });
    const images = [
      await source.clone().jpeg().withMetadata({ orientation: 6 }).toBuffer(),
      await source.clone().png().toBuffer(),
      await source.clone().webp().toBuffer(),
    ];
    for (const buffer of images) {
      const prepared = await service.prepare({ buffer, originalname: 'arquivo.exe', mimetype: 'application/octet-stream' }, 'produtos');
      const metadata = await sharp(prepared.buffer).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
    }
    await expect(service.prepare({ buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)]) }, 'logo'))
      .rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    await expect(service.prepare({ buffer: Buffer.from('MZ executable disfarced.jpg') }, 'logo'))
      .rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('recusa excesso de pixels e compensa objeto se auditoria falhar', async () => {
    const tooManyPixels = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).png().toBuffer();
    const limited = new ImageStorageService({ config: { IMAGE_UPLOAD_MAX_BYTES: 1024 * 1024, IMAGE_UPLOAD_MAX_PIXELS: 1000 } });
    await expect(limited.prepare({ buffer: tooManyPixels }, 'logo')).rejects.toMatchObject({ code: 'INVALID_IMAGE' });

    const client = { send: vi.fn().mockResolvedValue({}) };
    const config = {
      R2_ENABLED: true, R2_ACCOUNT_ID: 'fixture', R2_ACCESS_KEY_ID: 'fixture', R2_SECRET_ACCESS_KEY: 'fixture',
      R2_BUCKET: 'fixture', R2_PUBLIC_BASE_URL: 'https://images.example.invalid',
      IMAGE_UPLOAD_MAX_BYTES: 1024 * 1024, IMAGE_UPLOAD_MAX_PIXELS: 1000000,
    };
    const service = new ImageStorageService({
      config,
      client,
      audit: { registrar: vi.fn().mockRejectedValue(new Error('auditoria indisponivel')) },
    });
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer();
    await expect(service.upload('logo', { buffer: png }, { user: { id: 1 } })).rejects.toThrow(/auditoria/);
    expect(client.send).toHaveBeenCalledTimes(2);
    expect(client.send.mock.calls[0][0].constructor.name).toBe('PutObjectCommand');
    expect(client.send.mock.calls[1][0].constructor.name).toBe('DeleteObjectCommand');
  });

  it('exige URL publica HTTPS sem credenciais ou query', async () => {
    const base = {
      R2_ENABLED: true, R2_ACCOUNT_ID: 'fixture', R2_ACCESS_KEY_ID: 'fixture', R2_SECRET_ACCESS_KEY: 'fixture',
      R2_BUCKET: 'fixture', IMAGE_UPLOAD_MAX_BYTES: 1024, IMAGE_UPLOAD_MAX_PIXELS: 1000000,
    };
    for (const url of ['http://images.example.invalid', 'https://user:pass@images.example.invalid', 'https://images.example.invalid?token=x']) {
      const service = new ImageStorageService({ config: { ...base, R2_PUBLIC_BASE_URL: url }, client: { send: vi.fn() } });
      expect(() => service.requireConfigured()).toThrow(/URL publica/);
    }
  });

  it('manutencao e dry-run por padrao e nunca inclui dados comerciais/auditoria', () => {
    expect(parseMaintenanceArgs([]).execute).toBe(false);
    expect(parseMaintenanceArgs(['--execute', '--batch=100']).execute).toBe(true);
    expect(parseMaintenanceArgs(['--execute', '--batch=100']).batchSize).toBe(100);
    const targets = maintenanceTargetNames();
    expect(targets).not.toContain('pedidos');
    expect(targets).not.toContain('itens_pedido');
    expect(targets).not.toContain('logs');
    expect(targets).not.toContain('notificacoes');
  });

  it('manutencao mockada permanece dry-run e valida o limite do lote', async () => {
    const calls = [];
    const db = (table) => {
      calls.push(table);
      const query = {
        where: () => query, orWhere: () => query, whereIn: () => query,
        clone: () => query, count: async () => [{ total: '2' }],
      };
      return query;
    };
    const result = await runMaintenance(db, { execute: false, now: new Date('2026-10-25T12:00:00Z') });
    expect(result).toHaveLength(5);
    expect(result.every((item) => item.dry_run && item.removidos === 0)).toBe(true);
    expect(calls).toEqual(maintenanceTargetNames());
    await expect(runMaintenance(db, { batchSize: 5001 })).rejects.toThrow(/batchSize/);
  });

  it('OpenAPI cobre novas rotas e representa bigint como string', () => {
    for (const path of ['/auth/alterar-senha', '/admin/usuarios/{id}/redefinir-senha', '/admin/produtos/{id}/vinculos', '/admin/uploads/produtos', '/admin/uploads/logo', '/admin/push/inscricoes']) {
      expect(openapi.paths[path]).toBeDefined();
    }
    expect(openapi.components.schemas.BigIntId.type).toBe('string');
    expect(openapi.paths['/admin/pedidos'].post.summary).toMatch(/ENTREGA.*RETIRADA/);
    expect(openapi.paths['/admin/uploads/produtos'].post.requestBody.content['multipart/form-data']).toBeDefined();
  });
});
