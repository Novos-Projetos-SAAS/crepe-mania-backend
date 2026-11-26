import { createSign } from 'node:crypto';
import { env } from '../config/env.js';
import { getDb } from '../database/connection.js';
import { OrderRepository } from '../repositories/orderRepository.js';
import { auditService } from './auditService.js';
import { AppError } from '../utils/AppError.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { sanitizeAuditPayload } from '../utils/sanitize.js';
import { formatHtmlReceipt, formatTextReceipt } from '../printing/receiptFormatter.js';
import { applyOperationalFilter, assertOperationalRelease } from '../payments/orderPaymentPolicy.js';

export function filterOperationalPrintJobs(query, trx) {
  return query.where((eligible) => eligible
    .where((test) => test.where({ tipo: 'TESTE' }).whereNull('pedido_id'))
    .orWhereExists(applyOperationalFilter(trx('pedidos').select(trx.raw('1')).whereRaw('pedidos.id = impressoes.pedido_id'))));
}

export async function lockPrintOrder(trx, job, { skipLocked = false, requireRelease = true } = {}) {
  if (job.tipo === 'TESTE' && job.pedido_id == null) return null;
  if (job.pedido_id == null) throw new AppError('Trabalho sem pedido vinculado.', 409, 'INVALID_PRINT_ORDER');
  const query = trx('pedidos').where({ id: job.pedido_id }).forUpdate();
  const order = await (skipLocked ? query.skipLocked() : query).first();
  if (!order) {
    if (skipLocked) return undefined;
    throw new AppError('Pedido nao encontrado.', 404, 'ORDER_NOT_FOUND');
  }
  if (requireRelease) assertOperationalRelease(order);
  return order;
}

export function formatPrintTest(snapshot) {
  return `CREPE MANIA\nTESTE DE IMPRESSAO\n${new Date(snapshot.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\nABCDEFGHIJKLMNOPQRSTUVWXYZ\n0123456789\n\n`;
}

const QZ_SAFE_DEFAULT_OPTIONS = Object.freeze({
  bounds: null, colorType: 'color', copies: 1, density: 0, duplex: false, fallbackDensity: null,
  interpolation: 'bicubic', jobName: null, legacy: false, margins: 0, orientation: null,
  paperThickness: null, printerTray: null, rasterize: false, rotation: 0, scaleContent: true,
  size: null, units: 'in', forceRaw: false, encoding: null, spool: null,
});

function validateQzRequest(request, text) {
  const invalid = () => { throw new AppError('Solicitacao QZ deve imprimir somente o texto do trabalho vinculado.', 422, 'INVALID_QZ_REQUEST'); };
  const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
  let value;
  try { value = JSON.parse(request); } catch { invalid(); }
  if (!exactKeys(value, ['call', 'params', 'timestamp']) || value.call !== 'print'
    || !Number.isSafeInteger(value.timestamp) || Math.abs(Date.now() - value.timestamp) > 300000
    || !exactKeys(value.params, ['printer', 'options', 'data'])
    || !exactKeys(value.params.printer, ['name']) || typeof value.params.printer.name !== 'string'
    // eslint-disable-next-line no-control-regex
    || !value.params.printer.name.trim() || value.params.printer.name.length > 200 || /[\u0000-\u001f\u007f]/.test(value.params.printer.name)
    || !value.params.options || typeof value.params.options !== 'object' || Array.isArray(value.params.options)
    || !Object.entries(value.params.options).every(([key, option]) => Object.hasOwn(QZ_SAFE_DEFAULT_OPTIONS, key) && QZ_SAFE_DEFAULT_OPTIONS[key] === option)
    || !Array.isArray(value.params.data) || value.params.data.length !== 1) invalid();
  const data = value.params.data[0];
  if (typeof data === 'string') { if (data !== text) invalid(); }
  else if (!exactKeys(data, ['type', 'format', 'flavor', 'data']) || data.type !== 'raw' || data.format !== 'command' || data.flavor !== 'plain' || data.data !== text) invalid();
  return JSON.stringify({ call: value.call, params: value.params, timestamp: value.timestamp });
}

function serializePrintJob(job) {
  if (!job) return job;
  const safe = { ...job };
  delete safe.lease_token_hash;
  return safe;
}

export class PrintingService {
  constructor(dbProvider = getDb, orders = new OrderRepository()) { this.dbProvider = dbProvider; this.orders = orders; }

  async receipt(orderId, format) {
    const order = await this.orders.detail(orderId);
    if (!order) throw new AppError('Pedido nao encontrado.', 404, 'ORDER_NOT_FOUND');
    assertOperationalRelease(order);
    if (format === 'html') return { contentType: 'text/html; charset=utf-8', content: formatHtmlReceipt(order) };
    if (format !== 'texto') throw new AppError('Formato deve ser texto ou html.', 422, 'INVALID_RECEIPT_FORMAT');
    return { contentType: 'text/plain; charset=utf-8', content: formatTextReceipt(order) };
  }

  async request(orderId, context) {
    const db = this.dbProvider();
    return db.transaction(async (trx) => {
      const order = await this.orders.detail(orderId, trx, true);
      if (!order) throw new AppError('Pedido nao encontrado.', 404, 'ORDER_NOT_FOUND');
      assertOperationalRelease(order);
      const config = await trx('configuracoes_loja').first('metodo_impressao');
      const destination = config?.metodo_impressao === 'ANDROID_BLUETOOTH' ? 'ANDROID_BLUETOOTH' : 'AGENTE_LEGADO';
      const [job] = await trx('impressoes').insert({ pedido_id: orderId, tipo: 'REIMPRESSAO', origem: 'MANUAL', destino: destination, status: 'PENDENTE', dedup_key: `reimpressao:${orderId}:${Date.now()}:${randomToken(8)}`, disponivel_em: trx.fn.now(), payload_snapshot: { ...sanitizeAuditPayload(order), segunda_via: true }, solicitado_por_usuario_id: context.user.id }).returning('*');
      await auditService.registrar({ trx, usuarioId: context.user.id, acao: 'IMPRESSAO.SOLICITAR', descricao: 'Impressao manual solicitada', recursoTipo: 'impressao', recursoId: job.id, ...context, payload: { pedido_id: orderId } });
      return { ...serializePrintJob(job), agente_configurado: destination === 'ANDROID_BLUETOOTH' || Boolean(env.PRINT_AGENT_TOKEN), aviso: destination === 'AGENTE_LEGADO' && !env.PRINT_AGENT_TOKEN ? 'sem agente configurado' : null };
    });
  }

  async list({ page = 1, limit = 10, status }) {
    const db = this.dbProvider(); const query = db('impressoes'); if (status) query.where({ status });
    const [{ total }] = await query.clone().count('* as total');
    const items = (await query.select('*').orderBy([{ column: 'criado_em', order: 'desc' }, { column: 'id', order: 'desc' }]).limit(limit).offset((page - 1) * limit)).map(serializePrintJob);
    return { items, total: Number(total), agente_configurado: Boolean(env.PRINT_AGENT_TOKEN) };
  }

  async detail(id) { const job = await this.dbProvider()('impressoes').where({ id }).first(); if (!job) throw new AppError('Impressao nao encontrada.', 404, 'PRINT_NOT_FOUND'); return { ...serializePrintJob(job), agente_configurado: Boolean(env.PRINT_AGENT_TOKEN) }; }

  async next() {
    const db = this.dbProvider();
    await db('impressoes').where({ destino: 'AGENTE_LEGADO', status: 'EM_PROCESSAMENTO' }).where('lease_ate', '<=', db.fn.now())
      .update({ status: 'RESULTADO_INDETERMINADO', resultado: 'RESULTADO_INDETERMINADO', lease_ate: null, lease_token_hash: null, ultimo_erro: 'Lease legada expirou apos entrega; repeticao automatica bloqueada', atualizado_em: db.fn.now() });
    return db.transaction(async (trx) => {
      const candidate = await filterOperationalPrintJobs(trx('impressoes').where({ destino: 'AGENTE_LEGADO', status: 'PENDENTE' }), trx)
        .where('disponivel_em', '<=', trx.fn.now()).where('tentativas', '<', env.PRINT_MAX_ATTEMPTS).orderBy('criado_em').first();
      if (!candidate) return null;
      let current;
      try { current = await lockPrintOrder(trx, candidate, { skipLocked: true }); }
      catch (error) { if (error.code === 'ORDER_PAYMENT_PENDING') return null; throw error; }
      if (current === undefined) return null;
      const job = await trx('impressoes').where({ id: candidate.id, destino: 'AGENTE_LEGADO', status: 'PENDENTE' }).forUpdate().skipLocked().first();
      if (!job) return null;
      if (String(job.pedido_id) !== String(candidate.pedido_id) || job.tipo !== candidate.tipo) throw new AppError('Vinculo do trabalho alterado.', 409, 'INVALID_PRINT_ORDER');
      const leaseToken = randomToken(32);
      const leaseUntil = new Date(Date.now() + env.PRINT_LEASE_SECONDS * 1000);
      const [reserved] = await trx('impressoes').where({ id: job.id }).update({ status: 'EM_PROCESSAMENTO', tentativas: job.tentativas + 1, lease_ate: leaseUntil, lease_token_hash: sha256(leaseToken), atualizado_em: trx.fn.now() }).returning('*');
      const order = job.payload_snapshot?.itens ? job.payload_snapshot : job.tipo === 'TESTE' ? job.payload_snapshot : await this.orders.detail(job.pedido_id, trx);
      return { id: reserved.id, pedido_id: reserved.pedido_id, tentativa: reserved.tentativas, lease_token: leaseToken, lease_ate: leaseUntil, formato: 'texto', conteudo: job.tipo === 'TESTE' ? formatPrintTest(order) : formatTextReceipt(order) };
    });
  }

  async ack(id, data) {
    const db = this.dbProvider();
    return db.transaction(async (trx) => {
      const job = await trx('impressoes').where({ id, destino: 'AGENTE_LEGADO' }).forUpdate().first();
      if (!job) throw new AppError('Impressao nao encontrada.', 404, 'PRINT_NOT_FOUND');
      if (job.status !== 'EM_PROCESSAMENTO' || !job.lease_token_hash || job.lease_token_hash !== sha256(data.lease_token) || new Date(job.lease_ate) < new Date()) throw new AppError('Lease invalida ou expirada.', 409, 'INVALID_PRINT_LEASE');
      const status = data.sucesso ? 'CONCLUIDA' : 'RESULTADO_INDETERMINADO';
      const [updated] = await trx('impressoes').where({ id }).update({ status, resultado: data.sucesso ? 'ENVIADO' : 'RESULTADO_INDETERMINADO', lease_ate: null, lease_token_hash: null, ultimo_erro: data.sucesso ? null : data.erro ?? 'Falha legada apos entrega; repeticao automatica bloqueada', concluido_em: data.sucesso ? trx.fn.now() : null, atualizado_em: trx.fn.now() }).returning('*');
      return serializePrintJob(updated);
    });
  }

  qzConfiguration() { return { habilitado: env.QZ_ENABLED && Boolean(env.QZ_PRIVATE_KEY && env.QZ_CERTIFICATE), certificado_disponivel: Boolean(env.QZ_CERTIFICATE) }; }
  qzCertificate() { if (!env.QZ_ENABLED || !env.QZ_CERTIFICATE) throw new AppError('QZ Tray nao configurado.', 503, 'QZ_DISABLED'); return env.QZ_CERTIFICATE; }
  qzSign(data) {
    if (!env.QZ_ENABLED || !env.QZ_PRIVATE_KEY || !env.QZ_CERTIFICATE) throw new AppError('Assinatura QZ nao configurada.', 503, 'QZ_DISABLED');
    return this.dbProvider().transaction(async (trx) => {
      const candidate = await trx('impressoes').where({ id: data.job_id }).first();
      if (!candidate) throw new AppError('Impressao nao encontrada.', 404, 'PRINT_NOT_FOUND');
      const current = await lockPrintOrder(trx, candidate);
      const job = await trx('impressoes').where({ id: candidate.id, status: 'PENDENTE' }).forUpdate().first();
      if (!job || String(job.pedido_id) !== String(candidate.pedido_id) || job.tipo !== candidate.tipo
        || (job.tipo !== 'TESTE' && job.destino !== 'AGENTE_LEGADO')) throw new AppError('Trabalho indisponivel para QZ.', 409, 'INVALID_PRINT_JOB');
      const snapshot = job.payload_snapshot?.itens ? job.payload_snapshot : current;
      const text = job.tipo === 'TESTE' ? formatPrintTest(job.payload_snapshot) : formatTextReceipt(snapshot);
      const request = validateQzRequest(data.request, text);
      const signer = createSign('RSA-SHA512'); signer.update(sha256(request)); signer.end();
      const signature = signer.sign(env.QZ_PRIVATE_KEY, 'base64');
      await trx('impressoes').where({ id: job.id }).update({ status: 'RESULTADO_INDETERMINADO', resultado: 'RESULTADO_INDETERMINADO', envio_iniciado_em: trx.fn.now(), lease_ate: null, lease_token_hash: null, ultimo_erro: 'Assinatura QZ emitida; confirmacao fisica indisponivel', atualizado_em: trx.fn.now() });
      return signature;
    });
  }
}

export const printingService = new PrintingService();
