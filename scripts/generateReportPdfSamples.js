import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPORT_CATALOG_BY_CODE } from '../src/config/reportCatalog.js';
import { generateReportPdf } from '../src/services/reportPdfService.js';

const root = process.cwd();
const output = join(root, 'output', 'pdf');
await mkdir(output, { recursive: true });

const store = {
  nome_fantasia: 'Lanchonete Shirley - TEST',
  telefone: '(18) 0000-0000',
  whatsapp: '(18) 90000-0000',
  endereco_trailer: 'Praça TEST, sem número',
};
const filters = { data_inicio: '2026-10-01', data_fim: '2026-10-30' };

const revenueRows = Array.from({ length: 18 }, (_, index) => ({
  data: `2026-10-${String(index + 1).padStart(2, '0')}`,
  pedidos_validos: index + 3,
  valor_pedidos_validos: `${(index + 3) * 31}.50`,
  pedidos_realizados: index + 2,
  faturamento_realizado: `${(index + 2) * 29}.90`,
  ticket_medio_realizado: '29.90',
}));

const historyRows = Array.from({ length: 54 }, (_, index) => ({
  pedido_id: String(1000 + index),
  criado_em: `2026-10-${String(index % 28 + 1).padStart(2, '0')}T${String(11 + index % 10).padStart(2, '0')}:30:00`,
  cliente: `Cliente TEST ${String(index + 1).padStart(2, '0')}`,
  telefone: `***${String(1000 + index).slice(-4)}`,
  status: index % 3 === 0 ? 'ENTREGUE' : 'PENDENTE',
  status_pagamento: index % 3 === 0 ? 'PAGO' : 'PENDENTE',
  tipo_entrega: index % 2 === 0 ? 'ENTREGA' : 'RETIRADA',
  canal: index % 2 === 0 ? 'WEB' : 'PAINEL',
  metodo_pagamento: index % 2 === 0 ? 'PIX TEST' : 'Dinheiro TEST',
  total: `${24 + index}.50`,
}));

const samples = [
  {
    file: 'etapa-8-faturamento-test.pdf', metadata: REPORT_CATALOG_BY_CODE.faturamento_periodo,
    rows: revenueRows, totals: { pedidos_validos: 207, valor_pedidos_validos: '6520.50', pedidos_realizados: 189, faturamento_realizado: '5651.10', ticket_medio_realizado: '29.90' },
  },
  {
    file: 'etapa-8-historico-vendas-test.pdf', metadata: REPORT_CATALOG_BY_CODE.historico_vendas,
    rows: historyRows, totals: { total: '2754.00' },
  },
];

for (const sample of samples) {
  const buffer = await generateReportPdf({ ...sample, filters, store });
  await writeFile(join(output, sample.file), buffer);
  process.stdout.write(`${sample.file}: ${buffer.length} bytes\n`);
}

