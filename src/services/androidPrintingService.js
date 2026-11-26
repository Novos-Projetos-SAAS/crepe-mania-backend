import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { getDb } from '../database/connection.js';
import { formatTextReceipt } from '../printing/receiptFormatter.js';
import { OrderRepository } from '../repositories/orderRepository.js';
import { filterOperationalPrintJobs, formatPrintTest, lockPrintOrder } from './printingService.js';
import { domainEvents } from '../realtime/domainEvents.js';
import { AppError } from '../utils/AppError.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { normalizeText, sanitizeAuditPayload } from '../utils/sanitize.js';
import { auditService } from './auditService.js';
import { isOperationallyReleased } from '../payments/orderPaymentPolicy.js';

const PAIRING_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function createPairingCode() {
  const bytes = randomBytes(8);
  return [...bytes].map((byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]).join('');
}

export function resolvePrintOutcome(job, reportedResult, { maxAttempts = env.PRINT_MAX_ATTEMPTS, retryBaseSeconds = env.PRINT_RETRY_BASE_SECONDS } = {}) {
  const result = reportedResult === 'FALHA_ANTES_ENVIO' && job.envio_iniciado_em ? 'RESULTADO_INDETERMINADO' : reportedResult;
  let status = result === 'ENVIADO' ? 'CONCLUIDA' : result === 'RESULTADO_INDETERMINADO' ? 'RESULTADO_INDETERMINADO' : 'PENDENTE';
  if (result === 'FALHA_ANTES_ENVIO' && job.tentativas >= maxAttempts) status = 'FALHOU';
  const retryDelaySeconds = Math.min(retryBaseSeconds * (2 ** Math.max(job.tentativas - 1, 0)), 900);
  return { result, status, retryDelaySeconds };
}

export function isMatchingReportedOutcome(job, reportedResult) {
  if (!job || job.status === 'EM_PROCESSAMENTO') return false;
  const expected = reportedResult === 'FALHA_ANTES_ENVIO' && job.envio_iniciado_em ? 'RESULTADO_INDETERMINADO' : reportedResult;
  return job.resultado === expected;
}

export function effectiveJobState(job, now = Date.now(), maxAttempts = env.PRINT_MAX_ATTEMPTS) {
  if (!job || job.status !== 'EM_PROCESSAMENTO' || !job.lease_ate || new Date(job.lease_ate).getTime() > now) return job;
  if (job.envio_iniciado_em) return { ...job, status: 'RESULTADO_INDETERMINADO', resultado: 'RESULTADO_INDETERMINADO' };
  if (job.tentativas >= maxAttempts) return { ...job, status: 'FALHOU', resultado: 'FALHA_ANTES_ENVIO' };
  return { ...job, status: 'PENDENTE', resultado: null };
}

function serializeDevice(device) {
  if (!device) return device;
  const safe = { ...device };
  delete safe.credencial_hash;
  return safe;
}

function serializeJobState(job) {
  return {
    id: job.id, status: job.status, resultado: job.resultado, tentativas: job.tentativas,
    envio_iniciado_em: job.envio_iniciado_em, enviado_em: job.enviado_em,
    concluido_em: job.concluido_em, lease_ate: job.lease_ate, atualizado_em: job.atualizado_em,
  };
}

function assertLease(job, deviceId, leaseToken) {
  const expired = !job.lease_ate || new Date(job.lease_ate).getTime() <= Date.now();
  if (job.status !== 'EM_PROCESSAMENTO' || String(job.dispositivo_id) !== String(deviceId) || expired || !job.lease_token_hash || job.lease_token_hash !== sha256(leaseToken)) {
    throw new AppError('Lease de impressao invalida ou expirada.', 409, 'INVALID_PRINT_LEASE');
  }
}

export class AndroidPrintingService {
  constructor(dbProvider = getDb, orders = new OrderRepository()) {
    this.dbProvider = dbProvider;
    this.orders = orders;
  }

  async authenticate(token) {
    if (!token) throw new AppError('Credencial do dispositivo ausente.', 401, 'PRINT_DEVICE_CREDENTIAL_REQUIRED');
    const device = await this.dbProvider()('dispositivos_impressao').where({ credencial_hash: sha256(token), status: 'ATIVO' }).where('credencial_expira_em', '>', new Date()).first();
    if (!device) throw new AppError('Credencial do dispositivo invalida, expirada ou revogada.', 401, 'INVALID_PRINT_DEVICE_CREDENTIAL');
    return serializeDevice(device);
  }

  async createPairing({ api_url: apiUrl }, context) {
    const code = createPairingCode();
    const expiresAt = new Date(Date.now() + env.PRINT_PAIRING_TTL_MINUTES * 60_000);
    const db = this.dbProvider();
    const [pairing] = await db('pareamentos_impressao').insert({ codigo_hash: sha256(code), criado_por_usuario_id: context.user.id, expira_em: expiresAt }).returning('*');
    await auditService.registrar({ usuarioId: context.user.id, acao: 'IMPRESSAO.PAREAMENTO.CRIAR', descricao: 'Codigo temporario de pareamento criado', recursoTipo: 'pareamento_impressao', recursoId: pairing.id, metodo: context.method, endpoint: context.endpoint, requestId: context.requestId, payload: { expira_em: expiresAt } });
    const query = new URLSearchParams({ codigo: code, api: apiUrl });
    return { codigo: code, expira_em: expiresAt, pareamento_uri: `shirleyprint://parear?${query}` };
  }

  async pair(data) {
    const db = this.dbProvider();
    return db.transaction(async (trx) => {
      const pairing = await trx('pareamentos_impressao').where({ codigo_hash: sha256(data.codigo) }).forUpdate().first();
      if (!pairing || pairing.usado_em || new Date(pairing.expira_em).getTime() <= Date.now()) {
        throw new AppError('Codigo de pareamento invalido, expirado ou ja utilizado.', 410, 'PAIRING_CODE_UNAVAILABLE');
      }
      const token = randomToken(48);
      const expiresAt = new Date(Date.now() + env.PRINT_DEVICE_TOKEN_TTL_DAYS * 86_400_000);
      const values = {
        nome: normalizeText(data.nome), credencial_hash: sha256(token), credencial_expira_em: expiresAt,
        status: 'ATIVO', turno_ativo: false, revogado_em: null, pareado_em: trx.fn.now(), ultimo_status: 'PAREADO',
        app_version: normalizeText(data.app_version), android_version: normalizeText(data.android_version), atualizado_em: trx.fn.now(),
      };
      const existing = await trx('dispositivos_impressao').where({ installation_id: data.installation_id }).forUpdate().first();
      const [device] = existing
        ? await trx('dispositivos_impressao').where({ id: existing.id }).update(values).returning('*')
        : await trx('dispositivos_impressao').insert({ installation_id: data.installation_id, ...values }).returning('*');
      await trx('pareamentos_impressao').where({ id: pairing.id }).update({ dispositivo_id: device.id, usado_em: trx.fn.now(), atualizado_em: trx.fn.now() });
      return { dispositivo: serializeDevice(device), credencial: token, credencial_expira_em: expiresAt };
    });
  }

  async heartbeat(deviceId, data) {
    const [device] = await this.dbProvider()('dispositivos_impressao').where({ id: deviceId, status: 'ATIVO' }).update({
      turno_ativo: data.turno_ativo, app_version: normalizeText(data.app_version), android_version: normalizeText(data.android_version),
      impressora_nome: normalizeText(data.impressora_nome) || null, impressora_endereco: normalizeText(data.impressora_endereco) || null,
      bobina_mm: data.bobina_mm, codificacao: data.codificacao, corte_automatico: data.corte_automatico,
      ultimo_status: data.status, ultimo_erro: normalizeText(data.erro) || null, ultimo_contato_em: new Date(), atualizado_em: new Date(),
    }).returning('*');
    if (!device) throw new AppError('Dispositivo nao encontrado ou revogado.', 404, 'PRINT_DEVICE_NOT_FOUND');
    return serializeDevice(device);
  }

  async rotateCredential(deviceId) {
    const token = randomToken(48);
    const expiresAt = new Date(Date.now() + env.PRINT_DEVICE_TOKEN_TTL_DAYS * 86_400_000);
    const [device] = await this.dbProvider()('dispositivos_impressao').where({ id: deviceId, status: 'ATIVO' }).update({ credencial_hash: sha256(token), credencial_expira_em: expiresAt, atualizado_em: new Date() }).returning('*');
    if (!device) throw new AppError('Dispositivo nao encontrado ou revogado.', 404, 'PRINT_DEVICE_NOT_FOUND');
    return { dispositivo: serializeDevice(device), credencial: token, credencial_expira_em: expiresAt };
  }

  async unlink(deviceId, context) {
    const db = this.dbProvider();
    return db.transaction(async (trx) => {
      const [device] = await trx('dispositivos_impressao').where({ id: deviceId, status: 'ATIVO' }).update({
        status: 'REVOGADO', turno_ativo: false, ultimo_status: 'DESCONECTADO', revogado_em: trx.fn.now(), atualizado_em: trx.fn.now(),
      }).returning('*');
      if (!device) throw new AppError('Dispositivo ativo nao encontrado.', 404, 'PRINT_DEVICE_NOT_FOUND');
      await auditService.registrar({ trx, tipo: 'SEGURANCA', acao: 'IMPRESSAO.DISPOSITIVO.AUTO_REVOGAR', descricao: 'Dispositivo revogou a propria credencial', recursoTipo: 'dispositivo_impressao', recursoId: device.id, metodo: context.method, endpoint: context.endpoint, requestId: context.requestId, payload: { auto_revogacao: true } });
      return serializeDevice(device);
    });
  }

  async adminStatus() {
    const db = this.dbProvider();
    const [config, devices, counts] = await Promise.all([
      db('configuracoes_loja').first('metodo_impressao', 'imprimir_automaticamente', 'imprimir_pedidos_painel'),
      db('dispositivos_impressao').orderBy('criado_em', 'desc'),
      db('impressoes').select('status').count('* as total').groupBy('status'),
    ]);
    return { configuracao: config, dispositivos: devices.map(serializeDevice), fila: Object.fromEntries(counts.map((item) => [item.status, Number(item.total)])) };
  }

  async revoke(deviceId, context) {
    const db = this.dbProvider();
    const [device] = await db('dispositivos_impressao').where({ id: deviceId, status: 'ATIVO' }).update({ status: 'REVOGADO', turno_ativo: false, revogado_em: db.fn.now(), atualizado_em: db.fn.now() }).returning('*');
    if (!device) throw new AppError('Dispositivo ativo nao encontrado.', 404, 'PRINT_DEVICE_NOT_FOUND');
    await auditService.registrar({ usuarioId: context.user.id, acao: 'IMPRESSAO.DISPOSITIVO.REVOGAR', descricao: 'Credencial de dispositivo revogada', recursoTipo: 'dispositivo_impressao', recursoId: device.id, metodo: context.method, endpoint: context.endpoint, requestId: context.requestId, payload: { dispositivo: device.nome } });
    return serializeDevice(device);
  }

  async createTest(context) {
    const db = this.dbProvider();
    const now = new Date();
    const [job] = await db('impressoes').insert({
      pedido_id: null, tipo: 'TESTE', origem: 'MANUAL', destino: 'ANDROID_BLUETOOTH', status: 'PENDENTE',
      dedup_key: `teste:${context.user.id}:${now.getTime()}:${randomToken(8)}`, disponivel_em: now,
      payload_snapshot: { teste: true, criado_em: now.toISOString(), solicitado_por: context.user.nome ?? 'Painel administrativo' },
      solicitado_por_usuario_id: context.user.id,
    }).returning('*');
    domainEvents.emit('impressao_disponivel', { job_id: job.id });
    return job;
  }

  async expireLeases(db) {
    const candidates = await db('impressoes').where({ destino: 'ANDROID_BLUETOOTH', status: 'EM_PROCESSAMENTO' })
      .where('lease_ate', '<=', db.fn.now()).orderBy('pedido_id').orderBy('id').limit(100);
    for (const candidate of candidates) {
      await db.transaction(async (trx) => {
        const current = await lockPrintOrder(trx, candidate, { skipLocked: true, requireRelease: false });
        if (current === undefined) return;
        const job = await trx('impressoes').where({ id: candidate.id, destino: 'ANDROID_BLUETOOTH', status: 'EM_PROCESSAMENTO' })
          .where('lease_ate', '<=', trx.fn.now()).forUpdate().skipLocked().first();
        if (!job) return;
        if (String(job.pedido_id) !== String(candidate.pedido_id) || job.tipo !== candidate.tipo) throw new AppError('Vinculo do trabalho alterado.', 409, 'INVALID_PRINT_ORDER');
        const eligible = current === null || (current.status !== 'CANCELADO' && isOperationallyReleased(current));
        const status = job.envio_iniciado_em ? 'RESULTADO_INDETERMINADO' : !eligible || job.tentativas >= env.PRINT_MAX_ATTEMPTS ? 'FALHOU' : 'PENDENTE';
        await trx('impressoes').where({ id: job.id }).update({
          status, resultado: job.envio_iniciado_em ? 'RESULTADO_INDETERMINADO' : status === 'FALHOU' ? 'FALHA_ANTES_ENVIO' : null,
          lease_ate: null, lease_token_hash: null, dispositivo_id: status === 'PENDENTE' ? null : job.dispositivo_id,
          disponivel_em: status === 'PENDENTE' ? trx.fn.now() : job.disponivel_em,
          ultimo_erro: job.envio_iniciado_em ? 'Lease expirou depois do inicio do envio; reimpressao automatica bloqueada'
            : !eligible ? 'Pedido sem liberacao operacional; repeticao bloqueada' : status === 'FALHOU' ? 'Limite de tentativas atingido antes do envio' : null,
          atualizado_em: trx.fn.now(),
        });
      });
    }
  }

  async reserve(device) {
    if (!device.turno_ativo) throw new AppError('Inicie o turno de impressao antes de reservar trabalhos.', 409, 'PRINT_SHIFT_INACTIVE');
    const db = this.dbProvider();
    await this.expireLeases(db);
    return db.transaction(async (trx) => {
      const candidate = await filterOperationalPrintJobs(trx('impressoes').where({ destino: 'ANDROID_BLUETOOTH', status: 'PENDENTE' }), trx)
        .where('disponivel_em', '<=', trx.fn.now()).orderBy('criado_em').first();
      if (!candidate) return null;
      let current;
      try { current = await lockPrintOrder(trx, candidate, { skipLocked: true }); }
      catch (error) { if (error.code === 'ORDER_PAYMENT_PENDING') return null; throw error; }
      if (current === undefined) return null;
      const job = await trx('impressoes').where({ id: candidate.id, destino: 'ANDROID_BLUETOOTH', status: 'PENDENTE' }).forUpdate().skipLocked().first();
      if (!job) return null;
      if (String(job.pedido_id) !== String(candidate.pedido_id) || job.tipo !== candidate.tipo) throw new AppError('Vinculo do trabalho alterado.', 409, 'INVALID_PRINT_ORDER');
      const leaseToken = randomToken(32);
      const leaseUntil = new Date(Date.now() + env.PRINT_LEASE_SECONDS * 1000);
      const [reserved] = await trx('impressoes').where({ id: job.id }).update({
        status: 'EM_PROCESSAMENTO', tentativas: job.tentativas + 1, dispositivo_id: device.id,
        lease_ate: leaseUntil, lease_token_hash: sha256(leaseToken), envio_iniciado_em: null, resultado: null, atualizado_em: trx.fn.now(),
      }).returning('*');
      const snapshot = reserved.payload_snapshot;
      const text = reserved.tipo === 'TESTE'
        ? formatPrintTest(snapshot)
        : formatTextReceipt(snapshot, { columns: device.bobina_mm === 80 ? 48 : 32, secondCopy: reserved.tipo === 'REIMPRESSAO' });
      return {
        id: reserved.id, pedido_id: reserved.pedido_id, tipo: reserved.tipo, tentativa: reserved.tentativas,
        lease_token: leaseToken, lease_ate: leaseUntil, conteudo_texto: text, payload_snapshot: sanitizeAuditPayload(snapshot),
        impressora: { endereco: device.impressora_endereco, nome: device.impressora_nome, bobina_mm: device.bobina_mm, codificacao: device.codificacao, corte_automatico: device.corte_automatico },
      };
    });
  }

  async startSending(deviceId, jobId, leaseToken) {
    const db = this.dbProvider();
    return db.transaction(async (trx) => {
      const candidate = await trx('impressoes').where({ id: jobId, destino: 'ANDROID_BLUETOOTH' }).first();
      if (!candidate) throw new AppError('Impressao nao encontrada.', 404, 'PRINT_NOT_FOUND');
      await lockPrintOrder(trx, candidate);
      const job = await trx('impressoes').where({ id: jobId, destino: 'ANDROID_BLUETOOTH' }).forUpdate().first();
      if (!job) throw new AppError('Impressao nao encontrada.', 404, 'PRINT_NOT_FOUND');
      if (String(job.pedido_id) !== String(candidate.pedido_id) || job.tipo !== candidate.tipo) throw new AppError('Vinculo do trabalho alterado.', 409, 'INVALID_PRINT_ORDER');
      assertLease(job, deviceId, leaseToken);
      if (job.envio_iniciado_em) return { envio_iniciado_em: job.envio_iniciado_em };
      const [updated] = await trx('impressoes').where({ id: jobId }).update({ envio_iniciado_em: trx.fn.now(), atualizado_em: trx.fn.now() }).returning('*');
      return { envio_iniciado_em: updated.envio_iniciado_em };
    });
  }

  async jobState(jobId) {
    const job = await this.dbProvider()('impressoes').where({ id: jobId, destino: 'ANDROID_BLUETOOTH' })
      .select('id', 'status', 'resultado', 'tentativas', 'envio_iniciado_em', 'enviado_em', 'concluido_em', 'lease_ate', 'atualizado_em').first();
    if (!job) throw new AppError('Impressao nao encontrada.', 404, 'PRINT_NOT_FOUND');
    return serializeJobState(effectiveJobState(job));
  }

  async reportResult(deviceId, jobId, data) {
    const db = this.dbProvider();
    return db.transaction(async (trx) => {
      const candidate = await trx('impressoes').where({ id: jobId, destino: 'ANDROID_BLUETOOTH' }).first();
      if (!candidate) throw new AppError('Impressao nao encontrada.', 404, 'PRINT_NOT_FOUND');
      const current = await lockPrintOrder(trx, candidate, { requireRelease: false });
      const job = await trx('impressoes').where({ id: jobId, destino: 'ANDROID_BLUETOOTH' }).forUpdate().first();
      if (!job) throw new AppError('Impressao nao encontrada.', 404, 'PRINT_NOT_FOUND');
      if (String(job.pedido_id) !== String(candidate.pedido_id) || job.tipo !== candidate.tipo) throw new AppError('Vinculo do trabalho alterado.', 409, 'INVALID_PRINT_ORDER');
      if (isMatchingReportedOutcome(job, data.resultado)) return serializeJobState(job);
      assertLease(job, deviceId, data.lease_token);
      if (data.resultado === 'ENVIADO' && !job.envio_iniciado_em) throw new AppError('Registre o inicio do envio antes de confirmar ENVIADO.', 409, 'PRINT_SEND_NOT_STARTED');
      const { result, status: suggestedStatus, retryDelaySeconds } = resolvePrintOutcome(job, data.resultado);
      const eligible = current === null || (current.status !== 'CANCELADO' && isOperationallyReleased(current));
      const status = suggestedStatus === 'PENDENTE' && !eligible ? 'FALHOU' : suggestedStatus;
      const [updated] = await trx('impressoes').where({ id: jobId }).update({
        status, resultado: result, lease_ate: null, lease_token_hash: null,
        dispositivo_id: status === 'PENDENTE' ? null : deviceId,
        disponivel_em: status === 'PENDENTE' ? new Date(Date.now() + retryDelaySeconds * 1000) : job.disponivel_em,
        ultimo_erro: result === 'ENVIADO' ? null : normalizeText(data.erro) || (result === 'RESULTADO_INDETERMINADO' ? 'Resultado indeterminado apos inicio do envio' : 'Falha antes do envio'),
        enviado_em: result === 'ENVIADO' ? trx.fn.now() : null,
        concluido_em: result === 'ENVIADO' ? trx.fn.now() : null,
        atualizado_em: trx.fn.now(),
      }).returning('*');
      if (status === 'PENDENTE') domainEvents.emit('impressao_disponivel', { job_id: jobId, disponivel_em: updated.disponivel_em });
      return serializeJobState(updated);
    });
  }
}

export const androidPrintingService = new AndroidPrintingService();
