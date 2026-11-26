const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (schema) => ({ required: true, content: { 'application/json': { schema } } });
const idParameter = { in: 'path', name: 'id', required: true, schema: ref('BigIntId') };
const commonErrors = {
  401: { description: 'Nao autenticado', content: { 'application/json': { schema: ref('Error') } } },
  403: { description: 'Origem, CSRF ou permissao recusada', content: { 'application/json': { schema: ref('Error') } } },
  409: { description: 'Conflito de estado/versao', content: { 'application/json': { schema: ref('Error') } } },
  422: { description: 'Dados ou regra de negocio invalidos', content: { 'application/json': { schema: ref('Error') } } },
  429: { description: 'Limite de requisicoes excedido', content: { 'application/json': { schema: ref('Error') } } },
};

const schemas = {
  Error: { type: 'object', required: ['status', 'code', 'message', 'request_id'], properties: { status: { const: 'fail' }, code: { type: 'string' }, message: { type: 'string' }, request_id: { type: 'string', format: 'uuid' }, details: { type: 'array', items: { type: 'object', required: ['path', 'message'], properties: { path: { type: 'string' }, message: { type: 'string' } } } } } },
  BigIntId: { type: 'string', pattern: '^[1-9]\\d{0,18}$', example: '42', description: 'BIGINT serializado como string JSON.' },
  Money: { type: 'string', pattern: '^\\d+\\.\\d{2}$', example: '28.50' },
  Pagination: { type: 'object', required: ['page', 'limit', 'total', 'total_pages'], properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, total_pages: { type: 'integer' } } },
  Address: { type: 'object', additionalProperties: false, required: ['logradouro', 'bairro', 'cidade', 'uf'], properties: { logradouro: { type: 'string', maxLength: 160 }, numero: { type: ['string', 'null'], maxLength: 30 }, sem_numero: { type: 'boolean', default: false }, bairro: { type: 'string', maxLength: 100 }, cidade: { type: 'string', maxLength: 100 }, uf: { type: 'string', pattern: '^[A-Z]{2}$' }, complemento: { type: ['string', 'null'], maxLength: 160 }, referencia: { type: ['string', 'null'], maxLength: 200 } } },
  OrderItemInput: { type: 'object', additionalProperties: false, required: ['produto_id', 'quantidade'], properties: { produto_id: ref('BigIntId'), quantidade: { type: 'integer', minimum: 1, maximum: 50 }, adicionais: { type: 'array', maxItems: 30, default: [], items: { type: 'object', additionalProperties: false, required: ['adicional_id', 'quantidade'], properties: { adicional_id: ref('BigIntId'), quantidade: { type: 'integer', minimum: 1, maximum: 20 } } } }, observacoes: { type: ['string', 'null'], maxLength: 300 } } },
  CreateOrder: { type: 'object', additionalProperties: false, required: ['cliente', 'tipo_entrega', 'metodo_pagamento_id', 'itens'], properties: { cliente: { type: 'object', additionalProperties: false, required: ['nome', 'telefone'], properties: { nome: { type: 'string', maxLength: 120 }, telefone: { type: 'string', example: '18999999999' }, email: { type: 'string', format: 'email', maxLength: 254, description: 'Opcional; preenche o checkout InfinitePay sem ser publicado no acompanhamento.' } } }, tipo_entrega: { enum: ['ENTREGA', 'RETIRADA'] }, endereco: { oneOf: [ref('Address'), { type: 'null' }] }, metodo_pagamento_id: ref('BigIntId'), precisa_troco: { type: 'boolean', default: false }, troco_para: { oneOf: [ref('Money'), { type: 'null' }] }, observacoes: { type: ['string', 'null'], maxLength: 500 }, itens: { type: 'array', minItems: 1, maxItems: 30, items: ref('OrderItemInput') } }, example: { cliente: { nome: 'Ana', telefone: '18999999999' }, tipo_entrega: 'ENTREGA', endereco: { logradouro: 'Rua A', numero: '10', sem_numero: false, bairro: 'Centro', cidade: 'Presidente Prudente', uf: 'SP' }, metodo_pagamento_id: '2', precisa_troco: true, troco_para: '50.00', itens: [{ produto_id: '10', quantidade: 1, adicionais: [{ adicional_id: '7', quantidade: 2 }] }] } },
  Login: { type: 'object', additionalProperties: false, required: ['email', 'senha'], properties: { email: { type: 'string', format: 'email', maxLength: 254 }, senha: { type: 'string', writeOnly: true } } },
  ChangePassword: { type: 'object', additionalProperties: false, required: ['senha_atual', 'nova_senha', 'confirmar_nova_senha'], properties: { senha_atual: { type: 'string', writeOnly: true }, nova_senha: { type: 'string', minLength: 12, maxLength: 128, writeOnly: true, description: 'Minuscula, maiuscula e numero.' }, confirmar_nova_senha: { type: 'string', writeOnly: true } } },
  ResetPassword: { type: 'object', additionalProperties: false, required: ['nova_senha'], properties: { nova_senha: { type: 'string', minLength: 12, maxLength: 128, writeOnly: true } } },
  UserCreate: { type: 'object', additionalProperties: false, required: ['nome', 'email', 'senha', 'nivel_acesso_id'], properties: { nome: { type: 'string' }, email: { type: 'string', format: 'email' }, senha: { type: 'string', minLength: 12, writeOnly: true }, nivel_acesso_id: ref('BigIntId') } },
  InvitationCreate: { type: 'object', additionalProperties: false, required: ['email', 'nivel_acesso_id'], properties: { email: { type: 'string', format: 'email', maxLength: 254 }, nivel_acesso_id: ref('BigIntId') } },
  InvitationToken: { type: 'object', additionalProperties: false, required: ['token'], properties: { token: { type: 'string', minLength: 40, maxLength: 128, writeOnly: true, description: 'Segredo recebido no fragmento da URL e removido do historico pelo cliente.' } } },
  InvitationAccept: { type: 'object', additionalProperties: false, required: ['token', 'nome', 'senha', 'confirmar_senha'], properties: { token: { type: 'string', minLength: 40, maxLength: 128, writeOnly: true }, nome: { type: 'string', maxLength: 120 }, senha: { type: 'string', minLength: 12, maxLength: 128, writeOnly: true }, confirmar_senha: { type: 'string', writeOnly: true } } },
  Category: { type: 'object', additionalProperties: false, required: ['nome', 'slug'], properties: { nome: { type: 'string' }, slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }, descricao: { type: ['string', 'null'] }, ordem_exibicao: { type: 'integer', minimum: 0 }, ativo: { type: 'boolean' } } },
  Product: { type: 'object', additionalProperties: false, required: ['categoria_id', 'nome', 'tipo'], properties: { categoria_id: ref('BigIntId'), nome: { type: 'string' }, descricao: { type: ['string', 'null'] }, tipo: { enum: ['CREPE', 'PASTEL', 'PIZZA', 'BEBIDA', 'SUCO', 'ACAI', 'OUTRO'] }, preco_base: { oneOf: [ref('Money'), { type: 'null' }] }, imagem_url: { type: ['string', 'null'], format: 'uri' }, ativo: { type: 'boolean', default: false }, disponivel_hoje: { type: 'boolean', default: false }, ordem_exibicao: { type: 'integer', minimum: 0 } } },
  ProductLinks: { type: 'object', required: ['produto_id', 'adicionais'], properties: { produto_id: ref('BigIntId'), adicionais: { type: 'array', items: { type: 'object', properties: { adicional_id: ref('BigIntId'), ativo: { type: 'boolean' }, max_quantidade_por_item: { type: 'integer' } } } } } },
  Additional: { type: 'object', additionalProperties: false, required: ['nome', 'preco'], properties: { nome: { type: 'string' }, descricao: { type: ['string', 'null'] }, preco: ref('Money'), ativo: { type: 'boolean' }, disponivel_hoje: { type: 'boolean' }, ordem_exibicao: { type: 'integer' } } },
  PaymentMethod: { type: 'object', additionalProperties: false, required: ['codigo', 'nome'], properties: { codigo: { type: 'string' }, nome: { type: 'string' }, ativo: { type: 'boolean' }, ordem_exibicao: { type: 'integer' } } },
  PushSubscription: { type: 'object', additionalProperties: false, required: ['endpoint', 'keys'], properties: { endpoint: { type: 'string', format: 'uri', pattern: '^https://' }, expirationTime: { type: ['integer', 'null'] }, keys: { type: 'object', additionalProperties: false, required: ['p256dh', 'auth'], properties: { p256dh: { type: 'string', writeOnly: true }, auth: { type: 'string', writeOnly: true } } }, dispositivo_nome: { type: ['string', 'null'] } } },
  UploadResponse: { type: 'object', required: ['url', 'formato', 'largura', 'altura'], properties: { url: { type: 'string', format: 'uri' }, formato: { const: 'webp' }, largura: { type: 'integer' }, altura: { type: 'integer' } } },
  ReportRequest: { type: 'object', additionalProperties: false, properties: { filtros: { type: 'object', additionalProperties: true, description: 'Somente chaves declaradas em filtros_config são aceitas.' }, page: { type: 'integer', minimum: 1, default: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } } },
  ReportCatalogItem: { type: 'object', required: ['codigo', 'nome', 'descricao', 'grupo', 'filtros_config', 'colunas_config'], properties: { codigo: { type: 'string' }, nome: { type: 'string' }, descricao: { type: 'string' }, grupo: { enum: ['GERENCIAL', 'CADASTRAL'] }, filtros_config: { type: 'array', items: { type: 'object' } }, colunas_config: { type: 'array', items: { type: 'object' } }, filtros_padrao: { type: 'object' } } },
  ReportResult: { type: 'object', required: ['relatorio', 'colunas', 'dados', 'totais', 'filtros_aplicados', 'paginacao', 'gerado_em'], properties: { relatorio: { type: 'object' }, colunas: { type: 'array', items: { type: 'object' } }, dados: { type: 'array', items: { type: 'object' } }, totais: { type: 'object' }, filtros_aplicados: { type: 'array', items: { type: 'object' } }, paginacao: ref('Pagination'), gerado_em: { type: 'string', format: 'date-time' }, mensagem: { type: 'string' } } },
};

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Crepe Mania API',
    version: '2.1.0',
    description: 'API single-tenant. Dinheiro e string decimal; IDs bigint sao strings. Painel: credentials=include, cookies ls_access/ls_refresh/ls_csrf, Origin permitido e x-csrf-token em mutacoes.',
  },
  servers: [{ url: '/api/v1' }],
  tags: ['Publico', 'Auth', 'Convites', 'Pedidos', 'Catalogo', 'Operacao', 'Administracao', 'Notificacoes', 'Uploads', 'Relatorios', 'Auditoria', 'Impressao', 'Agente'].map((name) => ({ name })),
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'ls_access' },
      csrf: { type: 'apiKey', in: 'header', name: 'x-csrf-token' },
      printAgent: { type: 'http', scheme: 'bearer' },
      printDevice: { type: 'http', scheme: 'bearer', description: 'Credencial exclusiva do dispositivo, emitida no pareamento e armazenada no Android Keystore.' },
    },
    schemas,
  },
  paths: {},
};

const paymentIdentity = { type: 'object', additionalProperties: false, required: ['order_nsu', 'transaction_nsu', 'slug'], properties: { order_nsu: { type: 'string', maxLength: 100 }, transaction_nsu: { type: 'string', maxLength: 200 }, slug: { type: 'string', maxLength: 200 }, receipt_url: { type: 'string', format: 'uri', description: 'Pista de comprovante; nao confirma pagamento.' } } };
const financialConfig = { type: 'object', additionalProperties: false, required: ['versao'], properties: { versao: { type: 'integer', minimum: 1 }, ativo: { type: 'boolean', default: false }, pix_habilitado: { type: 'boolean', default: false }, credito_habilitado: { type: 'boolean', default: false }, handle: { type: 'string', maxLength: 100 }, api_key: { type: 'string', writeOnly: true, maxLength: 512, description: 'Vazia preserva a existente; substituicao cria nova credencial.' }, backend_public_url: { type: 'string', format: 'uri' }, redirect_url: { type: 'string', format: 'uri' }, assured_installments: { type: 'integer', minimum: 0, maximum: 12 } } };
const paymentCode = { in: 'path', name: 'codigo', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{32}$' }, description: 'Capacidade secreta do pedido. Nao usar ID sequencial.' };
const paymentAttempt = { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } };
Object.assign(openapi.paths, {
  '/pedidos/acompanhar/{codigo}/pagamento': { get: operation({ tag: 'Pagamentos', auth: false, summary: 'Estado financeiro sem cache; apenas consulta, sem criar link', params: [paymentCode] }) },
  '/pedidos/acompanhar/{codigo}/pagamento/confirmar': { post: operation({ tag: 'Pagamentos', auth: false, summary: 'Solicita verificacao oficial, nunca confia no retorno', params: [paymentCode], body: jsonBody(paymentIdentity), responses: { 202: { description: 'Ainda aguardando confirmacao' } } }) },
  '/pagamentos/webhook/infinitepay': { post: operation({ tag: 'Pagamentos', auth: false, summary: 'Persiste sinal para verificacao assincrona; nao libera pedido', body: jsonBody({ ...paymentIdentity, properties: { ...paymentIdentity.properties, invoice_slug: { type: 'string' }, event_type: { enum: ['created', 'paid', 'settled', 'canceled', 'refunded', 'payment_failed'] }, amount: { type: 'integer' }, paid_amount: { type: 'integer' }, installments: { type: 'integer' }, capture_method: { type: 'string' }, items: { type: 'array', items: {} } }, required: ['order_nsu', 'transaction_nsu'], description: 'Exige slug ou invoice_slug consistente.' }) }) },
  '/admin/pagamentos/infinitepay/configuracao': {
    get: operation({ tag: 'Pagamentos', summary: 'Configuracao sem segredo; permissao infinitepay.visualizar' }),
    patch: operation({ tag: 'Pagamentos', csrf: true, summary: 'Configuracao versionada; permissao infinitepay.configurar', body: jsonBody(financialConfig) }),
  },
  '/admin/pagamentos': { get: operation({ tag: 'Pagamentos', summary: 'Tentativas, transacoes e sinais para conciliacao; permissao pagamentos.listar' }) },
  '/admin/pagamentos/{id}/conciliar': { post: operation({ tag: 'Pagamentos', csrf: true, summary: 'Nova verificacao oficial; permissao pagamentos.conciliar; nunca recria checkout', params: [paymentAttempt], body: jsonBody(paymentIdentity) }) },
});
openapi.tags.push({ name: 'Pagamentos' });

function operation({ tag, summary, auth = true, csrf = false, body, params = [], query = [], created = false, responses = {} }) {
  return {
    tags: [tag], summary,
    ...(auth || csrf ? { security: [{ ...(auth ? { cookieAuth: [] } : {}), ...(csrf ? { csrf: [] } : {}) }] } : {}),
    ...(params.length || query.length ? { parameters: [...params, ...query] } : {}),
    ...(body ? { requestBody: body } : {}),
    responses: { [created ? 201 : 200]: { description: created ? 'Criado' : 'Sucesso' }, ...(auth ? commonErrors : { 422: commonErrors[422], 429: commonErrors[429] }), ...responses },
  };
}

const pageQuery = [
  { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
  { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];

Object.assign(openapi.paths, {
  '/health': { get: operation({ tag: 'Publico', summary: 'Saude do processo sem banco', auth: false }) },
  '/ready': { get: operation({ tag: 'Publico', summary: 'Prontidao com SELECT 1', auth: false, responses: { 503: { description: 'DATABASE_NOT_CONFIGURED ou DATABASE_UNAVAILABLE' } } }) },
  '/loja/status': { get: operation({ tag: 'Publico', summary: 'Status efetivo e horarios da loja', auth: false }) },
  '/cardapio': { get: operation({ tag: 'Publico', summary: 'Cardapio vendavel com adicionais', auth: false }) },
  '/cardapio/produtos/{id}': { get: operation({ tag: 'Publico', summary: 'Produto vendavel', auth: false, params: [idParameter] }) },
  '/metodos-pagamento': { get: operation({ tag: 'Publico', summary: 'Metodos ativos', auth: false }) },
  '/pedidos': { post: operation({ tag: 'Pedidos', summary: 'Cria pedido WEB; servidor calcula todos os valores', auth: false, created: true, params: [{ in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', minLength: 16, maxLength: 200 } }], body: jsonBody(ref('CreateOrder')), responses: { 200: { description: 'Replay idempotente' }, 409: { description: 'Loja fechada ou conflito de idempotencia' } } }) },
  '/pedidos/acompanhar/{codigo}': { get: operation({ tag: 'Pedidos', summary: 'Acompanhamento publico resumido', auth: false, params: [{ in: 'path', name: 'codigo', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{32}$' } }] }) },
  '/convites/validar': { post: operation({ tag: 'Convites', summary: 'Valida convite sem revelar se uma conta existe; resposta no-store', auth: false, body: jsonBody(ref('InvitationToken')) }) },
  '/convites/aceitar': { post: operation({ tag: 'Convites', summary: 'Aceita convite uma unica vez e cria conta Argon2id; resposta no-store', auth: false, created: true, body: jsonBody(ref('InvitationAccept')), responses: { 409: { description: 'Convite invalido, expirado ou indisponivel' } } }) },
  '/auth/csrf': { get: operation({ tag: 'Auth', summary: 'Emite ls_csrf e token double-submit', auth: false }) },
  '/auth/login': { post: operation({ tag: 'Auth', summary: 'Cria cookies HttpOnly ls_access e ls_refresh', auth: false, body: jsonBody(ref('Login')), responses: { 401: { description: 'Credenciais invalidas' } } }) },
  '/auth/refresh': { post: operation({ tag: 'Auth', summary: 'Rotaciona refresh e detecta replay', auth: false, csrf: true, responses: { 401: { description: 'Refresh invalido/reutilizado' }, 403: commonErrors[403] } }) },
  '/auth/logout': { post: operation({ tag: 'Auth', summary: 'Revoga sessao atual', csrf: true }) },
  '/auth/logout-all': { post: operation({ tag: 'Auth', summary: 'Revoga todas as sessoes e sockets', csrf: true }) },
  '/auth/alterar-senha': { post: operation({ tag: 'Auth', summary: 'Troca senha e exige novo login', csrf: true, body: jsonBody(ref('ChangePassword')) }) },
  '/auth/me': { get: operation({ tag: 'Auth', summary: 'Usuario e permissoes atuais' }) },
  '/admin/pedidos': {
    get: operation({ tag: 'Pedidos', summary: 'Lista pedidos', query: [...pageQuery, { in: 'query', name: 'status', schema: { enum: ['PENDENTE', 'EM_PREPARO', 'PRONTO_PARA_RETIRADA', 'SAIU_PARA_ENTREGA', 'ENTREGUE', 'CANCELADO'] } }, { in: 'query', name: 'status_pagamento', schema: { enum: ['PENDENTE', 'PAGO', 'ESTORNADO'] } }, { in: 'query', name: 'tipo_entrega', schema: { enum: ['ENTREGA', 'RETIRADA'] } }] }),
    post: operation({ tag: 'Pedidos', summary: 'Cria ENTREGA ou RETIRADA no PAINEL mesmo com WEB fechada', csrf: true, created: true, body: jsonBody(ref('CreateOrder')) }),
  },
  '/admin/usuarios': { get: operation({ tag: 'Administracao', summary: 'Lista colaboradores', query: pageQuery }), post: operation({ tag: 'Administracao', summary: 'Cria colaborador', csrf: true, created: true, body: jsonBody(ref('UserCreate')) }) },
  '/admin/usuarios/{id}/redefinir-senha': { post: operation({ tag: 'Administracao', summary: 'Redefine senha de outro usuario ativo; exige usuarios.redefinir_senha', csrf: true, params: [idParameter], body: jsonBody(ref('ResetPassword')) }) },
  '/admin/convites': {
    get: operation({ tag: 'Convites', summary: 'Lista convites sem hashes ou tokens; exige convites.listar', query: [...pageQuery, { in: 'query', name: 'status', schema: { enum: ['PENDENTE', 'ACEITO', 'EXPIRADO', 'REVOGADO'] } }] }),
    post: operation({ tag: 'Convites', summary: 'Cria convite e devolve o token somente nesta resposta; exige convites.gerenciar', csrf: true, created: true, body: jsonBody(ref('InvitationCreate')) }),
  },
  '/admin/convites/{id}/reemitir': { post: operation({ tag: 'Convites', summary: 'Revoga o convite anterior e devolve um novo token uma unica vez', csrf: true, created: true, params: [idParameter] }) },
  '/admin/convites/{id}/revogar': { post: operation({ tag: 'Convites', summary: 'Revoga convite ainda nao aceito', csrf: true, params: [idParameter] }) },
  '/admin/convites/niveis-acesso': { get: operation({ tag: 'Convites', summary: 'Lista niveis ativos para criacao de convite; exige convites.gerenciar' }) },
  '/admin/push/configuracao': { get: operation({ tag: 'Notificacoes', summary: 'Estado e chave publica VAPID; exige notificacoes.receber' }) },
  '/admin/produtos/{id}/vinculos': { get: operation({ tag: 'Catalogo', summary: 'Le o conjunto completo de adicionais antes da substituicao', params: [idParameter], responses: { 404: { description: 'Produto nao encontrado' } } }) },
  '/admin/push/inscricoes': {
    post: operation({ tag: 'Notificacoes', summary: 'Registra/transfere o proprio dispositivo descartando pendencias do dono anterior', csrf: true, created: true, body: jsonBody(ref('PushSubscription')), responses: { 503: { description: 'PUSH_NOT_CONFIGURED' } } }),
    delete: operation({ tag: 'Notificacoes', summary: 'Remove a propria subscription e suas pendencias', csrf: true, body: jsonBody({ type: 'object', additionalProperties: false, required: ['endpoint'], properties: { endpoint: { type: 'string', format: 'uri' } } }) }),
  },
  '/admin/notificacoes': { get: operation({ tag: 'Notificacoes', summary: 'Inbox exclusiva do usuario', query: pageQuery }) },
  '/admin/notificacoes/nao-lidas': { get: operation({ tag: 'Notificacoes', summary: 'Total nao lido do usuario' }) },
  '/admin/notificacoes/{id}/lida': { patch: operation({ tag: 'Notificacoes', summary: 'Marca item da propria inbox', csrf: true, params: [idParameter] }) },
  '/admin/uploads/produtos': { post: operation({ tag: 'Uploads', summary: 'JPEG/PNG/WebP para WebP no R2; exige produtos.gerenciar', csrf: true, created: true, body: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['arquivo'], properties: { arquivo: { type: 'string', format: 'binary' } } } } } }, responses: { 413: { description: 'IMAGE_TOO_LARGE' }, 503: { description: 'IMAGE_STORAGE_NOT_CONFIGURED' } } }) },
  '/admin/uploads/logo': { post: operation({ tag: 'Uploads', summary: 'JPEG/PNG/WebP para WebP no R2; exige loja.configurar', csrf: true, created: true, body: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['arquivo'], properties: { arquivo: { type: 'string', format: 'binary' } } } } } }, responses: { 413: { description: 'IMAGE_TOO_LARGE' }, 503: { description: 'IMAGE_STORAGE_NOT_CONFIGURED' } } }) },
});

const reportCodeParameter = { in: 'path', name: 'codigo', required: true, schema: { type: 'string', enum: ['faturamento_periodo', 'historico_vendas', 'saida_adicionais', 'clientes_frequentes', 'listagem_produtos', 'listagem_categorias', 'listagem_pagamentos', 'ranking_produtos', 'vendas_categoria', 'entregas_retiradas'] } };
openapi.paths['/admin/relatorios'] = {
  get: operation({ tag: 'Relatorios', summary: 'Lista somente relatórios autorizados e seus metadados' }),
};
openapi.paths['/admin/relatorios/opcoes/{fonte}'] = {
  get: operation({ tag: 'Relatorios', summary: 'Lista opções administrativas autorizadas para os filtros', params: [{ in: 'path', name: 'fonte', required: true, schema: { enum: ['categorias', 'produtos', 'adicionais', 'metodos-pagamento'] } }] }),
};
openapi.paths['/admin/relatorios/{codigo}'] = {
  get: operation({ tag: 'Relatorios', summary: 'Detalha filtros, colunas e defaults sem expor SQL', params: [reportCodeParameter] }),
};
openapi.paths['/admin/relatorios/{codigo}/gerar'] = {
  post: operation({ tag: 'Relatorios', summary: 'Gera prévia paginada com filtros estritos e totais oficiais', csrf: true, params: [reportCodeParameter], body: jsonBody(ref('ReportRequest')) }),
};
openapi.paths['/admin/relatorios/{codigo}/pdf'] = {
  post: {
    ...operation({ tag: 'Relatorios', summary: 'Exporta PDF autenticado com os mesmos filtros da prévia', csrf: true, params: [reportCodeParameter], body: jsonBody(ref('ReportRequest')) }),
    responses: { 200: { description: 'PDF privado', headers: { 'Content-Disposition': { schema: { type: 'string' } }, 'Cache-Control': { schema: { const: 'private, no-store, max-age=0' } } }, content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }, ...commonErrors },
  },
};

const catalog = [
  ['categorias', 'Category', true], ['produtos', 'Product', true],
  ['adicionais', 'Additional', false], ['metodos-pagamento', 'PaymentMethod', false],
];
for (const [resource, schema, detail] of catalog) {
  const path = `/admin/${resource}`;
  const query = resource === 'produtos'
    ? [...pageQuery, { in: 'query', name: 'categoria_id', schema: { type: 'string', pattern: '^[1-9][0-9]*$' } }, { in: 'query', name: 'arquivado', schema: { type: 'boolean' } }]
    : pageQuery;
  openapi.paths[path] = {
    get: operation({ tag: 'Catalogo', summary: `Lista ${resource}`, query }),
    post: operation({ tag: 'Catalogo', summary: `Cria ${resource}`, csrf: true, created: true, body: jsonBody(ref(schema)) }),
  };
  const itemPath = `${path}/{id}`;
  openapi.paths[itemPath] = {
    ...(detail ? { get: operation({ tag: 'Catalogo', summary: `Detalha ${resource}`, params: [idParameter] }) } : {}),
    patch: operation({ tag: 'Catalogo', summary: `Edita ${resource}`, csrf: true, params: [idParameter], body: jsonBody({ ...ref(schema), description: 'Campos parciais aceitos.' }) }),
    delete: operation({ tag: 'Catalogo', summary: resource === 'produtos' ? 'Arquiva produto preservando vínculos' : `Desativa ${resource}`, csrf: true, params: [idParameter] }),
  };
}

const simpleRoutes = [
  ['patch', '/admin/produtos/{id}/desativar', 'Catalogo', 'Desativa sem arquivar e também marca indisponível hoje', true],
  ['post', '/admin/produtos/{id}/reativar', 'Catalogo', 'Valida preço, categoria ; reativa mantendo indisponível hoje', true],
  ['post', '/admin/produtos/{id}/restaurar', 'Catalogo', 'Restaura o mesmo produto arquivado como inativo e indisponível', true],
  ['patch', '/admin/produtos/{id}/disponibilidade', 'Catalogo', 'Altera disponibilidade', true],
  ['put', '/admin/produtos/{id}/adicionais', 'Catalogo', 'Substitui adicionais e limites', true],
  ['patch', '/admin/adicionais/{id}/disponibilidade', 'Catalogo', 'Altera disponibilidade', true],
  ['get', '/admin/pedidos/{id}', 'Pedidos', 'Detalha pedido e snapshots', false],
  ['patch', '/admin/pedidos/{id}', 'Pedidos', 'Edita pedido PENDENTE, recalcula e exige versao', true],
  ['patch', '/admin/pedidos/{id}/status', 'Pedidos', 'Salta para qualquer status posterior compatível com a modalidade e versão', true],
  ['patch', '/admin/pedidos/{id}/pagamento', 'Pedidos', 'PENDENTE -> PAGO sem motivo; PAGO -> ESTORNADO exige motivo', true],
  ['post', '/admin/pedidos/{id}/cancelar', 'Pedidos', 'Cancela com motivo e versao', true],
  ['get', '/admin/pedidos/{id}/historico', 'Pedidos', 'Historico de status', false],
  ['get', '/admin/loja/configuracoes', 'Operacao', 'Configuracoes', false],
  ['patch', '/admin/loja/configuracoes', 'Operacao', 'Edita configuracoes', true],
  ['patch', '/admin/loja/status', 'Operacao', 'Abre/fecha manualmente', true],
  ['get', '/admin/loja/horarios', 'Operacao', 'Lista horarios', false],
  ['put', '/admin/loja/horarios', 'Operacao', 'Substitui horarios sem sobreposicao', true],
  ['get', '/admin/usuarios/{id}', 'Administracao', 'Detalha colaborador', false],
  ['patch', '/admin/usuarios/{id}', 'Administracao', 'Edita colaborador', true],
  ['delete', '/admin/usuarios/{id}', 'Administracao', 'Desativa e revoga acesso', true],
  ['patch', '/admin/usuarios/{id}/permissoes', 'Administracao', 'Substitui permissoes e revoga acesso removido', true],
  ['get', '/admin/permissoes', 'Administracao', 'Catalogo de permissoes', false],
  ['get', '/admin/niveis-acesso', 'Administracao', 'Niveis ativos', false],
  ['get', '/admin/dashboard', 'Relatorios', 'Indicadores por periodo', false],
  ['get', '/admin/relatorios/vendas', 'Relatorios', 'Vendas; cancelados fora do faturamento', false],
  ['get', '/admin/relatorios/produtos', 'Relatorios', 'Produtos vendidos', false],
  ['get', '/admin/relatorios/adicionais', 'Relatorios', 'Adicionais vendidos', false],
  ['get', '/admin/relatorios/pagamentos', 'Relatorios', 'Totais por pagamento', false],
  ['get', '/admin/relatorios/vendas.csv', 'Relatorios', 'CSV neutralizado', false],
  ['get', '/admin/logs', 'Auditoria', 'Pesquisa auditoria', false],
  ['get', '/admin/logs/{id}', 'Auditoria', 'Detalha auditoria', false],
  ['get', '/admin/pedidos/{id}/comanda', 'Impressao', 'Comanda texto/HTML 58mm', false],
  ['post', '/admin/pedidos/{id}/impressoes', 'Impressao', 'Solicita reimpressao', true],
  ['get', '/admin/impressoes', 'Impressao', 'Fila', false],
  ['get', '/admin/impressoes/android/status', 'Impressao', 'Estado da fila e dos dispositivos Android', false],
  ['post', '/admin/impressoes/android/pareamentos', 'Impressao', 'Cria codigo de pareamento de uso unico', true],
  ['post', '/admin/impressoes/android/dispositivos/{id}/revogar', 'Impressao', 'Revoga a credencial de um dispositivo', true],
  ['post', '/admin/impressoes/android/teste', 'Impressao', 'Enfileira pagina de teste', true],
  ['get', '/admin/impressoes/{id}', 'Impressao', 'Detalha job', false],
  ['get', '/admin/qz/configuracao', 'Impressao', 'Estado QZ', false],
  ['post', '/admin/qz/assinar', 'Impressao', 'Assina desafio QZ', true],
  ['get', '/admin/qz/certificado', 'Impressao', 'Certificado publico QZ', false],
];
for (const [method, path, tag, summary, mutation] of simpleRoutes) {
  openapi.paths[path] ??= {};
  openapi.paths[path][method] = operation({ tag, summary, csrf: mutation, params: path.includes('{id}') ? [idParameter] : [], body: mutation ? jsonBody({ type: 'object', description: 'Consulte os campos e enums descritos no summary/schema da rota.' }) : undefined });
}

openapi.paths['/agente-impressao/impressoes/proxima'] = { get: { tags: ['Agente'], summary: 'Reserva job com lease', security: [{ printAgent: [] }], responses: { 200: { description: 'Job' }, 204: { description: 'Fila vazia' }, 401: { description: 'Token invalido' } } } };
openapi.paths['/agente-impressao/impressoes/{id}/ack'] = { post: { tags: ['Agente'], summary: 'Confirma job reservado', security: [{ printAgent: [] }], parameters: [idParameter], requestBody: jsonBody({ type: 'object', required: ['lease_token', 'sucesso'], properties: { lease_token: { type: 'string', writeOnly: true }, sucesso: { type: 'boolean' }, erro: { type: ['string', 'null'] } } }), responses: { 200: { description: 'ACK aceito' }, 409: { description: 'Lease invalida/expirada' } } } };

const deviceSecurity = [{ printDevice: [] }];
openapi.paths['/agente-impressao/android/parear'] = { post: { tags: ['Agente'], summary: 'Troca codigo temporario por credencial exclusiva do aparelho', requestBody: jsonBody({ type: 'object', required: ['codigo', 'installation_id', 'nome', 'app_version', 'android_version'], properties: { codigo: { type: 'string', writeOnly: true }, installation_id: { type: 'string' }, nome: { type: 'string' }, app_version: { type: 'string' }, android_version: { type: 'string' } } }), responses: { 201: { description: 'Pareado; a credencial e retornada uma unica vez' }, 410: { description: 'Codigo expirado, usado ou inexistente' }, 429: commonErrors[429] } } };
openapi.paths['/agente-impressao/android/heartbeat'] = { post: { tags: ['Agente'], summary: 'Atualiza turno, impressora e saude do dispositivo', security: deviceSecurity, responses: { 200: { description: 'Estado atualizado' }, 401: commonErrors[401] } } };
openapi.paths['/agente-impressao/android/eventos'] = { get: { tags: ['Agente'], summary: 'Sinal SSE de trabalho disponivel; a fila REST continua sendo a fonte de verdade', security: deviceSecurity, responses: { 200: { description: 'text/event-stream' }, 401: commonErrors[401] } } };
openapi.paths['/agente-impressao/android/jobs/reservar'] = { post: { tags: ['Agente'], summary: 'Reserva atomicamente o proximo job com lease', security: deviceSecurity, responses: { 200: { description: 'Job e lease' }, 204: { description: 'Fila vazia' }, 409: { description: 'Turno inativo' } } } };
openapi.paths['/agente-impressao/android/jobs/{id}/estado'] = { get: { tags: ['Agente'], summary: 'Consulta somente o estado de um job para reconciliar confirmacao ambigua', security: deviceSecurity, parameters: [idParameter], responses: { 200: { description: 'Estado sem payload da comanda' }, 404: commonErrors[404] } } };
openapi.paths['/agente-impressao/android/jobs/{id}/iniciar-envio'] = { post: { tags: ['Agente'], summary: 'Marca a fronteira imediatamente anterior a escrita Bluetooth', security: deviceSecurity, parameters: [idParameter], requestBody: jsonBody({ type: 'object', required: ['lease_token'], properties: { lease_token: { type: 'string', writeOnly: true } } }), responses: { 200: { description: 'Inicio registrado' }, 409: { description: 'Lease invalida/expirada' } } } };
openapi.paths['/agente-impressao/android/jobs/{id}/resultado'] = { post: { tags: ['Agente'], summary: 'Registra ENVIADO, falha anterior ao envio ou resultado indeterminado', security: deviceSecurity, parameters: [idParameter], requestBody: jsonBody({ type: 'object', required: ['lease_token', 'resultado'], properties: { lease_token: { type: 'string', writeOnly: true }, resultado: { enum: ['ENVIADO', 'FALHA_ANTES_ENVIO', 'RESULTADO_INDETERMINADO'] }, erro: { type: ['string', 'null'] } } }), responses: { 200: { description: 'Resultado registrado' }, 409: { description: 'Lease invalida/expirada' } } } };
openapi.paths['/agente-impressao/android/credencial/rotacionar'] = { post: { tags: ['Agente'], summary: 'Rotaciona a propria credencial; o segredo novo aparece uma vez', security: deviceSecurity, responses: { 200: { description: 'Credencial rotacionada' }, 401: commonErrors[401] } } };
openapi.paths['/agente-impressao/android/credencial/desvincular'] = { post: { tags: ['Agente'], summary: 'Revoga a propria credencial antes de limpar o pareamento local', security: deviceSecurity, responses: { 200: { description: 'Dispositivo revogado' }, 401: commonErrors[401] } } };
openapi.paths['/admin/qz/assinar'].post.requestBody = jsonBody({ type: 'object', additionalProperties: false, required: ['job_id', 'request'], properties: { job_id: ref('BigIntId'), request: { type: 'string', maxLength: 10000, description: 'JSON QZ print canônico: printer.name, options com defaults seguros, raw command/plain contendo somente texto exato do job, timestamp recente. Pre-assinatura: qz.print(config,data,assinatura,timestamp).' } } });
openapi.paths['/pedidos'].post.responses[202] = { description: 'Pedido preservado, checkout em criacao ou resultado incerto; nao recriar com outra chave.' };
