import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import { encryptApiKey } from '../../src/payments/infinitepayCredentials.js';
import { stableHash } from '../../src/utils/crypto.js';

const key = Buffer.alloc(32, 7).toString('base64');
const hints = { order_nsu: 'order-1', transaction_nsu: 'tx-1', slug: 'invoice-1', receipt_url: 'https://recibo.infinitepay.io/untrusted' };
const paid = { success: true, paid: true, amount: 1500, paid_amount: 1510, installments: 1, capture_method: 'pix' };

afterEach(() => vi.restoreAllMocks());

function checkoutFixture() {
  vi.spyOn(env.allowedOrigins, 'includes').mockImplementation((origin) => origin === 'https://front.example.test');
  const repo = { insertAttempt: vi.fn(async (attempt) => attempt) };
  return {
    repo,
    order: { id: '1', cliente_nome: 'Marcos Silva', cliente_telefone: '18991978281', total: '71.00', taxa_entrega: '5.00', desconto: '0.00', codigo_acompanhamento: 'a'.repeat(32) },
    priced: { items: [
      { quantidade: 1, preco_unitario: '18.00', produto_nome_snapshot: 'Pastel de Carne', adicionais: [] },
      { quantidade: 2, preco_unitario: '24.00', produto_nome_snapshot: 'Crepe de Frango', adicionais: [{ nome_snapshot: 'Bacon', quantidade_por_unidade: 2 }], observacoes: 'Sem cebola' },
    ] },
    config: { handle: 'crepe-mania', credencial_id: 1, backend_public_url: 'https://api.example.test', redirect_url: 'https://front.example.test/pedido/confirmado' },
  };
}

describe('payload do checkout', () => {
  it('envia todos os produtos, personalizacoes, cliente e entrega sem cobrar adicionais duas vezes', async () => {
    const { InfinitepayPaymentService } = await import('../../src/services/infinitepayPaymentService.js');
    const f = checkoutFixture();
    const trx = {};
    const attempt = await new InfinitepayPaymentService({ repo: f.repo, key: () => key }).prepare(trx, f.order, f.priced, f.config, ['pix', 'credit_card'], 'marcos@example.invalid');
    expect(attempt.payload_json.items).toEqual([
      { quantity: 1, price: 1800, description: 'Pastel de Carne' },
      { quantity: 2, price: 2400, description: 'Crepe de Frango - Adicional: 2x Bacon - Sem cebola' },
      { quantity: 1, price: 500, description: 'Taxa de entrega' },
    ]);
    expect(attempt.payload_json.customer).toEqual({ name: 'Marcos Silva', phone_number: '+5518991978281', email: 'marcos@example.invalid' });
    expect(attempt.payload_json.items.reduce((sum, item) => sum + item.quantity * item.price, 0)).toBe(attempt.valor_centavos);
    expect(attempt.payload_json).toMatchObject({ handle: 'crepe-mania', order_nsu: attempt.order_nsu, webhook: { url: 'https://api.example.test/api/v1/pagamentos/webhook/infinitepay' }, options: { single_payment: true, payment_methods_enabled: ['pix', 'credit_card'] } });
    expect(new URL(attempt.payload_json.redirect_url).searchParams.get('codigo')).toBe(f.order.codigo_acompanhamento);
    expect(attempt.payload_hash).toBe(stableHash(attempt.payload_json));
    expect(f.repo.insertAttempt).toHaveBeenCalledWith(attempt, trx);
  });

  it.each(['(18) 99197-8281', '18991978281', '+55 (18) 99197-8281', '5518991978281', '5512345678', '55912345678'])("normaliza telefone %s sem duplicar DDI nem inventar email", async (phone) => {
    const { InfinitepayPaymentService } = await import('../../src/services/infinitepayPaymentService.js');
    const f = checkoutFixture();
    f.order.cliente_telefone = phone;
    const attempt = await new InfinitepayPaymentService({ repo: f.repo, key: () => key }).prepare({}, f.order, f.priced, f.config, ['credit_card']);
    expect(attempt.payload_json.customer.phone_number).toBe(phone.replace(/\D/g, '').length <= 11 ? `+55${phone.replace(/\D/g, '')}` : '+5518991978281');
    expect(attempt.payload_json.customer).not.toHaveProperty('email');
  });

  it.each(['123456789', '5418991978281', '551234567890123'])('rejeita telefone brasileiro invalido %s antes de persistir tentativa', async (phone) => {
    const { InfinitepayPaymentService } = await import('../../src/services/infinitepayPaymentService.js');
    const f = checkoutFixture();
    f.order.cliente_telefone = phone;
    await expect(new InfinitepayPaymentService({ repo: f.repo, key: () => key }).prepare({}, f.order, f.priced, f.config, ['pix', 'credit_card'])).rejects.toMatchObject({ code: 'INVALID_PHONE' });
    expect(f.repo.insertAttempt).not.toHaveBeenCalled();
  });

  it('aplica desconto do backend em centavos, preservando quantidades e total exato', async () => {
    const { InfinitepayPaymentService } = await import('../../src/services/infinitepayPaymentService.js');
    const f = checkoutFixture();
    f.order.desconto = '0.01';
    f.order.total = '70.99';
    const attempt = await new InfinitepayPaymentService({ repo: f.repo, key: () => key }).prepare({}, f.order, f.priced, f.config, ['pix', 'credit_card']);
    expect(attempt.payload_json.items).toEqual([
      { quantity: 1, price: 1800, description: 'Pastel de Carne' },
      { quantity: 1, price: 2399, description: 'Crepe de Frango - Adicional: 2x Bacon - Sem cebola' },
      { quantity: 1, price: 2400, description: 'Crepe de Frango - Adicional: 2x Bacon - Sem cebola' },
      { quantity: 1, price: 500, description: 'Taxa de entrega' },
    ]);
    expect(attempt.payload_json.items.reduce((sum, item) => sum + item.quantity * item.price, 0)).toBe(7099);
  });

  it('recusa total divergente sem persistir tentativa', async () => {
    const { InfinitepayPaymentService } = await import('../../src/services/infinitepayPaymentService.js');
    const f = checkoutFixture();
    f.order.total = '70.00';
    await expect(new InfinitepayPaymentService({ repo: f.repo, key: () => key }).prepare({}, f.order, f.priced, f.config, ['pix', 'credit_card'])).rejects.toMatchObject({ code: 'INFINITEPAY_TOTAL_MISMATCH' });
    expect(f.repo.insertAttempt).not.toHaveBeenCalled();
  });
});

function fixture() {
  const order = { id: '1', total: '15.00', status: 'PENDENTE', fluxo_pagamento: 'INFINITEPAY', codigo_acompanhamento: 'a'.repeat(32) };
  const attempt = { id: 'attempt-1', pedido_id: '1', order_nsu: 'order-1', estado: 'AGUARDANDO_CRIACAO', valor_centavos: '1500', metodos_permitidos: ['pix', 'credit_card'], credencial_id: 1, handle_snapshot: 'crepe-mania', payload_json: { order_nsu: 'order-1' }, valid_until: new Date(Date.now() + 3600000) };
  const transactions = [];
  const confirmations = [];
  let tail = Promise.resolve();
  const db = { transaction(callback) { const result = tail.then(() => callback({})); tail = result.catch(() => {}); return result; } };
  const repo = {
    database: db,
    attempt: vi.fn(async () => ({ ...attempt })),
    attemptForOrder: vi.fn(async () => ({ ...attempt })),
    order: vi.fn(async () => ({ ...order })),
    credential: vi.fn(async () => ({ id: 1, handle: 'crepe-mania', api_key_ciphertext: encryptApiKey('inchk_fixture', key, 'crepe-mania') })),
    updateAttempt: vi.fn(async (_id, patch) => Object.assign(attempt, patch)),
    claimCheckout: vi.fn(async () => db.transaction(async () => {
      if (attempt.estado !== 'AGUARDANDO_CRIACAO') return null;
      attempt.estado = 'CRIANDO';
      return { ...attempt };
    })),
    transactionByNsu: vi.fn(async (nsu) => transactions.find((item) => item.transaction_nsu === nsu)),
    insertTransaction: vi.fn(async (value) => { transactions.push(value); return value; }),
    insertConfirmation: vi.fn(async (value) => { confirmations.push(value); return value; }),
    transactionForAttempt: vi.fn(async () => transactions.find((item) => item.classificacao === 'ELEGIVEL') ?? null),
    configuration: vi.fn(async () => ({ ativo: false })),
  };
  const client = { createLink: vi.fn(async () => ({ url: 'https://buy.infinitepay.io/crepe-mania/x' })), checkPayment: vi.fn(async () => paid) };
  const release = vi.fn(async (_trx, current, confirmationId) => { Object.assign(order, { confirmacao_liberacao_id: confirmationId, liberado_operacionalmente_em: new Date(), status_pagamento: 'PAGO' }); return current; });
  return { repo, client, release, order, attempt, transactions, confirmations, audit: { registrar: vi.fn(async () => {}) } };
}

describe('pagamento oficial e liberacao', () => {
  it('resposta tardia do link nao regride pagamento ja confirmado', async () => {
    const { InfinitepayPaymentService } = await import('../../src/services/infinitepayPaymentService.js');
    const f = fixture();
    let respond;
    f.client.createLink.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const service = new InfinitepayPaymentService({ ...f, key: () => key });
    const checkout = service.checkout(f.attempt.id);
    await vi.waitFor(() => expect(respond).toBeTypeOf('function'));
    await service.verifyAttempt(f.attempt.id, hints);
    respond({ url: 'https://buy.infinitepay.io/crepe-mania/x' });
    await checkout;
    expect(f.attempt.estado).toBe('PAGO_VERIFICADO');
    expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('cria no maximo um link e conserva incerteza sem repetir POST /links', async () => {
    const { InfinitepayPaymentService } = await import('../../src/services/infinitepayPaymentService.js');
    const f = fixture();
    f.client.createLink.mockRejectedValue(new Error('timeout'));
    const service = new InfinitepayPaymentService({ ...f, key: () => key });
    await service.checkout(f.attempt.id);
    await service.checkout(f.attempt.id);
    expect(f.client.createLink).toHaveBeenCalledTimes(1);
    expect(f.attempt.estado).toBe('CRIACAO_INCERTA');
    expect(f.release).not.toHaveBeenCalled();
  });
  it('webhook/retorno concorrentes liberam uma vez e preservam credencial antiga', async () => {
    const { InfinitepayPaymentService } = await import('../../src/services/infinitepayPaymentService.js');
    const f = fixture();
    const service = new InfinitepayPaymentService({ ...f, key: () => key });
    await Promise.all([service.verifyAttempt(f.attempt.id, hints), service.verifyAttempt(f.attempt.id, hints)]);
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.transactions).toHaveLength(1);
    expect(f.confirmations).toHaveLength(1);
    expect(f.client.checkPayment).toHaveBeenCalledWith('inchk_fixture', { handle: 'crepe-mania', order_nsu: 'order-1', transaction_nsu: 'tx-1', slug: 'invoice-1' });
    expect(f.transactions[0].paid_amount).toBe(1510);
    expect(f.transactions[0].receipt_url).toBeNull();
  });
  it.each(['cancelado', 'valor', 'metodo', 'pago_insuficiente'])('registra recebimento %s sem liberar', async (scenario) => {
    const { InfinitepayPaymentService } = await import('../../src/services/infinitepayPaymentService.js');
    const f = fixture();
    if (scenario === 'cancelado') f.order.status = 'CANCELADO';
    if (scenario === 'valor') f.client.checkPayment.mockResolvedValue({ ...paid, amount: 1499 });
    if (scenario === 'metodo') f.attempt.metodos_permitidos = ['credit_card'];
    if (scenario === 'pago_insuficiente') f.client.checkPayment.mockResolvedValue({ ...paid, paid_amount: 1490 });
    await new InfinitepayPaymentService({ ...f, key: () => key }).verifyAttempt(f.attempt.id, hints);
    expect(f.transactions).toHaveLength(1);
    expect(f.confirmations[0].elegivel).toBe(false);
    expect(f.release).not.toHaveBeenCalled();
    expect(f.attempt.estado).toBe('PAGO_EM_REVISAO');
  });
  it('recusa confirmacao falsa ou de outra identidade sem efeitos', async () => {
    const { InfinitepayPaymentService } = await import('../../src/services/infinitepayPaymentService.js');
    const f = fixture();
    const service = new InfinitepayPaymentService({ ...f, key: () => key });
    f.client.checkPayment.mockResolvedValue({ ...paid, paid: false });
    await expect(service.verifyAttempt(f.attempt.id, hints)).rejects.toThrow();
    expect(f.transactions).toHaveLength(0);
    f.transactions.push({ transaction_nsu: 'tx-1', tentativa_id: 'other' });
    f.client.checkPayment.mockResolvedValue(paid);
    await expect(service.verifyAttempt(f.attempt.id, hints)).rejects.toMatchObject({ code: 'INFINITEPAY_TRANSACTION_CONFLICT' });
    expect(f.release).not.toHaveBeenCalled();
  });
});
