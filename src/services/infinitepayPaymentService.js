import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { InfinitepayRepository } from '../repositories/infinitepayRepository.js';
import { InfinitepayClient, providerUrl } from '../payments/infinitepayClient.js';
import { decryptApiKey, encryptionKey } from '../payments/infinitepayCredentials.js';
import { validatePaymentCheck } from '../payments/orderPaymentPolicy.js';
import { infinitepayConfigService, validateCallbackUrls } from './infinitepayConfigService.js';
import { orderReleaseService } from './orderReleaseService.js';
import { auditService } from './auditService.js';
import { decimalToCents, addCents, multiplyCents } from '../utils/money.js';
import { stableHash } from '../utils/crypto.js';
import { AppError } from '../utils/AppError.js';

function checkoutPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const national = digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits;
  if (!/^[1-9]\d{9,10}$/.test(national)) throw new AppError('Telefone brasileiro com DDD obrigatorio.', 422, 'INVALID_PHONE');
  return `+55${national}`;
}

function checkoutItems(order, priced) {
  const products = priced.items.map((item) => ({
    quantity: item.quantidade,
    price: decimalToCents(item.preco_unitario),
    description: [item.produto_nome_snapshot, ...(item.adicionais ?? []).map((extra) => `Adicional: ${extra.quantidade_por_unidade}x ${extra.nome_snapshot}`), item.observacoes].filter(Boolean).join(' - '),
  }));
  let subtotal = addCents(...products.map((item) => multiplyCents(item.price, item.quantity)));
  let discount = decimalToCents(order.desconto) ?? 0;
  const delivery = decimalToCents(order.taxa_entrega) ?? 0;
  if (discount > subtotal || addCents(subtotal, delivery) - discount !== decimalToCents(order.total)) throw new AppError('Total do checkout divergente.', 422, 'INFINITEPAY_TOTAL_MISMATCH');
  const items = products.flatMap((item) => {
    const gross = multiplyCents(item.price, item.quantity);
    const deducted = subtotal ? Number(BigInt(discount) * BigInt(gross) / BigInt(subtotal)) : 0;
    subtotal -= gross;
    discount -= deducted;
    if (!deducted) return [item];
    const net = gross - deducted;
    const price = Math.floor(net / item.quantity);
    const remainder = net % item.quantity;
    // Split equal products only when the discount cannot divide evenly into unit cents.
    return [{ ...item, price, quantity: item.quantity - remainder }, ...(remainder ? [{ ...item, price: price + 1, quantity: remainder }] : [])];
  });
  if (delivery) items.push({ quantity: 1, price: delivery, description: 'Taxa de entrega' });
  if (addCents(...items.map((item) => multiplyCents(item.price, item.quantity))) !== decimalToCents(order.total)) throw new AppError('Total do checkout divergente.', 422, 'INFINITEPAY_TOTAL_MISMATCH');
  return items;
}

export class InfinitepayPaymentService {
  constructor({ repo = new InfinitepayRepository(), client = new InfinitepayClient(), key = () => env.INFINITEPAY_ENCRYPTION_KEY, release = (...args) => orderReleaseService.release(...args), audit = auditService } = {}) {
    this.repo = repo; this.client = client; this.key = key; this.release = release; this.audit = audit;
  }
  configuration(trx) { return infinitepayConfigService.forCheckout(trx); }

  async prepare(trx, order, priced, config, methods, email) {
    encryptionKey(this.key());
    validateCallbackUrls(config, env.allowedOrigins);
    if (!config.credencial_id || !config.handle) throw new AppError('InfinitePay sem credencial.', 503, 'INFINITEPAY_CREDENTIAL_REQUIRED');
    const total = decimalToCents(order.total);
    if (total < 100) throw new AppError('Checkout online exige pelo menos R$ 1,00.', 422, 'INFINITEPAY_MINIMUM_AMOUNT');
    const id = randomUUID();
    const nsu = `crepe-mania-${id}`;
    const expires = new Date(Date.now() + 24 * 60 * 60000);
    const items = checkoutItems(order, priced);
    const customer = { name: order.cliente_nome, phone_number: checkoutPhone(order.cliente_telefone), ...(email ? { email } : {}) };
    const redirect = new URL(config.redirect_url);
    redirect.searchParams.set('codigo', order.codigo_acompanhamento);
    const payload = { handle: config.handle, order_nsu: nsu, items, customer, redirect_url: redirect.href, webhook: { url: new URL('/api/v1/pagamentos/webhook/infinitepay', config.backend_public_url).href, events: ['paid', 'refunded', 'canceled'] }, options: { single_payment: true, valid_until: expires.toISOString(), payment_methods_enabled: methods, assured_installments: config.assured_installments ?? 0 } };
    return this.repo.insertAttempt({ id, pedido_id: order.id, order_nsu: nsu, estado: 'AGUARDANDO_CRIACAO', valor_centavos: total, metodos_permitidos: JSON.stringify(methods), payload_json: payload, payload_hash: stableHash(payload), credencial_id: config.credencial_id, handle_snapshot: config.handle, valid_until: expires }, trx);
  }

  async credential(attempt) {
    const credential = await this.repo.credential(attempt.credencial_id);
    if (!credential || credential.handle !== attempt.handle_snapshot) throw new AppError('Conta da tentativa divergente.', 503, 'INFINITEPAY_CREDENTIAL_UNAVAILABLE');
    return decryptApiKey(credential.api_key_ciphertext, this.key(), attempt.handle_snapshot);
  }

  async checkout(id) {
    const attempt = await this.repo.claimCheckout(id);
    if (!attempt) return;
    try {
      if (new Date(attempt.valid_until) <= new Date()) { await this.repo.updateAttempt(id, { estado: 'EXPIRADO' }); return; }
      const apiKey = await this.credential(attempt);
      const { url } = await this.client.createLink(apiKey, attempt.payload_json);
      // A successful response can arrive after a webhook already verified the payment.
      await this.repo.database.transaction(async (trx) => {
        await this.repo.order(attempt.pedido_id, trx, true);
        const current = await this.repo.attempt(id, trx, true);
        await this.repo.updateAttempt(id, { checkout_url: url, ...(current.estado === 'CRIANDO' ? { estado: 'AGUARDANDO_PAGAMENTO' } : {}) }, trx);
      });
    } catch {
      // Never retry /links: a transport error cannot prove the provider did not create it.
      await this.repo.database.transaction(async (trx) => {
        await this.repo.order(attempt.pedido_id, trx, true);
        const current = await this.repo.attempt(id, trx, true);
        if (current.estado === 'CRIANDO') await this.repo.updateAttempt(id, { estado: 'CRIACAO_INCERTA', ultimo_erro: 'CHECKOUT_UNCERTAIN' }, trx);
      });
    }
  }

  async view(order) {
    if (order.fluxo_pagamento !== 'INFINITEPAY') return { fluxo: 'TRADICIONAL', liberado_operacionalmente: true };
    const attempt = await this.repo.attemptForOrder(order.id);
    if (!attempt) throw new AppError('Tentativa de pagamento indisponivel.', 503, 'INFINITEPAY_ATTEMPT_MISSING');
    const transaction = await this.repo.transactionForAttempt(attempt.id);
    const usable = ['AGUARDANDO_PAGAMENTO'].includes(attempt.estado) && new Date(attempt.valid_until) > new Date() && order.status !== 'CANCELADO';
    return { fluxo: 'INFINITEPAY', tentativa_id: attempt.id, order_nsu: attempt.order_nsu, estado: attempt.estado, checkout_url: usable ? providerUrl(attempt.checkout_url) : null, valid_until: attempt.valid_until, liberado_operacionalmente: Boolean(order.confirmacao_liberacao_id && order.liberado_operacionalmente_em && order.status !== 'CANCELADO'), comprovante: transaction ? { transaction_nsu: transaction.transaction_nsu, amount: transaction.amount, paid_amount: transaction.paid_amount, capture_method: transaction.capture_method, installments: transaction.installments, verificado_em: transaction.provider_verified_at, receipt_url: providerUrl(transaction.receipt_url, 'receipt') } : null };
  }

  async forCode(code) {
    const order = await this.repo.orderByCode(code);
    if (!order) throw new AppError('Pedido nao encontrado.', 404, 'ORDER_NOT_FOUND');
    return { order, pagamento: await this.view(order) };
  }

  async checkoutForOrder(id) {
    const attempt = await this.repo.attemptForOrder(id);
    if (attempt) await this.checkout(attempt.id);
    return this.view(await this.repo.order(id));
  }

  async verifyAttempt(id, hints) {
    const attempt = await this.repo.attempt(id);
    if (!attempt || hints.order_nsu !== attempt.order_nsu) throw new AppError('Tentativa nao encontrada.', 404, 'INFINITEPAY_ATTEMPT_NOT_FOUND');
    const apiKey = await this.credential(attempt);
    const consultation = { handle: attempt.handle_snapshot, order_nsu: attempt.order_nsu, transaction_nsu: hints.transaction_nsu, slug: hints.slug };
    const official = await this.client.checkPayment(apiKey, consultation);
    const checked = validatePaymentCheck(official, attempt, hints);
    return this.repo.database.transaction(async (trx) => {
      const order = await this.repo.order(attempt.pedido_id, trx, true);
      const current = await this.repo.attempt(id, trx, true);
      const existing = await this.repo.transactionByNsu(hints.transaction_nsu, trx);
      if (existing) {
        if (existing.tentativa_id !== id) throw new AppError('Transacao vinculada a outro pedido.', 409, 'INFINITEPAY_TRANSACTION_CONFLICT');
        return { verificado: true, classificacao: existing.classificacao };
      }
      const eligible = checked.elegivel && decimalToCents(order.total) === Number(current.valor_centavos) && order.status !== 'CANCELADO' && !order.confirmacao_liberacao_id;
      const classification = order.confirmacao_liberacao_id ? 'DUPLICADO' : order.status === 'CANCELADO' ? 'CANCELADO' : eligible ? 'ELEGIVEL' : 'DIVERGENTE';
      const now = new Date();
      const evidence = { amount: checked.amount, paid_amount: checked.paid_amount, capture_method: checked.capture_method, installments: checked.installments };
      const transaction = await this.repo.insertTransaction({ id: randomUUID(), pedido_id: order.id, tentativa_id: id, transaction_nsu: hints.transaction_nsu, invoice_slug: hints.slug, amount: checked.amount, paid_amount: checked.paid_amount, capture_method: checked.capture_method, installments: checked.installments, receipt_url: providerUrl(official.receipt_url, 'receipt'), classificacao: classification, provider_verified_at: now, evidence_json: { success: true, paid: true, ...evidence } }, trx);
      if (!transaction) {
        const winner = await this.repo.transactionByNsu(hints.transaction_nsu, trx);
        if (winner?.tentativa_id !== id) throw new AppError('Transacao vinculada a outro pedido.', 409, 'INFINITEPAY_TRANSACTION_CONFLICT');
        return { verificado: true, classificacao: winner.classificacao };
      }
      const confirmation = await this.repo.insertConfirmation({ id: randomUUID(), transacao_id: transaction.id, pedido_id: order.id, tentativa_id: id, elegivel: eligible, verificado_em: now, consulta_json: consultation, evidencia_json: { success: true, paid: true, ...evidence }, hash_evidencia: stableHash({ consultation, evidence }) }, trx);
      if (eligible) await this.release(trx, order, confirmation.id);
      await this.repo.updateAttempt(id, { estado: eligible || order.confirmacao_liberacao_id ? 'PAGO_VERIFICADO' : 'PAGO_EM_REVISAO', ultimo_erro: eligible ? null : classification }, trx);
      await this.audit.registrar({ trx, acao: 'INFINITEPAY.CONFIRMAR', descricao: 'Consulta oficial de pagamento registrada', recursoTipo: 'pedido', recursoId: order.id, payload: { tentativa_id: id, transacao_id: transaction.id, classificacao: classification } });
      return { verificado: true, classificacao: classification };
    });
  }

  async ingest(hints, origin, expectedOrderId) {
    const attempt = await this.repo.attemptByNsu(hints.order_nsu);
    if (!attempt || (expectedOrderId && String(attempt.pedido_id) !== String(expectedOrderId))) throw new AppError('Tentativa nao encontrada.', 404, 'INFINITEPAY_ATTEMPT_NOT_FOUND');
    return this.repo.enqueueSignal({ id: randomUUID(), tentativa_id: attempt.id, transaction_nsu: hints.transaction_nsu, slug: hints.slug, receipt_url: providerUrl(hints.receipt_url, 'receipt'), origem: origin, event_type: hints.event_type ?? 'paid', dedup_key: stableHash({ attempt: attempt.id, transaction: hints.transaction_nsu, slug: hints.slug, event: hints.event_type ?? 'paid' }) });
  }

  async processInbox(id) {
    const row = await this.repo.claimQueue('infinitepay_inbox', id);
    if (!row) return false;
    try {
      if (row.event_type !== 'paid') {
        await this.repo.finishQueue('infinitepay_inbox', row, { revisao_manual: true, evento: row.event_type });
        return true;
      }
      const attempt = await this.repo.attempt(row.tentativa_id);
      const result = await this.verifyAttempt(attempt.id, { order_nsu: attempt.order_nsu, transaction_nsu: row.transaction_nsu, slug: row.slug });
      await this.repo.finishQueue('infinitepay_inbox', row, result);
    } catch (error) {
      await this.repo.failQueue('infinitepay_inbox', row, error.code ?? 'INFINITEPAY_PROCESSING_ERROR', ['INFINITEPAY_TRANSACTION_CONFLICT', 'INFINITEPAY_IDENTITY_MISMATCH'].includes(error.code));
    }
    return true;
  }
}

export const infinitepayPaymentService = new InfinitepayPaymentService();
