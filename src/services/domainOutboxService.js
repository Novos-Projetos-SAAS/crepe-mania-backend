import { InfinitepayRepository } from '../repositories/infinitepayRepository.js';
import { domainEvents } from '../realtime/domainEvents.js';
import { isOperationallyReleased } from '../payments/orderPaymentPolicy.js';
import { logger } from '../config/logger.js';

const TYPES = new Set(['novo_pedido_recebido', 'notificacao_recebida', 'impressao_disponivel', 'pedido_atualizado']);

export class DomainOutboxService {
  constructor({ repo = new InfinitepayRepository(), emit = (name, payload) => domainEvents.emit(name, payload) } = {}) { this.repo = repo; this.emit = emit; }

  async processNext() {
    const row = await this.repo.claimQueue('eventos_outbox');
    if (!row) return false;
    try {
      const order = await this.repo.order(row.pedido_id);
      if (order && isOperationallyReleased(order) && TYPES.has(row.tipo)) this.emit(row.tipo, { ...row.payload, event_id: row.event_id });
      await this.repo.finishQueue('eventos_outbox', row);
    } catch {
      await this.repo.failQueue('eventos_outbox', row, 'OUTBOX_DELIVERY_FAILED');
    }
    return true;
  }

  async flush(limit = 10) {
    try { for (let index = 0; index < limit && await this.processNext(); index += 1) { /* bounded post-commit delivery */ } }
    catch (error) { logger.warn({ code: error.code ?? 'OUTBOX_UNAVAILABLE' }, 'Eventos aguardando processamento duravel'); }
  }
}

export const domainOutboxService = new DomainOutboxService();
