import { describe, expect, it } from 'vitest';
import { formatTextReceipt } from '../../src/printing/receiptFormatter.js';

describe('comanda de pagamento online confirmado', () => {
  it('exibe metodo real e impede que a equipe cobre novamente', () => {
    const order = { id: '1', criado_em: new Date(), itens: [], fluxo_pagamento: 'INFINITEPAY', confirmacao_liberacao_id: 'proof', liberado_operacionalmente_em: new Date(), metodo_pagamento_nome_snapshot: 'Pix', metodo_pagamento_confirmado_nome: 'Cartao de credito (InfinitePay)', subtotal: '15.00', taxa_entrega: '0.00', total: '15.00' };
    const text = formatTextReceipt(order, { columns: 48 });
    expect(text).toContain('Cartao de credito (InfinitePay)');
    expect(text).toContain('PAGO ONLINE - NAO COBRAR');
  });
});
