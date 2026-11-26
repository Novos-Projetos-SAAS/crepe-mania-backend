import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderService } from '../../src/services/orderService.js';
import { auditService } from '../../src/services/auditService.js';
import { storeService } from '../../src/services/storeService.js';

afterEach(() => vi.restoreAllMocks());
const enabled = { ativo: true, pix_habilitado: true, credito_habilitado: true };

describe('persistencia separada da operacao', () => {
  it.each([
    ['WEB', enabled, true],
    ['WEB', { ...enabled, ativo: false }, false],
    ['WEB', { ...enabled, pix_habilitado: false }, false],
    ['PAINEL', enabled, false],
  ])('%s com flags %j: online=%s', async (channel, config, online) => {
    vi.spyOn(auditService, 'registrar').mockResolvedValue(undefined);
    const storeConfig = { taxa_entrega: '0.00' };
    vi.spyOn(storeService, 'status').mockResolvedValue({ aberta: true, config: storeConfig });
    let order;
    const orders = { insertOrder: vi.fn(async (value) => { order = { ...value, id: '1' }; return order; }), insertItems: vi.fn(), addHistory: vi.fn(), detail: vi.fn(async () => ({ ...order, itens: [] })) };
    const catalog = { catalogForPricing: vi.fn(async () => ({ products: [{ id: 1, nome: 'Bebida', tipo: 'BEBIDA', preco_base: '7.50', ativo: true, disponivel_hoje: true, categoria_ativa: true }], breads: [], additionals: [], paymentMethod: { id: 1, codigo: 'PIX', nome: 'Pix' } })) };
    const payments = { configuration: vi.fn(async () => config), prepare: vi.fn() };
    const release = { release: vi.fn() };
    const input = { cliente: { nome: 'Fixture', telefone: '11999999999', email: 'cliente@example.invalid' }, tipo_entrega: 'RETIRADA', metodo_pagamento_id: 1, precisa_troco: false, itens: [{ produto_id: 1, quantidade: 2, adicionais: [] }] };
    const service = new OrderService({ orders, catalog, payments, release });
    await service.persist({ fn: { now: () => new Date() } }, input, channel, null, {});
    expect(order.total).toBe('15.00');
    expect(order.fluxo_pagamento).toBe(online ? 'INFINITEPAY' : 'TRADICIONAL');
    expect(payments.prepare).toHaveBeenCalledTimes(online ? 1 : 0);
    if (online) expect(payments.prepare.mock.calls[0][5]).toBe(input.cliente.email);
    expect(release.release).toHaveBeenCalledTimes(online ? 0 : 1);
    if (online) expect(order.liberado_operacionalmente_em).toBeNull();
    if (channel === 'PAINEL') expect(payments.configuration).not.toHaveBeenCalled();
  });
});
