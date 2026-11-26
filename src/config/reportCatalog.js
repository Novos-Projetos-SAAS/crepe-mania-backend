const dateFilters = [
  { chave: 'data_inicio', rotulo: 'Data inicial', tipo: 'date', obrigatorio: true, padrao: 'ultimos_30_dias' },
  { chave: 'data_fim', rotulo: 'Data final', tipo: 'date', obrigatorio: true, padrao: 'hoje' },
];

const column = (chave, rotulo, tipo = 'text', options = {}) => ({ chave, rotulo, tipo, ...options });
const filter = (chave, rotulo, tipo, options = {}) => ({ chave, rotulo, tipo, ...options });

export const REPORT_CATALOG = [
  {
    codigo: 'faturamento_periodo', nome: 'Faturamento por período', grupo: 'GERENCIAL', ordem_exibicao: 10,
    descricao: 'Acompanha pedidos válidos, vendas realizadas, faturamento efetivo e ticket médio por dia.',
    filtros_config: [...dateFilters, filter('status', 'Status do pedido', 'select', { opcoes: 'status_pedido' }), filter('canal', 'Canal', 'select', { opcoes: 'canal_pedido' })],
    colunas_config: [column('data', 'Data', 'date'), column('pedidos_validos', 'Pedidos válidos', 'integer', { totalizar: true }), column('valor_pedidos_validos', 'Valor dos pedidos', 'money', { totalizar: true }), column('pedidos_realizados', 'Realizados', 'integer', { totalizar: true }), column('faturamento_realizado', 'Faturamento efetivo', 'money', { totalizar: true }), column('ticket_medio_realizado', 'Ticket médio', 'money')],
  },
  {
    codigo: 'historico_vendas', nome: 'Histórico completo de vendas', grupo: 'GERENCIAL', ordem_exibicao: 20,
    descricao: 'Detalha pedidos do período com estado operacional, pagamento, modalidade e valores.',
    filtros_config: [...dateFilters, filter('status', 'Status do pedido', 'select', { opcoes: 'status_pedido' }), filter('status_pagamento', 'Status do pagamento', 'select', { opcoes: 'status_pagamento' }), filter('tipo_entrega', 'Modalidade', 'select', { opcoes: 'tipo_entrega' }), filter('canal', 'Canal', 'select', { opcoes: 'canal_pedido' }), filter('metodo_pagamento_id', 'Método de pagamento', 'select', { fonte: 'metodos-pagamento' })],
    colunas_config: [column('pedido_id', 'Pedido', 'integer'), column('criado_em', 'Data e hora', 'datetime'), column('cliente', 'Cliente'), column('telefone', 'Telefone'), column('status', 'Status'), column('status_pagamento', 'Pagamento'), column('tipo_entrega', 'Modalidade'), column('canal', 'Canal'), column('metodo_pagamento', 'Método'), column('total', 'Total', 'money', { totalizar: true })],
  },
  {
    codigo: 'saida_adicionais', nome: 'Saída de adicionais', grupo: 'GERENCIAL', ordem_exibicao: 30,
    descricao: 'Consolida a quantidade real e o valor dos adicionais incluídos nos itens vendidos.',
    filtros_config: [...dateFilters, filter('adicional_id', 'Adicional', 'select', { fonte: 'adicionais' })],
    colunas_config: [column('adicional', 'Adicional'), column('quantidade', 'Quantidade', 'integer', { totalizar: true }), column('valor', 'Valor', 'money', { totalizar: true })],
  },
  {
    codigo: 'clientes_frequentes', nome: 'Clientes mais frequentes', grupo: 'GERENCIAL', ordem_exibicao: 50,
    descricao: 'Ranking administrativo por frequência e gasto, com telefone mascarado.',
    filtros_config: [...dateFilters, filter('minimo_pedidos', 'Mínimo de pedidos', 'number', { minimo: 1, maximo: 100, padrao: 2 })],
    colunas_config: [column('posicao', 'Posição', 'integer'), column('cliente', 'Cliente'), column('telefone', 'Telefone'), column('pedidos', 'Pedidos', 'integer', { totalizar: true }), column('gasto', 'Gasto', 'money', { totalizar: true }), column('ticket_medio', 'Ticket médio', 'money')],
  },
  {
    codigo: 'ranking_produtos', nome: 'Produtos mais vendidos', grupo: 'GERENCIAL', ordem_exibicao: 60,
    descricao: 'Classifica produtos por unidades vendidas e receita dos itens.',
    filtros_config: [...dateFilters, filter('categoria_id', 'Categoria', 'select', { fonte: 'categorias' }), filter('tipo', 'Tipo de produto', 'select', { opcoes: 'tipo_produto' })],
    colunas_config: [column('posicao', 'Posição', 'integer'), column('produto', 'Produto'), column('categoria', 'Categoria'), column('tipo', 'Tipo'), column('unidades', 'Unidades', 'integer', { totalizar: true }), column('receita', 'Receita', 'money', { totalizar: true })],
  },
  {
    codigo: 'vendas_categoria', nome: 'Vendas por categoria', grupo: 'GERENCIAL', ordem_exibicao: 70,
    descricao: 'Agrupa unidades e valores pelos nomes de categoria preservados no pedido.',
    filtros_config: [...dateFilters, filter('categoria_id', 'Categoria', 'select', { fonte: 'categorias' })],
    colunas_config: [column('categoria', 'Categoria'), column('unidades', 'Unidades', 'integer', { totalizar: true }), column('valor', 'Valor', 'money', { totalizar: true }), column('participacao', 'Participação', 'percent')],
  },
  {
    codigo: 'entregas_retiradas', nome: 'Entregas e retiradas', grupo: 'GERENCIAL', ordem_exibicao: 80,
    descricao: 'Compara quantidade, taxa, valor e ticket médio por modalidade.',
    filtros_config: [...dateFilters, filter('tipo_entrega', 'Modalidade', 'select', { opcoes: 'tipo_entrega' })],
    colunas_config: [column('tipo_entrega', 'Modalidade'), column('pedidos', 'Pedidos', 'integer', { totalizar: true }), column('valor_pedidos', 'Valor dos pedidos', 'money', { totalizar: true }), column('taxa_entrega', 'Taxa de entrega', 'money', { totalizar: true }), column('faturamento_realizado', 'Faturamento efetivo', 'money', { totalizar: true }), column('ticket_medio', 'Ticket médio', 'money')],
  },
  {
    codigo: 'listagem_produtos', nome: 'Listagem de produtos', grupo: 'CADASTRAL', ordem_exibicao: 110,
    descricao: 'Inventário do catálogo com categoria, preço, disponibilidade e exclusão lógica.',
    filtros_config: [filter('busca', 'Buscar', 'text', { maximo_caracteres: 120 }), filter('categoria_id', 'Categoria', 'select', { fonte: 'categorias' }), filter('tipo', 'Tipo de produto', 'select', { opcoes: 'tipo_produto' }), filter('ativo', 'Situação', 'boolean'), filter('disponivel', 'Disponível hoje', 'boolean')],
    colunas_config: [column('codigo', 'Código', 'integer'), column('produto', 'Produto'), column('categoria', 'Categoria'), column('tipo', 'Tipo'), column('preco', 'Preço', 'money'), column('ativo', 'Ativo', 'boolean'), column('disponivel', 'Disponível', 'boolean'), column('excluido', 'Excluído', 'boolean')],
  },
  {
    codigo: 'listagem_categorias', nome: 'Listagem de categorias', grupo: 'CADASTRAL', ordem_exibicao: 120,
    descricao: 'Lista categorias e a quantidade atual de produtos vinculados.',
    filtros_config: [filter('busca', 'Buscar', 'text', { maximo_caracteres: 120 }), filter('ativo', 'Situação', 'boolean')],
    colunas_config: [column('codigo', 'Código', 'integer'), column('categoria', 'Categoria'), column('slug', 'Slug'), column('ativo', 'Ativa', 'boolean'), column('excluido', 'Excluída', 'boolean'), column('total_produtos', 'Produtos', 'integer', { totalizar: true })],
  },
  {
    codigo: 'listagem_pagamentos', nome: 'Listagem de métodos de pagamento', grupo: 'CADASTRAL', ordem_exibicao: 140,
    descricao: 'Lista os métodos aceitos e sua situação operacional.',
    filtros_config: [filter('busca', 'Buscar', 'text', { maximo_caracteres: 120 }), filter('ativo', 'Situação', 'boolean')],
    colunas_config: [column('codigo', 'Código'), column('metodo', 'Método de pagamento'), column('ativo', 'Ativo', 'boolean'), column('ordem', 'Ordem', 'integer')],
  },
];

export const REPORT_CODES = REPORT_CATALOG.map((report) => report.codigo);
export const REPORT_CATALOG_BY_CODE = Object.fromEntries(REPORT_CATALOG.map((report) => [report.codigo, report]));

