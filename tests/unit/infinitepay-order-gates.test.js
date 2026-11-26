import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderService } from '../../src/services/orderService.js';
import { auditService } from '../../src/services/auditService.js';
import { domainEvents } from '../../src/realtime/domainEvents.js';

afterEach(() => vi.restoreAllMocks());

describe('operacoes administrativas online', () => {
  const order = { id: '1', fluxo_pagamento: 'INFINITEPAY', status: 'PENDENTE', status_pagamento: 'PENDENTE', versao: 1, tipo_entrega: 'RETIRADA' };
  const orders = { database: { transaction: (callback) => callback({ fn: { now: () => new Date() } }) }, detail: async () => order };
  const context = { user: { id: '1' } };
  it('impede marcar como pago pelo painel', async () => {
    await expect(new OrderService({ orders }).changePayment('1', 'PAGO', '', 1, context)).rejects.toMatchObject({ code: 'ONLINE_PAYMENT_MANAGED' });
  });
  it('impede editar valores/método de online pendente', async () => {
    await expect(new OrderService({ orders }).update('1', { versao: 1, metodo_pagamento_id: '2' }, context)).rejects.toMatchObject({ code: 'ONLINE_PAYMENT_MANAGED' });
  });
  it('impede avanço produtivo mesmo com permissão e versão válidas', async () => {
    await expect(new OrderService({ orders }).changeStatus('1', 'EM_PREPARO', '', 1, context)).rejects.toMatchObject({ code: 'ORDER_PAYMENT_PENDING' });
  });
  it('avisa cancelamento de pedido online ja exposto na fila', async () => {
    const current = { ...order, status: 'EM_PREPARO', confirmacao_liberacao_id: 'proof', liberado_operacionalmente_em: new Date() };
    const repository = { ...orders, detail: async () => current, updateOrder: async () => ({ ...current, status: 'CANCELADO', versao: 2 }), addHistory: vi.fn() };
    vi.spyOn(auditService, 'registrar').mockResolvedValue(undefined);
    const emit = vi.spyOn(domainEvents, 'emit');
    await new OrderService({ orders: repository }).cancel('1', 'Cliente cancelou', 1, context);
    expect(emit).toHaveBeenCalledWith('pedido_atualizado', expect.objectContaining({ status: 'CANCELADO' }));
  });
});
