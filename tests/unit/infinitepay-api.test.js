import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { infinitepayPaymentService } from '../../src/services/infinitepayPaymentService.js';

afterEach(() => vi.restoreAllMocks());

describe('API de pagamento sem banco ou provedor', () => {
  it('consulta estado por capacidade e proibe cache', async () => {
    const view = vi.spyOn(infinitepayPaymentService, 'forCode').mockResolvedValue({ order: { id: '1' }, pagamento: { fluxo: 'INFINITEPAY', estado: 'AGUARDANDO_PAGAMENTO', checkout_url: null } });
    const response = await request(app).get(`/api/v1/pedidos/acompanhar/${'a'.repeat(32)}/pagamento`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.data).not.toHaveProperty('order');
    expect(view).toHaveBeenCalledWith('a'.repeat(32));
  });
  it('webhook so persiste sinal, sem executar confirmacao no request', async () => {
    const ingest = vi.spyOn(infinitepayPaymentService, 'ingest').mockResolvedValue({ id: 'fixture' });
    const verify = vi.spyOn(infinitepayPaymentService, 'processInbox').mockResolvedValue(true);
    const response = await request(app).post('/api/v1/pagamentos/webhook/infinitepay').send({ order_nsu: 'order', transaction_nsu: 'tx', invoice_slug: 'slug', amount: 1, paid_amount: 1, capture_method: 'pix', installments: 1 });
    expect(response.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ slug: 'slug' }), 'WEBHOOK');
    expect(verify).not.toHaveBeenCalled();
  });
  it('recusa campos extras, slugs conflitantes e ausência de autenticação admin', async () => {
    const ingest = vi.spyOn(infinitepayPaymentService, 'ingest');
    const body = { order_nsu: 'order', transaction_nsu: 'tx', slug: 'slug' };
    expect((await request(app).post('/api/v1/pagamentos/webhook/infinitepay').send({ ...body, status_pagamento: 'PAGO' })).status).toBe(422);
    expect((await request(app).post('/api/v1/pagamentos/webhook/infinitepay').send({ ...body, invoice_slug: 'other' })).status).toBe(422);
    expect(ingest).not.toHaveBeenCalled();
    expect((await request(app).get('/api/v1/admin/pagamentos')).status).toBe(401);
    expect((await request(app).patch('/api/v1/admin/pagamentos/infinitepay/configuracao').send({ ativo: true, versao: 1 })).status).toBe(401);
  });
});
