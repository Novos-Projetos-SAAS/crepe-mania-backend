import { z } from 'zod';
import { DELIVERY_TYPES, ORDER_STATUS, PAYMENT_STATUS, PRODUCT_TYPES } from '../config/constants.js';
import { REPORT_CODES } from '../config/reportCatalog.js';

const id = z.union([
    z.string().regex(/^[1-9]\d{0,18}$/),
    z.number().int().positive().safe(),
]).transform((value) => String(value)).refine((value) => BigInt(value) <= 9223372036854775807n, 'ID fora do limite bigint.');
const shortText = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) => z.string().trim().max(max).optional().nullable();
const money = z.string().regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/);
const strongPassword = z.string().min(12).max(128).regex(/[a-z]/, 'Inclua letra minuscula.').regex(/[A-Z]/, 'Inclua letra maiuscula.').regex(/\d/, 'Inclua numero.');

export const idParamsSchema = z.object({ id });
export const paginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
});
export const catalogListQuerySchema = paginationSchema.extend({ ativo: z.enum(['true', 'false']).transform((value) => value === 'true').optional(), busca: z.string().trim().max(120).optional() }).strict();
export const productListQuerySchema = catalogListQuerySchema.extend({
    categoria_id: id.optional(),
    arquivado: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
}).strict();
export const userListQuerySchema = catalogListQuerySchema;
export const orderListQuerySchema = paginationSchema.extend({ status: z.enum(ORDER_STATUS).optional(), status_pagamento: z.enum(PAYMENT_STATUS).optional(), metodo_pagamento_id: id.optional(), tipo_entrega: z.enum(DELIVERY_TYPES).optional(), busca: z.string().trim().max(120).optional(), data_inicio: z.string().date().optional(), data_fim: z.string().date().optional(), order: z.enum(['asc', 'desc']).default('desc') }).strict();
export const logListQuerySchema = paginationSchema.extend({ tipo: z.enum(['ACAO', 'ERRO', 'SEGURANCA', 'SISTEMA']).optional(), acao: z.string().trim().max(100).optional(), usuario_id: id.optional(), data_inicio: z.string().date().optional(), data_fim: z.string().date().optional() }).strict();
export const printListQuerySchema = paginationSchema.extend({ status: z.enum(['PENDENTE', 'EM_PROCESSAMENTO', 'CONCLUIDA', 'FALHOU', 'RESULTADO_INDETERMINADO']).optional() }).strict();
export const receiptQuerySchema = z.object({ formato: z.enum(['texto', 'html']).default('texto') }).strict();
export const trackingParamsSchema = z.object({ codigo: z.string().regex(/^[a-f0-9]{32}$/) });

const addressSchema = z.object({
    logradouro: shortText(160),
    numero: optionalText(30),
    sem_numero: z.boolean().default(false),
    bairro: shortText(100),
    cidade: shortText(100),
    uf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
    complemento: optionalText(160),
    referencia: optionalText(200),
}).strict().superRefine((value, ctx) => {
    if (!value.numero && !value.sem_numero) ctx.addIssue({ code: 'custom', path: ['numero'], message: 'Informe numero ou marque sem_numero.' });
});

const orderItemSchema = z.object({
    produto_id: id,
    quantidade: z.coerce.number().int().min(1).max(50),
    adicionais: z.array(z.object({ adicional_id: id, quantidade: z.coerce.number().int().min(1).max(20) }).strict()).max(30).default([]),
    observacoes: optionalText(300),
}).strict();

const createOrderBaseSchema = z.object({
  cliente: z.object({ nome: shortText(120), telefone: z.string().trim().regex(/^\+?[0-9 ()-]{10,20}$/), email: z.string().trim().email().max(254).optional() }).strict(),
  tipo_entrega: z.enum(DELIVERY_TYPES),
  endereco: addressSchema.optional().nullable(),
  metodo_pagamento_id: id,
  precisa_troco: z.boolean().default(false),
  troco_para: money.optional().nullable(),
  observacoes: optionalText(500),
  itens: z.array(orderItemSchema).min(1).max(30),
}).strict();

export const createOrderSchema = createOrderBaseSchema.superRefine((value, ctx) => {
    if (value.tipo_entrega === 'ENTREGA' && !value.endereco) ctx.addIssue({ code: 'custom', path: ['endereco'], message: 'Endereco obrigatorio para entrega.' });
    if (value.tipo_entrega === 'RETIRADA' && value.endereco) ctx.addIssue({ code: 'custom', path: ['endereco'], message: 'Nao envie endereco para retirada.' });
    if (!value.precisa_troco && value.troco_para != null) ctx.addIssue({ code: 'custom', path: ['troco_para'], message: 'Troco somente quando solicitado.' });
});

export const loginSchema = z.object({ email: z.string().trim().email().max(254), senha: z.string().min(8).max(128) }).strict();
export const changePasswordSchema = z.object({
    senha_atual: z.string().min(1).max(128),
    nova_senha: strongPassword,
    confirmar_nova_senha: z.string().min(1).max(128),
}).strict().superRefine((value, ctx) => {
    if (value.nova_senha !== value.confirmar_nova_senha) ctx.addIssue({ code: 'custom', path: ['confirmar_nova_senha'], message: 'A confirmacao deve ser igual a nova senha.' });
});
export const resetPasswordSchema = z.object({ nova_senha: strongPassword }).strict();
export const createUserSchema = z.object({
    nome: shortText(120), email: z.string().trim().email().max(254), senha: strongPassword, nivel_acesso_id: id,
}).strict();
export const updateUserSchema = z.object({ nome: shortText(120).optional(), email: z.string().trim().email().max(254).optional(), nivel_acesso_id: id.optional(), ativo: z.boolean().optional() }).strict();
export const permissionsSchema = z.object({ permissoes: z.array(z.string().min(3).max(100)).max(100) }).strict();
export const invitationListQuerySchema = paginationSchema.extend({
    busca: z.string().trim().max(120).optional(),
    status: z.enum(['PENDENTE', 'ACEITO', 'EXPIRADO', 'REVOGADO']).optional(),
}).strict();
export const createInvitationSchema = z.object({
    email: z.string().trim().email().max(254),
    nivel_acesso_id: id,
}).strict();
export const invitationTokenSchema = z.object({
    token: z.string().min(40).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();
export const acceptInvitationSchema = invitationTokenSchema.extend({
    nome: shortText(120),
    senha: strongPassword,
    confirmar_senha: z.string().min(1).max(128),
}).strict().superRefine((value, ctx) => {
    if (value.senha !== value.confirmar_senha) ctx.addIssue({ code: 'custom', path: ['confirmar_senha'], message: 'A confirmacao deve ser igual a senha.' });
});

export const categorySchema = z.object({ nome: shortText(100), slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), descricao: optionalText(1000), ordem_exibicao: z.coerce.number().int().min(0).optional(), ativo: z.boolean().optional() }).strict();
export const productSchema = z.object({ categoria_id: id, nome: shortText(140), descricao: optionalText(2000), tipo: z.enum(PRODUCT_TYPES), preco_base: money.optional().nullable(), imagem_url: z.string().url().max(2048).optional().nullable(), ativo: z.boolean().optional(), disponivel_hoje: z.boolean().optional(), ordem_exibicao: z.coerce.number().int().min(0).optional() }).strict();
export const additionalSchema = z.object({ nome: shortText(120), descricao: optionalText(1000), preco: money, ativo: z.boolean().optional(), disponivel_hoje: z.boolean().optional(), ordem_exibicao: z.coerce.number().int().min(0).optional() }).strict();
export const paymentMethodSchema = z.object({ codigo: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]+$/).max(40), nome: shortText(100), ativo: z.boolean().optional(), ordem_exibicao: z.coerce.number().int().min(0).optional() }).strict();
export const additionalLinksSchema = z.object({ adicionais: z.array(z.object({ adicional_id: id, max_quantidade_por_item: z.coerce.number().int().min(1).max(20), ativo: z.boolean().default(true) }).strict()).max(100) }).strict();

export const storeConfigSchema = z.object({ nome_fantasia: shortText(120).optional(), telefone: optionalText(30), whatsapp: optionalText(30), endereco_trailer: optionalText(500), referencia_trailer: optionalText(500), logo_url: z.string().url().max(2048).optional().nullable(), taxa_entrega: money.optional(), tempo_estimado_min: z.coerce.number().int().positive().max(1440).optional().nullable(), imprimir_automaticamente: z.boolean().optional(), nome_impressora: optionalText(120), metodo_impressao: z.enum(['DESABILITADA', 'ANDROID_BLUETOOTH', 'AGENTE_LEGADO']).optional(), imprimir_pedidos_painel: z.boolean().optional() }).strict();

export const storeStatusSchema = z.union([
    // Novo contrato: três modos de funcionamento.
    z.object({
        modo_operacao: z.enum([
            'AUTOMATICO',
            'ABERTO_MANUAL',
            'FECHADO_MANUAL',
        ]),
    }).strict(),

    // Contrato antigo: mantido por compatibilidade.
    z.object({
        aceitar_pedidos: z.boolean(),
    }).strict(),
]);

export const scheduleSchema = z.object({ horarios: z.array(z.object({ dia_semana: z.coerce.number().int().min(0).max(6), hora_inicio: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), hora_fim: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), ativo: z.boolean().default(true) }).strict()).max(50) }).strict();

export const orderStatusSchema = z.object({ status: z.enum(ORDER_STATUS), motivo: optionalText(500), versao: z.coerce.number().int().positive() }).strict();
export const paymentStatusSchema = z.object({ status_pagamento: z.enum(PAYMENT_STATUS), motivo: optionalText(500), versao: z.coerce.number().int().positive() }).strict().superRefine((value, ctx) => {
    if (value.status_pagamento === 'ESTORNADO' && !value.motivo?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Motivo obrigatório para estorno.' });
    }
});
export const cancelOrderSchema = z.object({ motivo: shortText(500), versao: z.coerce.number().int().positive() }).strict();
export const updateOrderSchema = createOrderBaseSchema.omit({ tipo_entrega: true }).partial().extend({ versao: z.coerce.number().int().positive() }).strict();

export const reportCodeParamsSchema = z.object({ codigo: z.enum(REPORT_CODES) }).strict();
export const reportOptionParamsSchema = z.object({ fonte: z.enum(['categorias', 'produtos', 'adicionais', 'metodos-pagamento']) }).strict();
export const reportGenerateSchema = z.object({
    filtros: z.record(z.string(), z.unknown()).default({}),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
}).strict();

export const pushSubscriptionSchema = z.object({ endpoint: z.string().url().refine((url) => url.startsWith('https://'), 'Endpoint deve usar HTTPS.'), expirationTime: z.number().int().positive().nullable().optional(), keys: z.object({ p256dh: shortText(500), auth: shortText(500) }).strict(), dispositivo_nome: optionalText(120) }).strict();
export const deletePushSchema = z.object({ endpoint: z.string().url() }).strict();
export const printAckSchema = z.object({ lease_token: shortText(500), sucesso: z.boolean(), erro: optionalText(1000) }).strict();
export const qzSignSchema = z.object({ job_id: id, request: z.string().min(1).max(10000) }).strict();

const printApiUrl = z.string().url().max(500).refine((value) => value.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/.test(value), 'A API deve usar HTTPS fora do ambiente local.');
export const createPrintPairingSchema = z.object({ api_url: printApiUrl }).strict();
export const pairPrintDeviceSchema = z.object({
    codigo: z.string().trim().toUpperCase().regex(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/),
    installation_id: z.string().trim().min(16).max(100).regex(/^[A-Za-z0-9._:-]+$/),
    nome: shortText(120),
    app_version: shortText(40),
    android_version: shortText(40),
}).strict();
export const printHeartbeatSchema = z.object({
    turno_ativo: z.boolean(), app_version: shortText(40), android_version: shortText(40),
    impressora_nome: optionalText(120), impressora_endereco: z.string().trim().regex(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i).optional().nullable(),
    bobina_mm: z.union([z.literal(58), z.literal(80)]), codificacao: z.enum(['CP860', 'CP850']), corte_automatico: z.boolean(),
    status: z.enum(['PAREADO', 'INICIANDO', 'PRONTO', 'RECONECTANDO', 'ATENCAO', 'SEM_IMPRESSORA', 'DESCONECTADO', 'ERRO']), erro: optionalText(500),
}).strict();
export const printLeaseSchema = z.object({ lease_token: z.string().min(32).max(500) }).strict();
export const printResultSchema = printLeaseSchema.extend({
    resultado: z.enum(['ENVIADO', 'FALHA_ANTES_ENVIO', 'RESULTADO_INDETERMINADO']),
    erro: optionalText(500),
}).strict();
