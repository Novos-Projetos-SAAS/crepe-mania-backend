export const ORDER_STATUS = ['PENDENTE', 'EM_PREPARO', 'PRONTO_PARA_RETIRADA', 'SAIU_PARA_ENTREGA', 'ENTREGUE', 'CANCELADO'];
export const PAYMENT_STATUS = ['PENDENTE', 'PAGO', 'ESTORNADO'];
export const PRODUCT_TYPES = ['CREPE', 'PASTEL', 'PIZZA', 'BEBIDA', 'SUCO', 'ACAI', 'OUTRO'];
export const DELIVERY_TYPES = ['ENTREGA', 'RETIRADA'];
export const ORDER_CHANNELS = ['WEB', 'PAINEL'];

export const ORDER_TRANSITIONS = {
  RETIRADA: {
    PENDENTE: ['EM_PREPARO', 'PRONTO_PARA_RETIRADA', 'ENTREGUE'],
    EM_PREPARO: ['PRONTO_PARA_RETIRADA', 'ENTREGUE'],
    PRONTO_PARA_RETIRADA: ['ENTREGUE'],
  },
  ENTREGA: {
    PENDENTE: ['EM_PREPARO', 'SAIU_PARA_ENTREGA', 'ENTREGUE'],
    EM_PREPARO: ['SAIU_PARA_ENTREGA', 'ENTREGUE'],
    SAIU_PARA_ENTREGA: ['ENTREGUE'],
  },
};

export const PERMISSIONS = [
  'usuarios.listar', 'usuarios.criar', 'usuarios.editar', 'usuarios.desativar',
  'permissoes.listar', 'permissoes.editar', 'categorias.listar', 'categorias.gerenciar',
  'produtos.listar', 'produtos.gerenciar', 'produtos.disponibilidade',
  'adicionais.listar', 'adicionais.gerenciar', 'adicionais.disponibilidade',
  'metodos_pagamento.listar', 'metodos_pagamento.gerenciar', 'pedidos.listar', 'pedidos.criar',
  'pedidos.editar', 'pedidos.status', 'pedidos.cancelar', 'pedidos.pagamento',
  'loja.visualizar', 'loja.configurar', 'loja.status', 'relatorios.visualizar', 'dashboard.visualizar',
  'logs.listar', 'notificacoes.gerenciar', 'impressoes.listar', 'impressoes.solicitar', 'impressoes.configurar',
];

// Permissoes adicionadas depois do seed inicial. Sao cadastradas pelo seed 008,
// preservando o comportamento/checksum logico da versao 002.
export const STAGE_2_PERMISSIONS = [
  'notificacoes.receber',
  'usuarios.redefinir_senha',
];

// Permissoes da etapa 7 ficam em seed proprio para preservar os checksums
// historicos das versoes 002 e 008.
export const STAGE_7_PERMISSIONS = [
  'convites.listar',
  'convites.gerenciar',
];
