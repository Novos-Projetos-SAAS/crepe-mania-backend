import { DateTime } from 'luxon';
import { CatalogRepository } from '../repositories/catalogRepository.js';
import { OrderRepository } from '../repositories/orderRepository.js';
import { StoreRepository } from '../repositories/storeRepository.js';
import { auditService } from './auditService.js';
import { infinitepayPaymentService } from './infinitepayPaymentService.js';
import { orderReleaseService } from './orderReleaseService.js';
import { domainOutboxService } from './domainOutboxService.js';
import { assertOperationalRelease, assertTraditionalPayment, deriveOnlinePolicy, isOperationallyReleased } from '../payments/orderPaymentPolicy.js';
import { storeService } from './storeService.js';
import { priceOrder, normalizePhone } from './orderPricingService.js';
import { AppError } from '../utils/AppError.js';
import { stableHash, trackingCode } from '../utils/crypto.js';
import { normalizeText } from '../utils/sanitize.js';
import { ORDER_TRANSITIONS } from '../config/constants.js';
import { domainEvents } from '../realtime/domainEvents.js';

const contextForAudit = (context) => ({ metodo: context.method, endpoint: context.endpoint, requestId: context.requestId });

export function assertOrderTransition(deliveryType, currentStatus, nextStatus, reason, allowCancellation = false) {
  if (nextStatus === 'CANCELADO') {
    if (!allowCancellation || ['ENTREGUE', 'CANCELADO'].includes(currentStatus)) throw new AppError(`Transicao ${currentStatus} -> ${nextStatus} invalida.`, 409, 'INVALID_STATUS_TRANSITION');
    if (!reason) throw new AppError('Motivo obrigatorio para cancelamento.', 422, 'CANCEL_REASON_REQUIRED');
    return;
  }
  const allowed = ORDER_TRANSITIONS[deliveryType]?.[currentStatus] ?? [];
  if (!allowed.includes(nextStatus)) throw new AppError(`Transicao ${currentStatus} -> ${nextStatus} invalida.`, 409, 'INVALID_STATUS_TRANSITION');
}

export function assertPaymentTransition(orderStatus, currentStatus, nextStatus, reason) {
  const transitions = { PENDENTE: ['PAGO'], PAGO: ['ESTORNADO'], ESTORNADO: [] };
  if (!transitions[currentStatus]?.includes(nextStatus)) {
    throw new AppError(`Transicao de pagamento ${currentStatus} -> ${nextStatus} invalida.`, 409, 'INVALID_PAYMENT_TRANSITION');
  }
  if (orderStatus === 'CANCELADO' && nextStatus === 'PAGO') {
    throw new AppError('Pedido cancelado nao pode ser marcado como pago.', 409, 'INVALID_PAYMENT_STATUS');
  }
  if (nextStatus === 'ESTORNADO' && !reason?.trim()) {
    throw new AppError('Motivo obrigatorio para estorno.', 422, 'REFUND_REASON_REQUIRED');
  }
}

export function resolveIdempotency(record, payloadHash) {
  if (record.payload_hash !== payloadHash) throw new AppError('A chave de idempotencia ja foi usada com outro corpo.', 409, 'IDEMPOTENCY_CONFLICT');
  return record.estado === 'CONCLUIDO' ? { ...record.resultado_json, idempotent_replay: true } : null;
}

export function assertStoreAccepting(operational, channel) {
  if (channel === 'WEB' && !operational.aberta) throw new AppError(operational.mensagem, 409, 'STORE_CLOSED');
}

export function assertOrderVersion(order, version) {
  if (Number(order.versao) !== Number(version)) {
    throw new AppError('Pedido foi alterado por outro usuario. Atualize e tente novamente.', 409, 'ORDER_VERSION_CONFLICT');
  }
}

export class OrderService {
  constructor({ orders = new OrderRepository(), catalog = new CatalogRepository(), store = new StoreRepository(), payments = infinitepayPaymentService, release = orderReleaseService } = {}) {
    this.orders = orders;
    this.catalog = catalog;
    this.store = store;
    this.payments = payments;
    this.release = release;
  }

  orderData(input, priced, channel, userId = null) {
    const address = input.tipo_entrega === 'ENTREGA' ? input.endereco : null;
    return {
      codigo_acompanhamento: trackingCode(), canal_pedido: channel,
      cliente_nome: normalizeText(input.cliente.nome), cliente_telefone: normalizePhone(input.cliente.telefone),
      tipo_entrega: input.tipo_entrega,
      endereco_logradouro: normalizeText(address?.logradouro) ?? null, endereco_numero: normalizeText(address?.numero) ?? null,
      endereco_sem_numero: address?.sem_numero ?? false, endereco_bairro: normalizeText(address?.bairro) ?? null,
      endereco_cidade: normalizeText(address?.cidade) ?? null, endereco_uf: normalizeText(address?.uf) ?? null,
      endereco_complemento: normalizeText(address?.complemento) || null, endereco_referencia: normalizeText(address?.referencia) || null,
      metodo_pagamento_id: priced.paymentMethod.id, metodo_pagamento_nome_snapshot: priced.paymentMethod.nome,
      status: 'PENDENTE', status_pagamento: 'PENDENTE', subtotal: priced.subtotal,
      taxa_entrega: priced.deliveryFee, desconto: priced.discount, total: priced.total,
      precisa_troco: input.precisa_troco, troco_para: priced.changeFor,
      troco_previsto: priced.changeAmount,
      observacoes: normalizeText(input.observacoes) || null, criado_por_usuario_id: userId,
    };
  }

  async persist(trx, input, channel, userId, context) {
    const operational = await storeService.status({ trx, lock: true });
    assertStoreAccepting(operational, channel);
    const productIds = [...new Set(input.itens.map((item) => item.produto_id))];
    const catalog = await this.catalog.catalogForPricing(productIds, input.metodo_pagamento_id, trx);
    const priced = priceOrder(input, catalog, operational.config);
    const paymentConfig = channel === 'WEB' ? await this.payments.configuration(trx) : null;
    const methods = deriveOnlinePolicy(paymentConfig, channel, priced.paymentMethod.codigo);
    const order = await this.orders.insertOrder({ ...this.orderData(input, priced, channel, userId), fluxo_pagamento: methods ? 'INFINITEPAY' : 'TRADICIONAL', liberado_operacionalmente_em: methods ? null : trx.fn.now() }, trx);
    await this.orders.insertItems(order.id, priced.items, trx);
    await this.orders.addHistory({ pedido_id: order.id, status_anterior: null, status_novo: 'PENDENTE', usuario_id: userId, origem: channel, motivo: 'Pedido criado' }, trx);
    await auditService.registrar({ trx, usuarioId: userId, acao: 'PEDIDO.CRIAR', descricao: channel === 'WEB' ? 'Novo pedido publico recebido' : 'Pedido criado no painel', recursoTipo: 'pedido', recursoId: order.id, ...contextForAudit(context), payload: { pedido_id: order.id, total: order.total, origem: channel } });
    if (methods) await this.payments.prepare(trx, order, priced, paymentConfig, methods, input.cliente.email);
    else await this.release.release(trx, order, null, operational.config);
    return { order: await this.orders.detail(order.id, trx) };
  }

  async createPublic(input, idempotencyKey, context) {
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{16,200}$/.test(idempotencyKey)) throw new AppError('Idempotency-Key obrigatorio (16 a 200 caracteres seguros).', 400, 'IDEMPOTENCY_KEY_REQUIRED');
    const payloadHash = stableHash(input);
    const result = await this.orders.database.transaction(async (trx) => {
      const [inserted] = await trx('idempotencia_requisicoes').insert({ chave: idempotencyKey, endpoint: '/api/v1/pedidos', payload_hash: payloadHash, estado: 'PROCESSANDO', expira_em: DateTime.utc().plus({ hours: 24 }).toJSDate() }).onConflict('chave').ignore().returning('*');
      const record = inserted ?? await trx('idempotencia_requisicoes').where({ chave: idempotencyKey }).forUpdate().first();
      const replay = resolveIdempotency(record, payloadHash);
      if (!inserted && replay) return replay;
      const persisted = await this.persist(trx, input, 'WEB', null, context);
      const response = this.creationResponse(persisted.order);
      await trx('idempotencia_requisicoes').where({ id: record.id }).update({ pedido_id: persisted.order.id, resultado_json: response, estado: 'CONCLUIDO' });
      return response;
    });
    const pagamento = result.fluxo_pagamento === 'INFINITEPAY' ? await this.payments.checkoutForOrder(result.pedido_id) : { fluxo: 'TRADICIONAL', liberado_operacionalmente: true };
    await domainOutboxService.flush();
    return { ...result, pagamento };
  }

  async createAdmin(input, context) {
    const persisted = await this.orders.database.transaction((trx) => this.persist(trx, input, 'PAINEL', context.user.id, context));
    await domainOutboxService.flush();
    return { ...this.creationResponse(persisted.order), pagamento: { fluxo: 'TRADICIONAL', liberado_operacionalmente: true } };
  }

  creationResponse(order) {
    return { pedido_id: order.id, codigo_acompanhamento: order.codigo_acompanhamento, status: order.status, status_pagamento: order.status_pagamento, fluxo_pagamento: order.fluxo_pagamento, subtotal: order.subtotal, taxa_entrega: order.taxa_entrega, total: order.total, itens: order.itens, criado_em: order.criado_em };
  }

  async track(code) {
    const order = await this.orders.database('pedidos').where({ codigo_acompanhamento: code }).select('id', 'codigo_acompanhamento', 'status', 'status_pagamento', 'fluxo_pagamento', 'liberado_operacionalmente_em', 'confirmacao_liberacao_id', 'tipo_entrega', 'criado_em', 'atualizado_em').first();
    if (!order) throw new AppError('Pedido nao encontrado.', 404, 'ORDER_NOT_FOUND');
    const config = await this.store.config();
    const pagamento = await this.payments.view(order);
    const safe = { ...order };
    delete safe.id;
    delete safe.confirmacao_liberacao_id;
    return { ...safe, pagamento, tempo_estimado_min: config?.tempo_estimado_min ?? null };
  }

  async detail(id) {
    const order = await this.orders.detail(id);
    if (!order) throw new AppError('Pedido nao encontrado.', 404, 'ORDER_NOT_FOUND');
    return order;
  }

  list(filters) { return this.orders.list(filters); }

  async changeStatus(id, nextStatus, reason, version, context, allowCancellation = false) {
    let updated;
    let wasOperational = false;
    await this.orders.database.transaction(async (trx) => {
      const order = await this.orders.detail(id, trx, true);
      if (!order) throw new AppError('Pedido nao encontrado.', 404, 'ORDER_NOT_FOUND');
      assertOrderVersion(order, version);
      wasOperational = isOperationallyReleased(order);
      if (nextStatus !== 'CANCELADO') assertOperationalRelease(order);
      assertOrderTransition(order.tipo_entrega, order.status, nextStatus, reason, allowCancellation);
      updated = await this.orders.updateOrder(id, version, { status: nextStatus, motivo_cancelamento: nextStatus === 'CANCELADO' ? reason : order.motivo_cancelamento, cancelado_em: nextStatus === 'CANCELADO' ? trx.fn.now() : null }, trx);
      if (!updated) throw new AppError('Pedido foi alterado por outro usuario. Atualize e tente novamente.', 409, 'ORDER_VERSION_CONFLICT');
      await this.orders.addHistory({ pedido_id: id, status_anterior: order.status, status_novo: nextStatus, usuario_id: context.user.id, origem: 'PAINEL', motivo: reason }, trx);
      await auditService.registrar({ trx, usuarioId: context.user.id, acao: 'PEDIDO.STATUS', descricao: `Status ${order.status} -> ${nextStatus}`, recursoTipo: 'pedido', recursoId: id, ...contextForAudit(context), payload: { anterior: order.status, novo: nextStatus, motivo: reason } });
    });
    if (wasOperational) domainEvents.emit('pedido_atualizado', { event_id: `pedido:${id}:status:${updated.versao}`, pedido_id: id, status: updated.status, atualizado_em: updated.atualizado_em });
    return updated;
  }

  cancel(id, reason, version, context) { return this.changeStatus(id, 'CANCELADO', reason, version, context, true); }

  async changePayment(id, status, reason, version, context) {
    let updated;
    await this.orders.database.transaction(async (trx) => {
      const order = await this.orders.detail(id, trx, true);
      if (!order) throw new AppError('Pedido nao encontrado.', 404, 'ORDER_NOT_FOUND');
      assertOrderVersion(order, version);
      assertPaymentTransition(order.status, order.status_pagamento, status, reason);
      assertTraditionalPayment(order);
      updated = await this.orders.updateOrder(id, version, { status_pagamento: status }, trx);
      if (!updated) throw new AppError('Pedido foi alterado por outro usuario.', 409, 'ORDER_VERSION_CONFLICT');
      await auditService.registrar({ trx, usuarioId: context.user.id, acao: 'PEDIDO.PAGAMENTO', descricao: `Pagamento ${order.status_pagamento} -> ${status}`, recursoTipo: 'pedido', recursoId: id, ...contextForAudit(context), payload: { anterior: order.status_pagamento, novo: status, motivo: reason } });
    });
    domainEvents.emit('pedido_atualizado', { event_id: `pedido:${id}:pagamento:${updated.versao}`, pedido_id: id, status_pagamento: updated.status_pagamento, atualizado_em: updated.atualizado_em });
    return updated;
  }

  reconstructInput(order) {
    return {
      cliente: { nome: order.cliente_nome, telefone: order.cliente_telefone }, tipo_entrega: order.tipo_entrega,
      endereco: order.tipo_entrega === 'ENTREGA' ? { logradouro: order.endereco_logradouro, numero: order.endereco_numero, sem_numero: order.endereco_sem_numero, bairro: order.endereco_bairro, cidade: order.endereco_cidade, uf: order.endereco_uf, complemento: order.endereco_complemento, referencia: order.endereco_referencia } : null,
      metodo_pagamento_id: order.metodo_pagamento_id, precisa_troco: order.precisa_troco, troco_para: order.troco_para,
      observacoes: order.observacoes,
      itens: order.itens.map((item) => ({ produto_id: item.produto_id, quantidade: item.quantidade, observacoes: item.observacoes, adicionais: item.adicionais.map((extra) => ({ adicional_id: extra.adicional_id, quantidade: extra.quantidade_por_unidade })) })),
    };
  }

  async update(id, patch, context) {
    let final;
    await this.orders.database.transaction(async (trx) => {
      const current = await this.orders.detail(id, trx, true);
      if (!current) throw new AppError('Pedido nao encontrado.', 404, 'ORDER_NOT_FOUND');
      assertOrderVersion(current, patch.versao);
      assertTraditionalPayment(current);
      if (current.status !== 'PENDENTE') throw new AppError('Itens so podem ser editados enquanto o pedido esta PENDENTE.', 409, 'ORDER_NOT_EDITABLE');
      const input = { ...this.reconstructInput(current), ...patch };
      delete input.versao;
      const catalog = await this.catalog.catalogForPricing([...new Set(input.itens.map((item) => item.produto_id))], input.metodo_pagamento_id, trx);
      const config = await this.store.config(trx);
      const priced = priceOrder(input, catalog, config);
      const orderData = this.orderData(input, priced, current.canal_pedido, current.criado_por_usuario_id);
      delete orderData.codigo_acompanhamento; delete orderData.status; delete orderData.status_pagamento; delete orderData.criado_por_usuario_id;
      const updated = await this.orders.updateOrder(id, patch.versao, orderData, trx);
      if (!updated) throw new AppError('Pedido foi alterado por outro usuario.', 409, 'ORDER_VERSION_CONFLICT');
      await this.orders.replaceItems(id, priced.items, trx);
      await auditService.registrar({ trx, usuarioId: context.user.id, acao: 'PEDIDO.EDITAR', descricao: 'Pedido pendente recalculado com catalogo atual', recursoTipo: 'pedido', recursoId: id, ...contextForAudit(context), payload: { total_anterior: current.total, total_novo: updated.total } });
      final = await this.orders.detail(id, trx);
    });
    domainEvents.emit('pedido_atualizado', { event_id: `pedido:${id}:edicao:${final.versao}`, pedido_id: id, atualizado_em: final.atualizado_em });
    return final;
  }
}

export const orderService = new OrderService();
