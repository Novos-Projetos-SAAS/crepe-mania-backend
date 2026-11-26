import { DateTime } from 'luxon';
import { escapeHtml } from '../utils/sanitize.js';

// eslint-disable-next-line no-control-regex
const clean = (value) => String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
const money = (value) => `R$ ${Number(value ?? 0).toFixed(2).replace('.', ',')}`;

function formatOrderDate(value) {
  // Snapshots antigos de segunda via podem ter perdido Date para {}.
  if (value == null || (typeof value === 'object' && !(value instanceof Date))) return 'Data/hora indisponivel';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data/hora indisponivel';
  const zoned = DateTime.fromJSDate(date).setZone('America/Sao_Paulo');
  return zoned.isValid ? zoned.toFormat('dd/LL/yyyy HH:mm') : 'Data/hora indisponivel';
}

function wrap(line, columns) {
  const words = clean(line).split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if (word.length > columns) {
      if (current) lines.push(current);
      for (let index = 0; index < word.length; index += columns) lines.push(word.slice(index, index + columns));
      current = '';
    } else if (!current) current = word;
    else if (`${current} ${word}`.length <= columns) current += ` ${word}`;
    else { lines.push(current); current = word; }
  }
  if (current || !lines.length) lines.push(current);
  return lines;
}

export function receiptLines(order, { columns = 32, secondCopy = false } = {}) {
  const separator = '-'.repeat(columns);
  const lines = [
    'CREPE MANIA',
    ...(secondCopy ? ['*** 2ª VIA ***'] : []),
    separator,
    `PEDIDO #${order.id}`,
    formatOrderDate(order.criado_em),
    `${clean(order.tipo_entrega)} - ${clean(order.cliente_nome)}`,
    `Telefone: ${clean(order.cliente_telefone)}`,
  ];
  if (order.tipo_entrega === 'ENTREGA') {
    lines.push(`Endereco: ${clean(order.endereco_logradouro)}, ${clean(order.endereco_sem_numero ? 'S/N' : order.endereco_numero)}`);
    lines.push(`${clean(order.endereco_bairro)} - ${clean(order.endereco_cidade)}/${clean(order.endereco_uf)}`);
    if (order.endereco_complemento) lines.push(`Compl.: ${clean(order.endereco_complemento)}`);
    if (order.endereco_referencia) lines.push(`Ref.: ${clean(order.endereco_referencia)}`);
  }
  lines.push(separator);
  for (const item of order.itens ?? []) {
    lines.push(`${item.quantidade}x ${clean(item.produto_nome_snapshot)}  ${money(item.subtotal)}`);
    for (const extra of item.adicionais ?? []) lines.push(`  + ${extra.quantidade_por_unidade}x ${clean(extra.nome_snapshot)}`);
    if (item.observacoes) lines.push(`  Obs.: ${clean(item.observacoes)}`);
  }
  lines.push(separator, `Subtotal: ${money(order.subtotal)}`, `Entrega: ${money(order.taxa_entrega)}`, `TOTAL: ${money(order.total)}`, `Pagamento: ${clean(order.metodo_pagamento_confirmado_nome ?? order.metodo_pagamento_nome_snapshot)}`);
  if (order.fluxo_pagamento === 'INFINITEPAY' && order.confirmacao_liberacao_id && order.liberado_operacionalmente_em) lines.push('PAGO ONLINE - NAO COBRAR');
  if (order.precisa_troco) lines.push(`Troco para: ${money(order.troco_para)}`, `Troco previsto: ${money(order.troco_previsto ?? Number(order.troco_para) - Number(order.total))}`);
  if (order.observacoes) lines.push(`Observacoes: ${clean(order.observacoes)}`);
  lines.push(separator, `Codigo: ${clean(order.codigo_acompanhamento)}`);
  return lines.flatMap((line) => line === separator ? [line] : wrap(line, columns));
}

export function formatTextReceipt(order, options) { return `${receiptLines(order, options).join('\n')}\n`; }

export function formatHtmlReceipt(order) {
  const body = receiptLines(order).map((line) => `<div>${escapeHtml(line) || '&nbsp;'}</div>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Comanda #${escapeHtml(order.id)}</title><style>@page{size:58mm auto;margin:2mm}body{width:54mm;margin:0;font:12px/1.35 ui-monospace,monospace;white-space:pre-wrap}div{overflow-wrap:anywhere}</style></head><body>${body}</body></html>`;
}
