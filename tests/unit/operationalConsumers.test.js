import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import knex from 'knex';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatPrintTest, PrintingService } from '../../src/services/printingService.js';
import { AndroidPrintingService } from '../../src/services/androidPrintingService.js';
import { NotificationService } from '../../src/services/notificationService.js';
import { processNextPush } from '../../src/notifications/pushWorker.js';
import { qzSignSchema } from '../../src/validators/schemas.js';
import { env } from '../../src/config/env.js';
import { sha256 } from '../../src/utils/crypto.js';
import { formatTextReceipt } from '../../src/printing/receiptFormatter.js';

const pending = { id: 1, fluxo_pagamento: 'INFINITEPAY', status: 'PENDENTE', itens: [], total: '20.00' };
const released = { ...pending, liberado_operacionalmente_em: new Date(), confirmacao_liberacao_id: 'confirmation' };
const lease = { id: 8, pedido_id: 1, destino: 'ANDROID_BLUETOOTH', tipo: 'COMANDA', status: 'EM_PROCESSAMENTO', tentativas: 1, dispositivo_id: 3, lease_token_hash: sha256('lease'), lease_ate: new Date(Date.now() + 60000), payload_snapshot: released };
const databases = [];
const qzDefaults = { QZ_ENABLED: env.QZ_ENABLED, QZ_PRIVATE_KEY: env.QZ_PRIVATE_KEY, QZ_CERTIFICATE: env.QZ_CERTIFICATE };

function configureQz() {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  Object.assign(env, { QZ_ENABLED: true, QZ_PRIVATE_KEY: keys.privateKey, QZ_CERTIFICATE: 'certificate' });
  return keys;
}

// QZ Tray 2.2.5 defaultConfig: https://github.com/qzind/tray/blob/v2.2.5/js/qz-tray.js#L401-L424
const officialQzOptions = { bounds: null, colorType: 'color', copies: 1, density: 0, duplex: false, fallbackDensity: null, interpolation: 'bicubic', jobName: null, legacy: false, margins: 0, orientation: null, paperThickness: null, printerTray: null, rasterize: false, rotation: 0, scaleContent: true, size: null, units: 'in', forceRaw: false, encoding: null, spool: null };
const qzRequest = (text) => JSON.stringify({ call: 'print', params: { printer: { name: 'Crepe Mania' }, options: officialQzOptions, data: [{ type: 'raw', format: 'command', flavor: 'plain', data: text }] }, timestamp: Date.now() });

function database(respond) {
  const db = knex({ client: 'pg' });
  const queries = [];
  db.client.acquireConnection = async () => ({ query: (query, callback) => {
    queries.push({ sql: query.text, bindings: query.values ?? [] });
    Promise.resolve().then(() => respond(query.text, query.values ?? [])).then((rows) => callback(null, { rows: rows ?? [], rowCount: rows?.length ?? 0, command: query.text.split(' ')[0].toUpperCase() }), callback);
  } });
  db.client.releaseConnection = async () => {};
  databases.push(db);
  return { db, queries };
}

afterEach(async () => { Object.assign(env, qzDefaults); vi.restoreAllMocks(); await Promise.all(databases.splice(0).map((db) => db.destroy())); });

describe('payment gates on operational consumers', () => {
  it('blocks text and HTML receipts for current pending online orders', async () => {
    const service = new PrintingService(undefined, { detail: async () => pending });
    await expect(service.receipt(1, 'texto')).rejects.toMatchObject({ code: 'ORDER_PAYMENT_PENDING', statusCode: 409 });
    await expect(service.receipt(1, 'html')).rejects.toMatchObject({ code: 'ORDER_PAYMENT_PENDING' });
  });

  it('preserves traditional receipt generation', async () => {
    const service = new PrintingService(undefined, { detail: async () => ({ ...pending, fluxo_pagamento: 'TRADICIONAL' }) });
    await expect(service.receipt(1, 'texto')).resolves.toMatchObject({ content: expect.stringContaining('PEDIDO #1') });
  });

  it('blocks receipts after a released online order was canceled', async () => {
    const service = new PrintingService(undefined, { detail: async () => ({ ...released, status: 'CANCELADO' }) });
    await expect(service.receipt(1, 'texto')).rejects.toMatchObject({ code: 'ORDER_PAYMENT_PENDING' });
  });

  it('does not insert a manual print for a pending online order', async () => {
    const { db, queries } = database(() => []);
    const service = new PrintingService(() => db, { detail: async () => pending });
    await expect(service.request(1, { user: { id: 2 } })).rejects.toMatchObject({ code: 'ORDER_PAYMENT_PENDING' });
    expect(queries.some(({ sql }) => sql.startsWith('insert'))).toBe(false);
  });

  it('does not create notifications from a forged released snapshot', async () => {
    const { db, queries } = database((sql) => sql.includes('from "pedidos"') ? [pending] : []);
    const service = new NotificationService(() => db);
    expect(await db.transaction((trx) => service.createNewOrderNotifications(trx, released))).toEqual([]);
    expect(queries.some(({ sql }) => sql.includes('from "pedidos"') && sql.includes('for update'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('from "usuarios"'))).toBe(false);
  });

  it('creates the existing per-user notification after release', async () => {
    const { db, queries } = database((sql) => {
      if (sql.includes('from "pedidos"')) return [released];
      if (sql.includes('from "usuarios"')) return [{ id: 2 }];
      if (sql.startsWith('insert into "notificacoes"')) return [{ id: 9 }];
      return [];
    });
    expect(await db.transaction((trx) => new NotificationService(() => db).createNewOrderNotifications(trx, pending))).toEqual(['2']);
    expect(queries.filter(({ sql }) => sql.startsWith('insert into "notificacoes"'))).toHaveLength(1);
  });

  it('rejects Android start using the current order before acquiring the job lock', async () => {
    const { db, queries } = database((sql) => sql.includes('from "pedidos"') ? [pending] : sql.includes('from "impressoes"') ? [lease] : []);
    const service = new AndroidPrintingService(() => db);
    await expect(service.startSending(3, 8, 'lease')).rejects.toMatchObject({ code: 'ORDER_PAYMENT_PENDING' });
    const orderLock = queries.findIndex(({ sql }) => sql.includes('from "pedidos"') && sql.includes('for update'));
    const jobLock = queries.findIndex(({ sql }) => sql.includes('from "impressoes"') && sql.includes('for update'));
    expect(orderLock).toBeGreaterThan(-1);
    expect(jobLock === -1 || orderLock < jobLock).toBe(true);
    expect(queries.some(({ sql }) => sql.startsWith('update "impressoes"'))).toBe(false);
  });

  it.each(['legacy', 'android'])('rechecks the order after the %s candidate selection', async (kind) => {
    const { db, queries } = database((sql) => sql.includes('"lease_ate" <= CURRENT_TIMESTAMP') ? [] : sql.includes('from "impressoes"') ? [lease] : sql.includes('from "pedidos"') ? [pending] : []);
    const result = kind === 'legacy' ? await new PrintingService(() => db).next() : await new AndroidPrintingService(() => db).reserve({ id: 3, turno_ativo: true });
    expect(result).toBeNull();
    expect(queries.some(({ sql }) => sql.startsWith('update "impressoes"') && sql.includes('where "id"'))).toBe(false);
    expect(queries.some(({ sql }) => sql.includes('from "impressoes"') && sql.includes('for update'))).toBe(false);
  });

  it.each(['legacy', 'android'])('preserves %s reservation for a released current order', async (kind) => {
    const job = { ...lease, destino: kind === 'legacy' ? 'AGENTE_LEGADO' : 'ANDROID_BLUETOOTH', status: 'PENDENTE' };
    const { db, queries } = database((sql) => sql.includes('"lease_ate" <= CURRENT_TIMESTAMP') ? [] : sql.includes('from "impressoes"') ? [job] : sql.includes('from "pedidos"') ? [released] : sql.startsWith('update "impressoes"') && sql.includes('where "id"') ? [{ ...job, status: 'EM_PROCESSAMENTO', tentativas: 2 }] : []);
    const result = kind === 'legacy' ? await new PrintingService(() => db).next() : await new AndroidPrintingService(() => db).reserve({ id: 3, turno_ativo: true });
    expect(result).toMatchObject({ pedido_id: 1, tentativa: 2, lease_token: expect.any(String) });
    expect(kind === 'legacy' ? result.conteudo : result.conteudo_texto).toContain('PEDIDO #1');
    const locked = queries.filter(({ sql }) => sql.includes('for update'));
    expect(locked[0].sql).toContain('from "pedidos"');
    expect(locked[1].sql).toContain('from "impressoes"');
  });

  it('allows the Android send boundary only for a released current order', async () => {
    const { db, queries } = database((sql) => sql.includes('from "pedidos"') ? [released] : sql.includes('from "impressoes"') ? [lease] : sql.startsWith('update "impressoes"') ? [{ ...lease, envio_iniciado_em: new Date() }] : []);
    const result = await new AndroidPrintingService(() => db).startSending(3, 8, 'lease');
    expect(result.envio_iniciado_em).toBeInstanceOf(Date);
    const locked = queries.filter(({ sql }) => sql.includes('for update'));
    expect(locked[0].sql).toContain('from "pedidos"');
    expect(locked[1].sql).toContain('from "impressoes"');
  });

  it('keeps standalone Android TESTE jobs usable without an order', async () => {
    const testJob = { ...lease, tipo: 'TESTE', pedido_id: null };
    const { db, queries } = database((sql) => sql.includes('from "impressoes"') ? [testJob] : sql.startsWith('update "impressoes"') ? [{ ...testJob, envio_iniciado_em: new Date() }] : []);
    expect((await new AndroidPrintingService(() => db).startSending(3, 8, 'lease')).envio_iniciado_em).toBeInstanceOf(Date);
    expect(queries.some(({ sql }) => sql.includes('from "pedidos"'))).toBe(false);
  });

  it('rejects a standalone non-TESTE Android job', async () => {
    const { db } = database((sql) => sql.includes('from "impressoes"') ? [{ ...lease, pedido_id: null }] : []);
    await expect(new AndroidPrintingService(() => db).startSending(3, 8, 'lease')).rejects.toMatchObject({ code: 'INVALID_PRINT_ORDER' });
  });

  it('locks the current order before the Android result job and preserves safe retries', async () => {
    const { db, queries } = database((sql, bindings) => sql.includes('from "pedidos"') ? [released] : sql.includes('from "impressoes"') ? [lease] : sql.startsWith('update "impressoes"') ? [{ ...lease, status: bindings[0], resultado: bindings[1] }] : []);
    const result = await new AndroidPrintingService(() => db).reportResult(3, 8, { lease_token: 'lease', resultado: 'FALHA_ANTES_ENVIO' });
    expect(result).toMatchObject({ status: 'PENDENTE', resultado: 'FALHA_ANTES_ENVIO' });
    const locked = queries.filter(({ sql }) => sql.includes('for update'));
    expect(locked[0].sql).toContain('from "pedidos"');
    expect(locked[1].sql).toContain('from "impressoes"');
  });

  it('terminates Android failure before sending if the order was canceled', async () => {
    const { db, queries } = database((sql, bindings) => sql.includes('from "pedidos"') ? [{ ...released, status: 'CANCELADO' }] : sql.includes('from "impressoes"') ? [lease] : sql.startsWith('update "impressoes"') ? [{ ...lease, status: bindings[0], resultado: bindings[1] }] : []);
    const result = await new AndroidPrintingService(() => db).reportResult(3, 8, { lease_token: 'lease', resultado: 'FALHA_ANTES_ENVIO' });
    expect(result).toMatchObject({ status: 'FALHOU', resultado: 'FALHA_ANTES_ENVIO' });
    expect(queries.find(({ sql }) => sql.startsWith('update "impressoes"')).bindings[0]).not.toBe('PENDENTE');
  });

  it.each([false, true])('expires canceled Android leases without blocking the queue (send started: %s)', async (started) => {
    const expired = { ...lease, lease_ate: new Date(Date.now() - 60000), envio_iniciado_em: started ? new Date(Date.now() - 70000) : null };
    const { db, queries } = database((sql, bindings) => {
      if (sql.startsWith('update "impressoes"') && bindings[0] === 'PENDENTE') throw Object.assign(new Error('INFINITEPAY_OPERACAO_NAO_LIBERADA'), { code: '23514' });
      if (sql.includes('from "pedidos"')) return [{ ...released, status: 'CANCELADO' }];
      if (sql.includes('from "impressoes"')) return [expired];
      return [];
    });
    await expect(new AndroidPrintingService(() => db).expireLeases(db)).resolves.toBeUndefined();
    const update = queries.find(({ sql }) => sql.startsWith('update "impressoes"'));
    expect(update.bindings[0]).toBe(started ? 'RESULTADO_INDETERMINADO' : 'FALHOU');
    const locked = queries.filter(({ sql }) => sql.includes('for update'));
    expect(locked[0].sql).toContain('from "pedidos"');
    expect(locked[1].sql).toContain('from "impressoes"');
  });

  it('requeues only eligible expired Android jobs after locking their order first', async () => {
    const expired = { ...lease, lease_ate: new Date(Date.now() - 60000), envio_iniciado_em: null };
    const { db, queries } = database((sql) => sql.includes('from "pedidos"') ? [released] : sql.includes('from "impressoes"') ? [expired] : []);
    await new AndroidPrintingService(() => db).expireLeases(db);
    expect(queries.find(({ sql }) => sql.startsWith('update "impressoes"')).bindings[0]).toBe('PENDENTE');
    const locked = queries.filter(({ sql }) => sql.includes('for update'));
    expect(locked[0].sql).toContain('from "pedidos"');
    expect(locked[1].sql).toContain('from "impressoes"');
  });

  it('does not accept Android jobs through the legacy acknowledgement protocol', async () => {
    const { db } = database((sql, bindings) => sql.startsWith('select') && bindings.includes('AGENTE_LEGADO') ? [] : sql.startsWith('select') ? [lease] : [{ ...lease, status: 'CONCLUIDA' }]);
    await expect(new PrintingService(() => db).ack(8, { lease_token: 'lease', sucesso: true })).rejects.toMatchObject({ code: 'PRINT_NOT_FOUND' });
  });

  it('records legacy failure as indeterminate without requeue', async () => {
    const legacy = { ...lease, destino: 'AGENTE_LEGADO' };
    const { db, queries } = database((sql, bindings) => sql.startsWith('select') ? [legacy] : sql.startsWith('update') ? [{ ...legacy, status: bindings[0] }] : []);
    const result = await new PrintingService(() => db).ack(8, { lease_token: 'lease', sucesso: false, erro: 'socket disconnected after write' });
    expect(result.status).toBe('RESULTADO_INDETERMINADO');
    expect(queries.find(({ sql }) => sql.startsWith('update')).bindings).toContain('RESULTADO_INDETERMINADO');
  });

  it('never selects expired legacy deliveries for automatic retry', async () => {
    const { db, queries } = database(() => []);
    await new PrintingService(() => db).next();
    const expiration = queries.find(({ sql }) => sql.startsWith('update "impressoes"'));
    expect(expiration.bindings).toContain('RESULTADO_INDETERMINADO');
    const selection = queries.find(({ sql, bindings }) => sql.startsWith('select') && sql.includes('impressoes') && bindings.includes('PENDENTE'));
    expect(selection.bindings).not.toContain('EM_PROCESSAMENTO');
  });

  it.each(['legacy', 'android'])('filters %s candidates by current order before reservation', async (kind) => {
    const { db, queries } = database(() => []);
    if (kind === 'legacy') await new PrintingService(() => db).next();
    else await new AndroidPrintingService(() => db).reserve({ id: 3, turno_ativo: true });
    const selection = queries.find(({ sql, bindings }) => sql.startsWith('select') && sql.includes('impressoes') && bindings.includes('PENDENTE'));
    expect(selection.sql).toContain('pedidos');
    expect(selection.sql).toContain('confirmacao_liberacao_id');
    expect(selection.sql).toContain('liberado_operacionalmente_em');
    expect(selection.bindings).toContain('TESTE');
  });

  it('filters push candidates by current order before taking delivery locks', async () => {
    const { db, queries } = database(() => []);
    await processNextPush(db, { configuration: { habilitado: true }, sendNotification: vi.fn() });
    const selection = queries.find(({ sql }) => sql.startsWith('select') && sql.includes('entregas_push'));
    expect(selection.sql).toContain('pedidos');
    expect(selection.sql).toContain('confirmacao_liberacao_id');
    expect(selection.sql).toContain('liberado_operacionalmente_em');
  });

  it('does not send push if cancellation wins after candidate selection', async () => {
    const sendNotification = vi.fn();
    const { db } = database((sql) => sql.includes('from "pedidos"') ? [{ ...released, status: 'CANCELADO' }] : sql.startsWith('select') ? [{ id: 9, pedido_id: 1 }] : []);
    expect(await processNextPush(db, { configuration: { habilitado: true }, sendNotification })).toMatchObject({ processed: false });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('preserves authorized push delivery for a released order under the order lock', async () => {
    const sendNotification = vi.fn();
    const delivery = { id: 9, pedido_id: 1, tentativas: 0, subscription_id: 4, notificacao_usuario_id: 2, subscription_usuario_id: 2, subscription_ativa: true, usuario_ativo: true, nivel: 'admin', nivel_ativo: true, titulo: 'Novo pedido', corpo: 'Pedido #1', endpoint: 'https://push.example.test', p256dh: 'encrypted', auth: 'encrypted' };
    const { db, queries } = database((sql) => sql.includes('from "pedidos"') ? [released] : sql.startsWith('select') ? [delivery] : []);
    expect(await processNextPush(db, { configuration: { habilitado: true }, sendNotification, decrypt: () => 'decrypted' })).toMatchObject({ status: 'ENVIADO' });
    expect(sendNotification).toHaveBeenCalledOnce();
    const locked = queries.filter(({ sql }) => sql.includes('for update'));
    expect(locked[0].sql).toContain('from "pedidos"');
    expect(locked[1].sql).toContain('from "entregas_push"');
  });

  it('still discards push when the subscription no longer belongs to the notification recipient', async () => {
    const sendNotification = vi.fn();
    const delivery = { id: 9, pedido_id: 1, tentativas: 0, subscription_id: 4, notificacao_usuario_id: 2, subscription_usuario_id: 3, subscription_ativa: true, usuario_ativo: true, nivel: 'admin', nivel_ativo: true };
    const { db } = database((sql) => sql.includes('from "pedidos"') ? [released] : sql.startsWith('select') ? [delivery] : []);
    expect(await processNextPush(db, { configuration: { habilitado: true }, sendNotification })).toMatchObject({ status: 'DESCARTADO' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('requires a persisted job reference for QZ signatures', () => {
    expect(qzSignSchema.safeParse({ request: '{}' }).success).toBe(false);
    expect(qzSignSchema.safeParse({ job_id: 8, request: '{}' }).success).toBe(true);
  });

  it('signs only the exact server receipt of an eligible job', async () => {
    const { publicKey } = configureQz();
    const job = { ...lease, destino: 'AGENTE_LEGADO', status: 'PENDENTE', payload_snapshot: released };
    const { db } = database((sql) => sql.includes('from "pedidos"') ? [released] : sql.includes('from "impressoes"') ? [job] : []);
    const service = new PrintingService(() => db, { detail: async () => released });
    const request = qzRequest(formatTextReceipt(released));
    const signature = await service.qzSign({ job_id: 8, request });
    const qzDigest = createHash('sha256').update(request).digest('hex');
    expect(verify('RSA-SHA512', Buffer.from(qzDigest), publicKey, Buffer.from(signature, 'base64'))).toBe(true);
    expect(verify('RSA-SHA512', Buffer.from(request), publicKey, Buffer.from(signature, 'base64'))).toBe(false);
    await expect(service.qzSign({ job_id: 8, request: request.replace('PEDIDO #1', 'PEDIDO #999') })).rejects.toMatchObject({ code: 'INVALID_QZ_REQUEST' });
    await expect(service.qzSign({ job_id: 8, request: JSON.stringify({ call: 'print', params: { data: ['arbitrary'] } }) })).rejects.toMatchObject({ code: 'INVALID_QZ_REQUEST' });
  });

  it('does not sign a forged released QZ snapshot while current payment is pending', async () => {
    configureQz();
    const { db, queries } = database((sql) => sql.includes('from "pedidos"') ? [pending] : sql.includes('from "impressoes"') ? [lease] : []);
    await expect(new PrintingService(() => db).qzSign({ job_id: 8, request: qzRequest(formatTextReceipt(released)) })).rejects.toMatchObject({ code: 'ORDER_PAYMENT_PENDING' });
    expect(queries.some(({ sql }) => sql.startsWith('update'))).toBe(false);
  });

  it('does not issue a second QZ signature after the first may have reached a printer', async () => {
    configureQz();
    let job = { ...lease, destino: 'AGENTE_LEGADO', status: 'PENDENTE' };
    const { db } = database((sql, bindings) => {
      if (sql.includes('from "pedidos"')) return [released];
      if (sql.startsWith('update "impressoes"')) { job = { ...job, status: bindings[0] }; return []; }
      if (sql.includes('from "impressoes"')) return bindings.includes('PENDENTE') && job.status !== 'PENDENTE' ? [] : [job];
      return [];
    });
    const service = new PrintingService(() => db);
    const data = { job_id: 8, request: qzRequest(formatTextReceipt(released)) };
    expect(typeof await service.qzSign(data)).toBe('string');
    await expect(service.qzSign(data)).rejects.toMatchObject({ code: 'INVALID_PRINT_JOB' });
  });

  it('preserves QZ signatures for an authorized standalone TESTE job', async () => {
    configureQz();
    const job = { ...lease, tipo: 'TESTE', pedido_id: null, status: 'PENDENTE', payload_snapshot: { criado_em: new Date().toISOString() } };
    const { db, queries } = database((sql) => sql.includes('from "impressoes"') ? [job] : []);
    const signature = await new PrintingService(() => db).qzSign({ job_id: 8, request: qzRequest(formatPrintTest(job.payload_snapshot)) });
    expect(typeof signature).toBe('string');
    expect(queries.some(({ sql }) => sql.includes('from "pedidos"'))).toBe(false);
  });

  it('signs canonical compact QZ JSON with a single literal server receipt', async () => {
    const { publicKey } = configureQz();
    const job = { ...lease, destino: 'AGENTE_LEGADO', status: 'PENDENTE' };
    const { db } = database((sql) => sql.includes('from "pedidos"') ? [released] : sql.includes('from "impressoes"') ? [job] : []);
    const request = JSON.parse(qzRequest(formatTextReceipt(released)));
    request.params.data = [formatTextReceipt(released)];
    const compact = JSON.stringify(request);
    const signature = await new PrintingService(() => db).qzSign({ job_id: 8, request: JSON.stringify(request, null, 2) });
    expect(verify('RSA-SHA512', Buffer.from(createHash('sha256').update(compact).digest('hex')), publicKey, Buffer.from(signature, 'base64'))).toBe(true);
  });

  it.each(['file', 'host', 'forceRaw', 'spool', 'flavor'])('rejects QZ alternate output or raw interpretation: %s', async (change) => {
    configureQz();
    const job = { ...lease, destino: 'AGENTE_LEGADO', status: 'PENDENTE' };
    const { db } = database((sql) => sql.includes('from "pedidos"') ? [released] : sql.includes('from "impressoes"') ? [job] : []);
    const request = JSON.parse(qzRequest(formatTextReceipt(released)));
    if (change === 'file') request.params.printer = { file: 'C:/output.txt' };
    if (change === 'host') request.params.printer = { host: '127.0.0.1', port: 9100 };
    if (change === 'forceRaw') request.params.options.forceRaw = true;
    if (change === 'spool') request.params.options.spool = { end: '\\n' };
    if (change === 'flavor') request.params.data[0].flavor = 'file';
    await expect(new PrintingService(() => db).qzSign({ job_id: 8, request: JSON.stringify(request) })).rejects.toMatchObject({ code: 'INVALID_QZ_REQUEST' });
  });

  it.each(['copies', 'call', 'additional-data'])('rejects additional QZ instructions: %s', async (change) => {
    configureQz();
    const job = { ...lease, destino: 'AGENTE_LEGADO', status: 'PENDENTE' };
    const { db, queries } = database((sql) => sql.includes('from "pedidos"') ? [released] : sql.includes('from "impressoes"') ? [job] : []);
    const request = JSON.parse(qzRequest(formatTextReceipt(released)));
    if (change === 'copies') request.params.options.copies = 2;
    if (change === 'call') request.call = 'file.write';
    if (change === 'additional-data') request.params.data.push({ type: 'raw', format: 'plain', data: 'another receipt' });
    await expect(new PrintingService(() => db).qzSign({ job_id: 8, request: JSON.stringify(request) })).rejects.toMatchObject({ code: 'INVALID_QZ_REQUEST' });
    expect(queries.some(({ sql }) => sql.startsWith('update'))).toBe(false);
  });
});
