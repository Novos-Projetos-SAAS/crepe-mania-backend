import { describe, expect, it } from 'vitest';

const policy = () => import('../../src/payments/orderPaymentPolicy.js');
const attempt = { valor_centavos: '1500', metodos_permitidos: ['pix', 'credit_card'], order_nsu: 'order-1' };
const result = { success: true, paid: true, amount: 1500, paid_amount: 1510, installments: 1, capture_method: 'pix' };

describe('politica InfinitePay', () => {
  it('preserva tradicionais e retém online mesmo com PAGO manual', async () => {
    const { isOperationallyReleased, assertOperationalRelease, assertTraditionalPayment } = await policy();
    expect(isOperationallyReleased({ status_pagamento: 'PENDENTE' })).toBe(true);
    expect(isOperationallyReleased(null)).toBe(false);
    expect(isOperationallyReleased({ fluxo_pagamento: 'DESCONHECIDO' })).toBe(false);
    const online = { fluxo_pagamento: 'INFINITEPAY', status_pagamento: 'PAGO' };
    expect(isOperationallyReleased(online)).toBe(false);
    expect(() => assertOperationalRelease(online)).toThrow(expect.objectContaining({ code: 'ORDER_PAYMENT_PENDING' }));
    expect(() => assertTraditionalPayment(online)).toThrow(expect.objectContaining({ code: 'ONLINE_PAYMENT_MANAGED' }));
    expect(isOperationallyReleased({ ...online, confirmacao_liberacao_id: 'proof', liberado_operacionalmente_em: new Date() })).toBe(true);
    expect(isOperationallyReleased({ ...online, status: 'CANCELADO', confirmacao_liberacao_id: 'proof', liberado_operacionalmente_em: new Date() })).toBe(false);
  });
  it('decide por canal/modalidade e rejeita PIX sem credito', async () => {
    const { deriveOnlinePolicy, validateModalityFlags } = await policy();
    const config = { ativo: true, pix_habilitado: true, credito_habilitado: true };
    expect(deriveOnlinePolicy(config, 'WEB', 'PIX')).toEqual(['pix', 'credit_card']);
    expect(deriveOnlinePolicy(config, 'WEB', 'CREDITO')).toEqual(['credit_card']);
    expect(deriveOnlinePolicy(config, 'PAINEL', 'PIX')).toBeNull();
    expect(deriveOnlinePolicy({ ...config, pix_habilitado: false }, 'WEB', 'PIX')).toBeNull();
    expect(deriveOnlinePolicy({ ...config, ativo: false }, 'WEB', 'PIX')).toBeNull();
    expect(deriveOnlinePolicy(config, 'WEB', 'DINHEIRO')).toBeNull();
    expect(() => validateModalityFlags({ ...config, credito_habilitado: false })).toThrow();
  });
  it('confere fonte oficial sem confundir valor pago com original', async () => {
    const { validatePaymentCheck } = await policy();
    expect(validatePaymentCheck(result, attempt, { transaction_nsu: 'tx', slug: 's' })).toMatchObject({ elegivel: true, paid_amount: 1510 });
    expect(validatePaymentCheck({ ...result, amount: 1499 }, attempt, {})).toMatchObject({ elegivel: false });
    expect(validatePaymentCheck({ ...result, capture_method: 'credit_card' }, { ...attempt, metodos_permitidos: ['pix'] }, {})).toMatchObject({ elegivel: false });
    for (const bad of [{ ...result, paid: false }, { ...result, success: 'true' }, { ...result, amount: '1500' }, { ...result, paid_amount: -1 }, { ...result, transaction_nsu: 'other' }]) {
      expect(() => validatePaymentCheck(bad, attempt, { transaction_nsu: 'tx' })).toThrow();
    }
  });
});
