import { DateTime } from 'luxon';
import { getDb } from '../database/connection.js';
import { AppError } from '../utils/AppError.js';
import { neutralizeCsv } from '../utils/sanitize.js';
import { REPORT_CODES } from '../config/reportCatalog.js';
import { auditService } from './auditService.js';
import { defaultReportFilters, executeRegisteredReport, parseReportFilters } from './reportRegistry.js';
import { generateReportPdf, safePdfFilename } from './reportPdfService.js';

function reportDecimalToCents(value) {
  const normalized = String(value ?? '0').trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) throw new AppError('Valor monetário inválido no relatório.', 500, 'INVALID_REPORT_MONEY');
  const negative = normalized.startsWith('-');
  const [whole, decimals = ''] = normalized.replace('-', '').split('.');
  const cents = BigInt(whole) * 100n + BigInt(decimals.padEnd(2, '0'));
  return negative ? -cents : cents;
}

function reportCentsToDecimal(cents) {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function roundedAverage(cents, count) {
  if (!count) return 0n;
  const divisor = BigInt(count);
  return (cents + divisor / 2n) / divisor;
}

export function dateRange(start, end) {
  const zone = 'America/Sao_Paulo';
  const from = DateTime.fromISO(start, { zone }).startOf('day');
  const until = DateTime.fromISO(end, { zone }).plus({ days: 1 }).startOf('day');
  if (!from.isValid || !until.isValid || until <= from || until.diff(from, 'days').days > 366) throw new AppError('Periodo invalido; limite de 366 dias.', 422, 'INVALID_DATE_RANGE');
  return { from: from.toUTC().toJSDate(), until: until.toUTC().toJSDate() };
}

export function aggregateSales(rows) {
  const valid = rows.filter((row) => row.status !== 'CANCELADO' && (
    row.fluxo_pagamento === undefined || row.fluxo_pagamento === 'TRADICIONAL'
    || (row.fluxo_pagamento === 'INFINITEPAY' && row.confirmacao_liberacao_id && row.liberado_operacionalmente_em)
  ));
  const realized = valid.filter((row) => row.status === 'ENTREGUE' && row.status_pagamento === 'PAGO');
  const sum = (list) => list.reduce((total, row) => total + Math.round(Number(row.total) * 100), 0);
  return { pedidos_validos: valid.length, valor_pedidos_validos: (sum(valid) / 100).toFixed(2), pedidos_realizados: realized.length, faturamento_realizado: (sum(realized) / 100).toFixed(2), ticket_medio_realizado: realized.length ? (sum(realized) / 100 / realized.length).toFixed(2) : '0.00' };
}

export class ReportService {
  constructor(dbProvider = getDb, { audit = auditService, pdfGenerator = generateReportPdf } = {}) {
    this.dbProvider = dbProvider;
    this.audit = audit;
    this.pdfGenerator = pdfGenerator;
  }
  baseRange(query, alias = 'p') { const { from, until } = dateRange(query.data_inicio, query.data_fim); return { from, until, col: `${alias}.criado_em` }; }

  normalizeMetadata(row) {
    const parseConfig = (value) => {
      if (Array.isArray(value)) return value;
      if (typeof value !== 'string') return [];
      try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
    };
    return {
      codigo: row.codigo,
      nome: row.nome,
      descricao: row.descricao,
      grupo: row.grupo,
      filtros_config: parseConfig(row.filtros_config),
      colunas_config: parseConfig(row.colunas_config),
      ordem_exibicao: row.ordem_exibicao,
      limite_linhas: row.limite_linhas,
      filtros_padrao: defaultReportFilters(row.codigo),
    };
  }

  async catalog() {
    const rows = await this.dbProvider()('catalogo_relatorios')
      .where({ ativo: true }).whereIn('codigo', REPORT_CODES)
      .select('codigo', 'nome', 'descricao', 'grupo', 'filtros_config', 'colunas_config', 'ordem_exibicao', 'limite_linhas')
      .orderBy(['grupo', 'ordem_exibicao', 'nome']);
    return rows.map((row) => this.normalizeMetadata(row));
  }

  async metadata(code) {
    if (!REPORT_CODES.includes(code)) throw new AppError('Relatório não encontrado.', 404, 'REPORT_NOT_FOUND');
    const row = await this.dbProvider()('catalogo_relatorios')
      .where({ codigo: code, ativo: true })
      .select('codigo', 'nome', 'descricao', 'grupo', 'filtros_config', 'colunas_config', 'ordem_exibicao', 'limite_linhas')
      .first();
    if (!row) throw new AppError('Relatório não encontrado.', 404, 'REPORT_NOT_FOUND');
    return this.normalizeMetadata(row);
  }

  async filterOptions(source) {
    const db = this.dbProvider();
    const queries = {
      categorias: () => db('categorias_produtos').whereNull('deletado_em').select('id', 'nome').orderBy(['ordem_exibicao', 'nome']),
      produtos: () => db('produtos').whereNull('deletado_em').select('id', 'nome').orderBy(['ordem_exibicao', 'nome']),
      adicionais: () => db('adicionais').whereNull('deletado_em').select('id', 'nome').orderBy(['ordem_exibicao', 'nome']),
      'metodos-pagamento': () => db('metodos_pagamento').select('id', 'nome').orderBy(['ordem_exibicao', 'nome']),
    };
    const query = queries[source];
    if (!query) throw new AppError('Fonte de opções inválida.', 404, 'REPORT_OPTIONS_NOT_FOUND');
    return query();
  }

  totals(metadata, rows) {
    const result = {};
    for (const column of metadata.colunas_config.filter((item) => item.totalizar)) {
      if (column.tipo === 'money') {
        const cents = rows.reduce((sum, row) => sum + reportDecimalToCents(row[column.chave] ?? '0.00'), 0n);
        result[column.chave] = reportCentsToDecimal(cents);
      } else if (column.tipo === 'integer') {
        result[column.chave] = rows.reduce((sum, row) => sum + Number(row[column.chave] ?? 0), 0);
      }
    }
    if (metadata.codigo === 'faturamento_periodo') {
      const realized = Number(result.pedidos_realizados ?? 0);
      result.ticket_medio_realizado = reportCentsToDecimal(roundedAverage(reportDecimalToCents(result.faturamento_realizado ?? '0.00'), realized));
    }
    if (metadata.codigo === 'entregas_retiradas') {
      const orders = Number(result.pedidos ?? 0);
      result.ticket_medio = reportCentsToDecimal(roundedAverage(reportDecimalToCents(result.valor_pedidos ?? '0.00'), orders));
    }
    return result;
  }

  appliedFilters(metadata, filters) {
    return metadata.filtros_config
      .filter((filter) => filters[filter.chave] !== undefined)
      .map((filter) => ({ chave: filter.chave, rotulo: filter.rotulo, valor: filters[filter.chave] }));
  }

  async executeDynamic(code, input = {}) {
    const metadata = await this.metadata(code);
    const filters = parseReportFilters(code, input.filtros ?? {});
    const rows = await executeRegisteredReport(this.dbProvider(), code, filters, metadata.limite_linhas);
    return { metadata, filters, rows, totals: this.totals(metadata, rows) };
  }

  async generate(code, input = {}, context) {
    const execution = await this.executeDynamic(code, input);
    const page = Math.max(Number(input.page) || 1, 1);
    const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 100);
    const start = (page - 1) * limit;
    await this.audit.registrar({
      usuarioId: context.user.id, acao: 'RELATORIO.GERAR', descricao: `Relatório ${code} gerado`,
      recursoTipo: 'relatorio', recursoId: code, metodo: context.method, endpoint: context.endpoint, requestId: context.requestId,
      payload: { codigo: code, data_inicio: execution.filters.data_inicio, data_fim: execution.filters.data_fim, total_linhas: execution.rows.length },
    });
    return {
      relatorio: { codigo: execution.metadata.codigo, nome: execution.metadata.nome, descricao: execution.metadata.descricao, grupo: execution.metadata.grupo },
      colunas: execution.metadata.colunas_config,
      dados: execution.rows.slice(start, start + limit),
      totais: execution.totals,
      filtros_aplicados: this.appliedFilters(execution.metadata, execution.filters),
      paginacao: { page, limit, total: execution.rows.length, total_pages: Math.ceil(execution.rows.length / limit) },
      gerado_em: DateTime.now().setZone('America/Sao_Paulo').toISO(),
      mensagem: execution.rows.length ? undefined : 'Nenhum registro encontrado para os filtros informados',
    };
  }

  async pdf(code, input = {}, context) {
    const execution = await this.executeDynamic(code, input);
    const store = await this.dbProvider()('configuracoes_loja').where({ id: 1 }).first();
    const generatedAt = DateTime.now().setZone('America/Sao_Paulo');
    const buffer = await this.pdfGenerator({ ...execution, store, generatedAt });
    await this.audit.registrar({
      usuarioId: context.user.id, acao: 'RELATORIO.EXPORTAR_PDF', descricao: `PDF do relatório ${code} exportado`,
      recursoTipo: 'relatorio', recursoId: code, metodo: context.method, endpoint: context.endpoint, requestId: context.requestId,
      payload: { codigo: code, data_inicio: execution.filters.data_inicio, data_fim: execution.filters.data_fim, total_linhas: execution.rows.length },
    });
    return { buffer, filename: safePdfFilename(code, generatedAt) };
  }

  async sales(query) {
    const db = this.dbProvider(); const { from, until } = this.baseRange(query);
    const rows = await db('vw_pedidos_vendas_elegiveis as p').where('p.criado_em', '>=', from).where('p.criado_em', '<', until).whereNot('p.status', 'CANCELADO')
      .select('p.id', 'p.criado_em', 'p.status', 'p.status_pagamento', 'p.tipo_entrega',
        db.raw('COALESCE(??, ??) AS ??', ['p.metodo_pagamento_confirmado_nome', 'p.metodo_pagamento_nome_snapshot', 'metodo_pagamento_nome_snapshot']),
        'p.subtotal', 'p.taxa_entrega', 'p.total').orderBy('p.criado_em');
    return { criterio_faturamento: 'status=ENTREGUE e status_pagamento=PAGO; cancelados excluidos', ...aggregateSales(rows), items: rows };
  }

  async products(query) {
    const db = this.dbProvider(); const { from, until } = this.baseRange(query);
    return db('itens_pedido as i').join('vw_pedidos_vendas_elegiveis as p', 'p.id', 'i.pedido_id').where('p.criado_em', '>=', from).where('p.criado_em', '<', until).whereNot('p.status', 'CANCELADO')
      .groupBy('i.produto_nome_snapshot').select('i.produto_nome_snapshot as produto').sum({ quantidade: 'i.quantidade' }).sum({ valor: 'i.subtotal' }).orderBy('quantidade', 'desc');
  }

  async additionals(query) {
    const db = this.dbProvider(); const { from, until } = this.baseRange(query);
    return db('itens_pedido_adicionais as a').join('itens_pedido as i', 'i.id', 'a.item_pedido_id').join('vw_pedidos_vendas_elegiveis as p', 'p.id', 'i.pedido_id')
      .where('p.criado_em', '>=', from).where('p.criado_em', '<', until).whereNot('p.status', 'CANCELADO').groupBy('a.nome_snapshot').select('a.nome_snapshot as adicional')
      .sum({ quantidade: db.raw('a.quantidade_por_unidade * i.quantidade') }).sum({ valor: 'a.subtotal' }).orderBy('quantidade', 'desc');
  }

  async payments(query) {
    const db = this.dbProvider(); const { from, until } = this.baseRange(query);
    const method = db.raw('COALESCE(??, ??)', ['p.metodo_pagamento_confirmado_nome', 'p.metodo_pagamento_nome_snapshot']);
    return db('vw_pedidos_vendas_elegiveis as p').where('p.criado_em', '>=', from).where('p.criado_em', '<', until).whereNot('p.status', 'CANCELADO').groupBy(method)
      .select({ metodo: method }).count('* as pedidos').sum({ valor_pedidos_validos: 'p.total' })
      .select(db.raw("SUM(CASE WHEN p.status = 'ENTREGUE' AND p.status_pagamento = 'PAGO' THEN p.total ELSE 0 END) AS faturamento_realizado"))
      .orderBy('pedidos', 'desc');
  }

  async dashboard(query) {
    const [sales, products, payments] = await Promise.all([this.sales(query), this.products(query), this.payments(query)]);
    const db = this.dbProvider(); const { from, until } = this.baseRange(query);
    const byStatus = await db('vw_pedidos_vendas_elegiveis').where('criado_em', '>=', from).where('criado_em', '<', until).groupBy('status').select('status').count('* as total');
    const byDelivery = await db('vw_pedidos_vendas_elegiveis').where('criado_em', '>=', from).where('criado_em', '<', until).whereNot('status', 'CANCELADO').groupBy('tipo_entrega').select('tipo_entrega').count('* as total');
    return { ...sales, por_status: byStatus, entrega_retirada: byDelivery, produtos_mais_vendidos: products.slice(0, 10), pagamentos: payments };
  }

  async salesCsv(query) {
    const report = await this.sales(query);
    const header = ['Pedido', 'Data', 'Status', 'Pagamento', 'Entrega', 'Metodo', 'Subtotal', 'Taxa', 'Total'];
    const lines = report.items.map((row) => [row.id, row.criado_em, row.status, row.status_pagamento, row.tipo_entrega, row.metodo_pagamento_nome_snapshot, row.subtotal, row.taxa_entrega, row.total].map(neutralizeCsv).join(','));
    return `\uFEFF${header.join(',')}\r\n${lines.join('\r\n')}\r\n`;
  }
}

export const reportService = new ReportService();
