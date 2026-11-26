import { afterAll, describe, expect, it } from 'vitest';
import knex from 'knex';
import { REPORT_FUNCTION_SQL as LEGACY_SQL } from '../../src/database/reportFunctions.js';
import { aggregateSales, ReportService } from '../../src/services/reportService.js';

const compiler = knex({ client: 'pg' });
afterAll(() => compiler.destroy());

function captureQueries() {
  const sql = [];
  const db = Object.assign((table) => {
    const query = compiler(table);
    query.then = (resolve, reject) => { sql.push(query.toSQL().sql); return Promise.resolve([]).then(resolve, reject); };
    return query;
  }, { raw: compiler.raw.bind(compiler) });
  return { sql, service: new ReportService(() => db) };
}

describe('elegibilidade financeira InfinitePay', () => {
  it('agregador exclui online pendente, preserva tradicional e mantém ENTREGUE + PAGO', () => {
    expect(aggregateSales([
      { total: '10.00', status: 'PENDENTE', status_pagamento: 'PENDENTE' },
      { total: '20.00', status: 'ENTREGUE', status_pagamento: 'PAGO' },
      { total: '100.00', status: 'ENTREGUE', status_pagamento: 'PAGO', fluxo_pagamento: 'INFINITEPAY' },
      { total: '200.00', status: 'PENDENTE', status_pagamento: 'PENDENTE', fluxo_pagamento: 'INFINITEPAY', confirmacao_liberacao_id: 'proof' },
      { total: '30.00', status: 'ENTREGUE', status_pagamento: 'PAGO', fluxo_pagamento: 'INFINITEPAY', confirmacao_liberacao_id: 'proof', liberado_operacionalmente_em: '2026-11-16' },
      { total: '1000.00', status: 'CANCELADO', status_pagamento: 'PAGO', fluxo_pagamento: 'INFINITEPAY', confirmacao_liberacao_id: 'proof', liberado_operacionalmente_em: '2026-11-16' },
    ])).toEqual({ pedidos_validos: 3, valor_pedidos_validos: '60.00', pedidos_realizados: 2, faturamento_realizado: '50.00', ticket_medio_realizado: '25.00' });
  });

  it('queries de vendas, produtos, adicionais, pagamentos e dashboard usam a view elegível', async () => {
    const { sql, service } = captureQueries();
    const range = { data_inicio: '2026-11-01', data_fim: '2026-11-16' };
    for (const method of ['sales', 'products', 'additionals', 'payments', 'dashboard']) await service[method](range);
    expect(sql).toHaveLength(9);
    for (const query of sql) {
      expect(query).toContain('"vw_pedidos_vendas_elegiveis"');
      expect(query).not.toMatch(/(?:from|join) "pedidos"/);
    }
  });

  it('vendas e agrupamento de pagamentos projetam o método confirmado mantendo as chaves atuais', async () => {
    const { sql, service } = captureQueries();
    const range = { data_inicio: '2026-11-01', data_fim: '2026-11-16' };
    await service.sales(range);
    await service.payments(range);
    const method = 'COALESCE("p"."metodo_pagamento_confirmado_nome", "p"."metodo_pagamento_nome_snapshot")';
    expect(sql[0]).toContain(`${method} AS "metodo_pagamento_nome_snapshot"`);
    expect(sql[1]).toContain(`${method} as "metodo"`);
    expect(sql[1]).toContain(`group by ${method}`);
    expect(sql[1]).toContain("p.status = 'ENTREGUE' AND p.status_pagamento = 'PAGO'");
  });

  it('view mantém p.* e deriva cartão ou Pix somente da confirmação elegível do próprio pedido', async () => {
    const files = import.meta.glob('../../src/database/sql/045_reportFunctions.js');
    const { ELIGIBLE_ORDERS_VIEW_SQL: sql } = await Object.values(files)[0]();
    expect(sql).toContain('SELECT p.*');
    expect(sql).toContain('AS metodo_pagamento_confirmado_nome');
    expect(sql).toContain("CASE WHEN p.fluxo_pagamento = 'INFINITEPAY' THEN");
    expect(sql).toContain('CASE lower(t.capture_method)');
    expect(sql).toContain("WHEN 'pix' THEN 'Pix (InfinitePay)'");
    expect(sql).toContain("WHEN 'credit_card' THEN 'Cartao de credito (InfinitePay)'");
    expect(sql).toContain('LEFT JOIN public.infinitepay_confirmacoes c');
    expect(sql).toContain('c.id = p.confirmacao_liberacao_id AND c.pedido_id = p.id AND c.elegivel');
    expect(sql).toContain('LEFT JOIN public.infinitepay_transacoes t');
    expect(sql).toContain('t.id = c.transacao_id AND t.pedido_id = p.id AND t.tentativa_id = c.tentativa_id');
    expect(sql).toContain("t.classificacao = 'ELEGIVEL'");
  });

  it('snapshot 045 preserva as 12 funções e formatos sem importar SQL histórico', async () => {
    const files = import.meta.glob('../../src/database/sql/045_reportFunctions.js');
    expect(Object.keys(files)).toHaveLength(1);
    const { REPORT_FUNCTION_SQL, ELIGIBLE_ORDERS_VIEW_SQL } = await Object.values(files)[0]();
    expect(Object.keys(REPORT_FUNCTION_SQL)).toEqual(Object.keys(LEGACY_SQL));
    for (const [code, sql] of Object.entries(REPORT_FUNCTION_SQL)) {
      const restored = sql.replaceAll('vw_pedidos_vendas_elegiveis', 'pedidos')
        .replaceAll('COALESCE(p.metodo_pagamento_confirmado_nome, p.metodo_pagamento_nome_snapshot)', 'p.metodo_pagamento_nome_snapshot');
      expect(restored).toBe(LEGACY_SQL[code]);
    }
    expect(REPORT_FUNCTION_SQL.historico_vendas).toContain("'metodo_pagamento', COALESCE(p.metodo_pagamento_confirmado_nome, p.metodo_pagamento_nome_snapshot)");
    expect(ELIGIBLE_ORDERS_VIEW_SQL).toContain('SELECT p.*');
    expect(ELIGIBLE_ORDERS_VIEW_SQL).toContain("p.fluxo_pagamento = 'TRADICIONAL'");
    expect(ELIGIBLE_ORDERS_VIEW_SQL).toContain('p.liberado_operacionalmente_em IS NOT NULL');
    expect(ELIGIBLE_ORDERS_VIEW_SQL).toContain('c.id = p.confirmacao_liberacao_id');
    expect(ELIGIBLE_ORDERS_VIEW_SQL).toContain('c.elegivel');
  });
});
