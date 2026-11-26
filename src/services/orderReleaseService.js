import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { OrderRepository } from '../repositories/orderRepository.js';
import { notificationService } from './notificationService.js';
import { AppError } from '../utils/AppError.js';

export async function enqueueDomainEvent(trx, orderId, type, eventId, payload) {
  await trx('eventos_outbox').insert({ id: randomUUID(), pedido_id: orderId, tipo: type, event_id: eventId, payload: { ...payload, event_id: eventId } }).onConflict('event_id').ignore();
}

export class OrderReleaseService {
  constructor({ orders = new OrderRepository(), notifications = notificationService } = {}) { this.orders = orders; this.notifications = notifications; }

  async release(trx, order, confirmationId, configuration) {
    if (order.fluxo_pagamento === 'INFINITEPAY') {
      if (!confirmationId || order.status === 'CANCELADO') throw new AppError('Pedido online sem confirmacao elegivel.', 409, 'ORDER_PAYMENT_PENDING');
      if (order.confirmacao_liberacao_id) return false;
      const count = await trx('pedidos').where({ id: order.id }).whereNull('confirmacao_liberacao_id').update({ confirmacao_liberacao_id: confirmationId, liberado_operacionalmente_em: trx.fn.now(), status_pagamento: 'PAGO', versao: trx.raw('versao + 1'), atualizado_em: trx.fn.now() });
      if (!count) return false;
    }
    const current = await this.orders.detail(order.id, trx);
    const config = configuration ?? await trx('configuracoes_loja').first();
    const recipients = await this.notifications.createNewOrderNotifications(trx, current);
    const event = { pedido_id: current.id, criado_em: current.criado_em };
    await enqueueDomainEvent(trx, current.id, 'novo_pedido_recebido', `pedido:${current.id}:novo`, event);
    for (const userId of recipients) await enqueueDomainEvent(trx, current.id, 'notificacao_recebida', `pedido:${current.id}:notificacao:${userId}`, { ...event, usuario_id: userId });
    const method = config.metodo_impressao ?? (config.imprimir_automaticamente ? 'AGENTE_LEGADO' : 'DESABILITADA');
    const eligibleChannel = current.canal_pedido === 'WEB' || (current.canal_pedido === 'PAINEL' && config.imprimir_pedidos_painel);
    const legacyReady = method !== 'AGENTE_LEGADO' || (env.PRINT_AGENT_TOKEN && config.nome_impressora);
    if (config.imprimir_automaticamente && eligibleChannel && method !== 'DESABILITADA' && legacyReady) {
      const [job] = await trx('impressoes').insert({ pedido_id: current.id, tipo: 'COMANDA', origem: 'AUTOMATICA', destino: method, status: 'PENDENTE', dedup_key: `pedido:${current.id}:comanda`, disponivel_em: trx.fn.now(), payload_snapshot: current }).onConflict().ignore().returning('id');
      if (job) await enqueueDomainEvent(trx, current.id, 'impressao_disponivel', `pedido:${current.id}:impressao`, { pedido_id: current.id, job_id: job.id });
    }
    return true;
  }
}

export const orderReleaseService = new OrderReleaseService();
