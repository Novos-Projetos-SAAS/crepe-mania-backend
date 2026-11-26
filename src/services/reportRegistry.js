import { DateTime } from 'luxon';
import { z } from 'zod';
import { DELIVERY_TYPES, ORDER_CHANNELS, ORDER_STATUS, PAYMENT_STATUS, PRODUCT_TYPES } from '../config/constants.js';
import { REPORT_CODES } from '../config/reportCatalog.js';
import { AppError } from '../utils/AppError.js';

const id = z.string().regex(/^[1-9]\d{0,18}$/);
const text = z.string().trim().max(120);
const date = z.string().date();
const period = { data_inicio: date, data_fim: date };
const schema = (shape) => z.object(shape).strict();

export const REPORT_FILTER_SCHEMAS = {
  faturamento_periodo: schema({ ...period, status: z.enum(ORDER_STATUS).optional(), canal: z.enum(ORDER_CHANNELS).optional() }),
  historico_vendas: schema({ ...period, status: z.enum(ORDER_STATUS).optional(), status_pagamento: z.enum(PAYMENT_STATUS).optional(), tipo_entrega: z.enum(DELIVERY_TYPES).optional(), canal: z.enum(ORDER_CHANNELS).optional(), metodo_pagamento_id: id.optional() }),
  saida_adicionais: schema({ ...period, adicional_id: id.optional() }),
  clientes_frequentes: schema({ ...period, minimo_pedidos: z.coerce.number().int().min(1).max(100).default(2) }),
  listagem_produtos: schema({ busca: text.optional(), categoria_id: id.optional(), tipo: z.enum(PRODUCT_TYPES).optional(), ativo: z.boolean().optional(), disponivel: z.boolean().optional() }),
  listagem_categorias: schema({ busca: text.optional(), ativo: z.boolean().optional() }),
  listagem_pagamentos: schema({ busca: text.optional(), ativo: z.boolean().optional() }),
  ranking_produtos: schema({ ...period, categoria_id: id.optional(), tipo: z.enum(PRODUCT_TYPES).optional() }),
  vendas_categoria: schema({ ...period, categoria_id: id.optional() }),
  entregas_retiradas: schema({ ...period, tipo_entrega: z.enum(DELIVERY_TYPES).optional() }),
};

const EXECUTOR_SQL = {
  faturamento_periodo: 'SELECT public.fn_rel_faturamento_periodo(?::jsonb) AS resultado',
  historico_vendas: 'SELECT public.fn_rel_historico_vendas(?::jsonb) AS resultado',
  saida_adicionais: 'SELECT public.fn_rel_saida_adicionais(?::jsonb) AS resultado',
  clientes_frequentes: 'SELECT public.fn_rel_clientes_frequentes(?::jsonb) AS resultado',
  listagem_produtos: 'SELECT public.fn_rel_listagem_produtos(?::jsonb) AS resultado',
  listagem_categorias: 'SELECT public.fn_rel_listagem_categorias(?::jsonb) AS resultado',
  listagem_pagamentos: 'SELECT public.fn_rel_listagem_pagamentos(?::jsonb) AS resultado',
  ranking_produtos: 'SELECT public.fn_rel_ranking_produtos(?::jsonb) AS resultado',
  vendas_categoria: 'SELECT public.fn_rel_vendas_por_categoria(?::jsonb) AS resultado',
  entregas_retiradas: 'SELECT public.fn_rel_entregas_retiradas(?::jsonb) AS resultado',
};

const PERIOD_REPORTS = new Set([
  'faturamento_periodo', 'historico_vendas', 'saida_adicionais',
  'clientes_frequentes', 'ranking_produtos', 'vendas_categoria', 'entregas_retiradas',
]);

export function defaultReportFilters(code, now = DateTime.now().setZone('America/Sao_Paulo')) {
  if (!PERIOD_REPORTS.has(code)) return {};
  return { data_inicio: now.minus({ days: 30 }).toISODate(), data_fim: now.toISODate() };
}

export function parseReportFilters(code, input = {}) {
  if (!REPORT_CODES.includes(code)) throw new AppError('Relatório não encontrado.', 404, 'REPORT_NOT_FOUND');
  const clean = Object.fromEntries(Object.entries(input || {}).filter(([, value]) => value !== '' && value !== null && value !== undefined));
  const result = REPORT_FILTER_SCHEMAS[code].safeParse({ ...defaultReportFilters(code), ...clean });
  if (!result.success) {
    throw new AppError('Filtros do relatório são inválidos.', 422, 'INVALID_REPORT_FILTERS', result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
  }
  if (PERIOD_REPORTS.has(code)) {
    const start = DateTime.fromISO(result.data.data_inicio, { zone: 'America/Sao_Paulo' }).startOf('day');
    const end = DateTime.fromISO(result.data.data_fim, { zone: 'America/Sao_Paulo' }).startOf('day');
    if (!start.isValid || !end.isValid || end < start || end.diff(start, 'days').days > 365) {
      throw new AppError('Período inválido; limite de 366 dias.', 422, 'INVALID_DATE_RANGE');
    }
  }
  return result.data;
}

export async function executeRegisteredReport(db, code, filters, limit = 2000) {
  const sql = EXECUTOR_SQL[code];
  if (!sql) throw new AppError('Relatório não encontrado.', 404, 'REPORT_NOT_FOUND');
  const bounded = Math.min(Math.max(Number(limit) || 2000, 1), 2000);
  const result = await db.raw(sql, [JSON.stringify({ ...filters, limite: bounded })]);
  return result.rows.map((row) => row.resultado).filter((row) => row && typeof row === 'object' && !Array.isArray(row));
}

export function registeredReportCodes() { return [...REPORT_CODES]; }

