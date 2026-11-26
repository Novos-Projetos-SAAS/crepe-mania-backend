// Snapshot 045: preserve this SQL independently of historical migrations.
const wrap = (name, query) => `
CREATE OR REPLACE FUNCTION public.${name}(p_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
${query.trim()}
$function$;
REVOKE ALL ON FUNCTION public.${name}(jsonb) FROM PUBLIC;
`;

const period = `
WITH parametros AS (
  SELECT
    COALESCE(NULLIF(p_filtros->>'data_inicio', '')::date, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date - 30) AS inicio,
    COALESCE(NULLIF(p_filtros->>'data_fim', '')::date, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date) AS fim
), limites AS (
  SELECT
    inicio::timestamp AT TIME ZONE 'America/Sao_Paulo' AS de,
    (fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo' AS ate
  FROM parametros
)`;

export const REPORT_FUNCTION_NAMES = {
  faturamento_periodo: 'fn_rel_faturamento_periodo',
  historico_vendas: 'fn_rel_historico_vendas',
  saida_adicionais: 'fn_rel_saida_adicionais',
  clientes_frequentes: 'fn_rel_clientes_frequentes',
  listagem_produtos: 'fn_rel_listagem_produtos',
  listagem_categorias: 'fn_rel_listagem_categorias',
  listagem_pagamentos: 'fn_rel_listagem_pagamentos',
  ranking_produtos: 'fn_rel_ranking_produtos',
  vendas_categoria: 'fn_rel_vendas_por_categoria',
  entregas_retiradas: 'fn_rel_entregas_retiradas',
};

export const REPORT_FUNCTION_SQL = {
  faturamento_periodo: wrap(REPORT_FUNCTION_NAMES.faturamento_periodo, `
    ${period}, dias AS (
      SELECT
        (p.criado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
        COUNT(*)::int AS pedidos_validos,
        COALESCE(SUM(p.total), 0)::numeric AS valor_pedidos_validos,
        COUNT(*) FILTER (WHERE p.status = 'ENTREGUE' AND p.status_pagamento = 'PAGO')::int AS pedidos_realizados,
        COALESCE(SUM(p.total) FILTER (WHERE p.status = 'ENTREGUE' AND p.status_pagamento = 'PAGO'), 0)::numeric AS faturamento_realizado
      FROM vw_pedidos_vendas_elegiveis p CROSS JOIN limites l
      WHERE p.criado_em >= l.de AND p.criado_em < l.ate
        AND p.status <> 'CANCELADO'
        AND (NULLIF(p_filtros->>'status', '') IS NULL OR p.status = (p_filtros->>'status'))
        AND (NULLIF(p_filtros->>'canal', '') IS NULL OR p.canal_pedido = (p_filtros->>'canal'))
      GROUP BY 1
    )
    SELECT jsonb_build_object(
      'data', to_char(dia, 'YYYY-MM-DD'),
      'pedidos_validos', pedidos_validos,
      'valor_pedidos_validos', round(valor_pedidos_validos, 2)::text,
      'pedidos_realizados', pedidos_realizados,
      'faturamento_realizado', round(faturamento_realizado, 2)::text,
      'ticket_medio_realizado', CASE WHEN pedidos_realizados = 0 THEN '0.00' ELSE round(faturamento_realizado / pedidos_realizados, 2)::text END
    ) FROM dias ORDER BY dia
  `),

  historico_vendas: wrap(REPORT_FUNCTION_NAMES.historico_vendas, `
    ${period}
    SELECT jsonb_build_object(
      'pedido_id', p.id::text,
      'criado_em', to_char(p.criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS'),
      'cliente', p.cliente_nome,
      'telefone', CASE WHEN length(regexp_replace(p.cliente_telefone, '\\D', '', 'g')) >= 4 THEN '***' || right(regexp_replace(p.cliente_telefone, '\\D', '', 'g'), 4) ELSE '***' END,
      'status', p.status,
      'status_pagamento', p.status_pagamento,
      'tipo_entrega', p.tipo_entrega,
      'canal', p.canal_pedido,
      'metodo_pagamento', COALESCE(p.metodo_pagamento_confirmado_nome, p.metodo_pagamento_nome_snapshot),
      'total', round(p.total, 2)::text
    )
    FROM vw_pedidos_vendas_elegiveis p CROSS JOIN limites l
    WHERE p.criado_em >= l.de AND p.criado_em < l.ate
      AND (NULLIF(p_filtros->>'status', '') IS NULL OR p.status = (p_filtros->>'status'))
      AND (NULLIF(p_filtros->>'status_pagamento', '') IS NULL OR p.status_pagamento = (p_filtros->>'status_pagamento'))
      AND (NULLIF(p_filtros->>'tipo_entrega', '') IS NULL OR p.tipo_entrega = (p_filtros->>'tipo_entrega'))
      AND (NULLIF(p_filtros->>'canal', '') IS NULL OR p.canal_pedido = (p_filtros->>'canal'))
      AND (NULLIF(p_filtros->>'metodo_pagamento_id', '') IS NULL OR p.metodo_pagamento_id = (p_filtros->>'metodo_pagamento_id')::bigint)
    ORDER BY p.criado_em DESC, p.id DESC
    LIMIT LEAST(GREATEST(COALESCE(NULLIF(p_filtros->>'limite', '')::int, 2000), 1), 2000)
  `),

  saida_adicionais: wrap(REPORT_FUNCTION_NAMES.saida_adicionais, `
    ${period}
    SELECT jsonb_build_object(
      'adicional', a.nome_snapshot,
      'quantidade', SUM(a.quantidade_por_unidade * i.quantidade)::int,
      'valor', round(SUM(a.subtotal), 2)::text
    )
    FROM itens_pedido_adicionais a
    JOIN itens_pedido i ON i.id = a.item_pedido_id
    JOIN vw_pedidos_vendas_elegiveis p ON p.id = i.pedido_id
    CROSS JOIN limites l
    WHERE p.criado_em >= l.de AND p.criado_em < l.ate
      AND p.status <> 'CANCELADO'
      AND (NULLIF(p_filtros->>'adicional_id', '') IS NULL OR a.adicional_id = (p_filtros->>'adicional_id')::bigint)
    GROUP BY a.nome_snapshot
    ORDER BY SUM(a.quantidade_por_unidade * i.quantidade) DESC, a.nome_snapshot
  `),

  clientes_frequentes: wrap(REPORT_FUNCTION_NAMES.clientes_frequentes, `
    ${period}, clientes AS (
      SELECT
        lower(trim(p.cliente_nome)) AS nome_normalizado,
        regexp_replace(p.cliente_telefone, '\\D', '', 'g') AS telefone_normalizado,
        min(p.cliente_nome) AS cliente,
        COUNT(*)::int AS pedidos,
        SUM(p.total)::numeric AS gasto
      FROM vw_pedidos_vendas_elegiveis p CROSS JOIN limites l
      WHERE p.criado_em >= l.de AND p.criado_em < l.ate
        AND p.status <> 'CANCELADO'
      GROUP BY lower(trim(p.cliente_nome)), regexp_replace(p.cliente_telefone, '\\D', '', 'g')
      HAVING COUNT(*) >= COALESCE(NULLIF(p_filtros->>'minimo_pedidos', '')::int, 2)
    ), ranking AS (
      SELECT *, row_number() OVER (ORDER BY pedidos DESC, gasto DESC, cliente)::int AS posicao
      FROM clientes
    )
    SELECT jsonb_build_object(
      'posicao', posicao,
      'cliente', cliente,
      'telefone', CASE WHEN length(telefone_normalizado) >= 4 THEN '***' || right(telefone_normalizado, 4) ELSE '***' END,
      'pedidos', pedidos,
      'gasto', round(gasto, 2)::text,
      'ticket_medio', round(gasto / pedidos, 2)::text
    ) FROM ranking
    ORDER BY posicao
    LIMIT LEAST(GREATEST(COALESCE(NULLIF(p_filtros->>'limite', '')::int, 2000), 1), 2000)
  `),

  listagem_produtos: wrap(REPORT_FUNCTION_NAMES.listagem_produtos, `
    SELECT jsonb_build_object(
      'codigo', p.id::text,
      'produto', p.nome,
      'categoria', c.nome,
      'tipo', p.tipo,
      'preco', COALESCE(round(p.preco_base, 2)::text, '0.00'),
      'ativo', p.ativo,
      'disponivel', p.disponivel_hoje,
      'excluido', p.deletado_em IS NOT NULL
    )
    FROM produtos p JOIN categorias_produtos c ON c.id = p.categoria_id
    WHERE (COALESCE(p_filtros->>'busca', '') = '' OR p.nome ILIKE '%' || (p_filtros->>'busca') || '%')
      AND (NULLIF(p_filtros->>'categoria_id', '') IS NULL OR p.categoria_id = (p_filtros->>'categoria_id')::bigint)
      AND (NULLIF(p_filtros->>'tipo', '') IS NULL OR p.tipo = (p_filtros->>'tipo'))
      AND (NULLIF(p_filtros->>'ativo', '') IS NULL OR p.ativo = (p_filtros->>'ativo')::boolean)
      AND (NULLIF(p_filtros->>'disponivel', '') IS NULL OR p.disponivel_hoje = (p_filtros->>'disponivel')::boolean)
    ORDER BY c.ordem_exibicao, p.ordem_exibicao, p.nome
    LIMIT LEAST(GREATEST(COALESCE(NULLIF(p_filtros->>'limite', '')::int, 2000), 1), 2000)
  `),

  listagem_categorias: wrap(REPORT_FUNCTION_NAMES.listagem_categorias, `
    SELECT jsonb_build_object(
      'codigo', c.id::text,
      'categoria', c.nome,
      'slug', c.slug,
      'ativo', c.ativo,
      'excluido', c.deletado_em IS NOT NULL,
      'total_produtos', COUNT(p.id)::int
    )
    FROM categorias_produtos c
    LEFT JOIN produtos p ON p.categoria_id = c.id AND p.deletado_em IS NULL
    WHERE (COALESCE(p_filtros->>'busca', '') = '' OR c.nome ILIKE '%' || (p_filtros->>'busca') || '%')
      AND (NULLIF(p_filtros->>'ativo', '') IS NULL OR c.ativo = (p_filtros->>'ativo')::boolean)
    GROUP BY c.id
    ORDER BY c.ordem_exibicao, c.nome
    LIMIT LEAST(GREATEST(COALESCE(NULLIF(p_filtros->>'limite', '')::int, 2000), 1), 2000)
  `),

  listagem_pagamentos: wrap(REPORT_FUNCTION_NAMES.listagem_pagamentos, `
    SELECT jsonb_build_object(
      'codigo', mp.codigo,
      'metodo', mp.nome,
      'ativo', mp.ativo,
      'ordem', mp.ordem_exibicao
    )
    FROM metodos_pagamento mp
    WHERE (COALESCE(p_filtros->>'busca', '') = '' OR mp.nome ILIKE '%' || (p_filtros->>'busca') || '%' OR mp.codigo ILIKE '%' || (p_filtros->>'busca') || '%')
      AND (NULLIF(p_filtros->>'ativo', '') IS NULL OR mp.ativo = (p_filtros->>'ativo')::boolean)
    ORDER BY mp.ordem_exibicao, mp.nome
  `),

  ranking_produtos: wrap(REPORT_FUNCTION_NAMES.ranking_produtos, `
    ${period}, produtos_agregados AS (
      SELECT i.produto_nome_snapshot AS produto, i.categoria_nome_snapshot AS categoria,
        i.tipo_produto_snapshot AS tipo, SUM(i.quantidade)::int AS unidades,
        SUM(i.subtotal)::numeric AS receita
      FROM itens_pedido i JOIN vw_pedidos_vendas_elegiveis p ON p.id = i.pedido_id CROSS JOIN limites l
      WHERE p.criado_em >= l.de AND p.criado_em < l.ate AND p.status <> 'CANCELADO'
        AND (NULLIF(p_filtros->>'tipo', '') IS NULL OR i.tipo_produto_snapshot = (p_filtros->>'tipo'))
        AND (NULLIF(p_filtros->>'categoria_id', '') IS NULL OR i.categoria_nome_snapshot = (SELECT nome FROM categorias_produtos WHERE id = (p_filtros->>'categoria_id')::bigint))
      GROUP BY i.produto_nome_snapshot, i.categoria_nome_snapshot, i.tipo_produto_snapshot
    ), ranking AS (
      SELECT *, row_number() OVER (ORDER BY unidades DESC, receita DESC, produto)::int AS posicao FROM produtos_agregados
    )
    SELECT jsonb_build_object('posicao', posicao, 'produto', produto, 'categoria', categoria, 'tipo', tipo, 'unidades', unidades, 'receita', round(receita, 2)::text)
    FROM ranking ORDER BY posicao
    LIMIT LEAST(GREATEST(COALESCE(NULLIF(p_filtros->>'limite', '')::int, 2000), 1), 2000)
  `),

  vendas_categoria: wrap(REPORT_FUNCTION_NAMES.vendas_categoria, `
    ${period}, categorias AS (
      SELECT i.categoria_nome_snapshot AS categoria, SUM(i.quantidade)::int AS unidades, SUM(i.subtotal)::numeric AS valor
      FROM itens_pedido i JOIN vw_pedidos_vendas_elegiveis p ON p.id = i.pedido_id CROSS JOIN limites l
      WHERE p.criado_em >= l.de AND p.criado_em < l.ate AND p.status <> 'CANCELADO'
        AND (NULLIF(p_filtros->>'categoria_id', '') IS NULL OR i.categoria_nome_snapshot = (SELECT nome FROM categorias_produtos WHERE id = (p_filtros->>'categoria_id')::bigint))
      GROUP BY i.categoria_nome_snapshot
    ), total AS (SELECT COALESCE(SUM(valor), 0) AS valor_total FROM categorias)
    SELECT jsonb_build_object(
      'categoria', c.categoria,
      'unidades', c.unidades,
      'valor', round(c.valor, 2)::text,
      'participacao', CASE WHEN t.valor_total = 0 THEN '0.00' ELSE round(c.valor * 100 / t.valor_total, 2)::text END
    ) FROM categorias c CROSS JOIN total t ORDER BY c.valor DESC, c.categoria
  `),

  entregas_retiradas: wrap(REPORT_FUNCTION_NAMES.entregas_retiradas, `
    ${period}
    SELECT jsonb_build_object(
      'tipo_entrega', p.tipo_entrega,
      'pedidos', COUNT(*)::int,
      'valor_pedidos', round(SUM(p.total), 2)::text,
      'taxa_entrega', round(SUM(p.taxa_entrega), 2)::text,
      'faturamento_realizado', round(COALESCE(SUM(p.total) FILTER (WHERE p.status = 'ENTREGUE' AND p.status_pagamento = 'PAGO'), 0), 2)::text,
      'ticket_medio', round(AVG(p.total), 2)::text
    )
    FROM vw_pedidos_vendas_elegiveis p CROSS JOIN limites l
    WHERE p.criado_em >= l.de AND p.criado_em < l.ate AND p.status <> 'CANCELADO'
      AND (NULLIF(p_filtros->>'tipo_entrega', '') IS NULL OR p.tipo_entrega = (p_filtros->>'tipo_entrega'))
    GROUP BY p.tipo_entrega ORDER BY p.tipo_entrega
  `),
};

export function dropReportFunctionSql(code) {
  return `DROP FUNCTION IF EXISTS public.${REPORT_FUNCTION_NAMES[code]}(jsonb);`;
}


export const ELIGIBLE_ORDERS_VIEW_SQL = `
CREATE OR REPLACE VIEW public.vw_pedidos_vendas_elegiveis AS
SELECT p.*,
  CASE WHEN p.fluxo_pagamento = 'INFINITEPAY' THEN
    CASE lower(t.capture_method)
      WHEN 'pix' THEN 'Pix (InfinitePay)'
      WHEN 'credit_card' THEN 'Cartao de credito (InfinitePay)'
    END
  END AS metodo_pagamento_confirmado_nome
FROM public.pedidos p
LEFT JOIN public.infinitepay_confirmacoes c
  ON c.id = p.confirmacao_liberacao_id AND c.pedido_id = p.id AND c.elegivel
LEFT JOIN public.infinitepay_transacoes t
  ON t.id = c.transacao_id AND t.pedido_id = p.id AND t.tentativa_id = c.tentativa_id
    AND t.classificacao = 'ELEGIVEL'
WHERE p.fluxo_pagamento = 'TRADICIONAL'
   OR (p.fluxo_pagamento = 'INFINITEPAY'
       AND p.liberado_operacionalmente_em IS NOT NULL
       AND c.id IS NOT NULL
       AND public.fn_infinitepay_prova_elegivel(p.id, p.confirmacao_liberacao_id, p.total));
`;
