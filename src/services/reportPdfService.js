import PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';

const COLORS = {
  text: '#202124', muted: '#667085', border: '#D7DCE2', stripe: '#F7F8FA',
  header: '#F1E9E6', accent: '#B33A2B', white: '#FFFFFF',
};

const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numberFormatter = new Intl.NumberFormat('pt-BR');

function display(value, type = 'text') {
  if (value === null || value === undefined || value === '') return '-';
  if (type === 'money') return moneyFormatter.format(Number(value));
  if (type === 'integer') return numberFormatter.format(Number(value));
  if (type === 'boolean') return value === true || value === 'true' ? 'Sim' : 'Não';
  if (type === 'percent') return `${numberFormatter.format(Number(value))}%`;
  if (type === 'date') return DateTime.fromISO(String(value), { zone: 'America/Sao_Paulo' }).toFormat('dd/MM/yyyy');
  if (type === 'datetime') return DateTime.fromISO(String(value), { zone: 'America/Sao_Paulo' }).toFormat('dd/MM/yyyy HH:mm');
  return String(value);
}

function filterValue(filter, value) {
  if (value === null || value === undefined || value === '') return null;
  if (filter.tipo === 'date') return display(value, 'date');
  if (filter.tipo === 'boolean') return display(value, 'boolean');
  return String(value).replaceAll('_', ' ').toLocaleLowerCase('pt-BR');
}

function columnWidths(columns, available) {
  const weight = (column) => {
    if (column.tipo === 'integer' || column.tipo === 'boolean') return 0.65;
    if (column.tipo === 'money' || column.tipo === 'percent' || column.tipo === 'date') return 0.9;
    if (column.tipo === 'datetime') return 1.25;
    return 1.5;
  };
  const weights = columns.map(weight);
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => available * value / total);
}

export function safePdfFilename(code, generatedAt = DateTime.now().setZone('America/Sao_Paulo')) {
  const safeCode = String(code).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `relatorio-${safeCode}-${generatedAt.toFormat('yyyyLLdd-HHmm')}.pdf`;
}

export function generateReportPdf({ metadata, filters, rows, totals, store, generatedAt = DateTime.now().setZone('America/Sao_Paulo') }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const landscape = metadata.colunas_config.length > 7;
    const doc = new PDFDocument({
      size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 36,
      bufferPages: true, autoFirstPage: false, info: { Title: metadata.nome, Author: store?.nome_fantasia || 'Crepe Mania' },
    });
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const addPage = () => {
      doc.addPage();
      doc.fillColor(COLORS.text).font('Helvetica');
    };
    addPage();

    const pageWidth = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const companyName = store?.nome_fantasia || 'Crepe Mania';
    doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.accent).text(companyName, { continued: false });
    const contact = [store?.telefone, store?.whatsapp && store.whatsapp !== store.telefone ? `WhatsApp ${store.whatsapp}` : null, store?.endereco_trailer].filter(Boolean).join(' | ');
    if (contact) doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted).text(contact, { width: pageWidth() });
    doc.moveDown(0.55).strokeColor(COLORS.accent).lineWidth(1.5).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
    doc.moveDown(0.7).font('Helvetica-Bold').fontSize(18).fillColor(COLORS.text).text(metadata.nome);
    doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.muted).text(metadata.descricao, { width: pageWidth() });
    doc.moveDown(0.45).fontSize(8.5).text(`Gerado em ${generatedAt.toFormat("dd/MM/yyyy 'às' HH:mm")} - America/Sao_Paulo`);

    const applied = metadata.filtros_config
      .map((filter) => [filter.rotulo, filterValue(filter, filters[filter.chave])])
      .filter(([, value]) => value !== null);
    if (applied.length) {
      doc.moveDown(0.65).font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text).text('Filtros aplicados');
      doc.font('Helvetica').fillColor(COLORS.muted).text(applied.map(([label, value]) => `${label}: ${value}`).join('  |  '), { width: pageWidth() });
    }

    const totalEntries = Object.entries(totals || {});
    if (totalEntries.length) {
      doc.moveDown(0.7);
      const boxTop = doc.y;
      const boxHeight = Math.max(36, Math.ceil(totalEntries.length / (landscape ? 4 : 3)) * 26);
      doc.roundedRect(doc.page.margins.left, boxTop, pageWidth(), boxHeight, 5).fill(COLORS.stripe);
      const perRow = landscape ? 4 : 3;
      const itemWidth = pageWidth() / perRow;
      totalEntries.forEach(([key, value], index) => {
        const column = metadata.colunas_config.find((item) => item.chave === key);
        const x = doc.page.margins.left + (index % perRow) * itemWidth + 9;
        const y = boxTop + Math.floor(index / perRow) * 26 + 7;
        doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(column?.rotulo || key.replaceAll('_', ' '), x, y, { width: itemWidth - 18, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text).text(display(value, column?.tipo), x, y + 10, { width: itemWidth - 18, lineBreak: false });
      });
      doc.y = boxTop + boxHeight + 12;
    } else doc.moveDown(0.7);

    const columns = metadata.colunas_config;
    const widths = columnWidths(columns, pageWidth());
    const headerHeight = 27;
    const bottomLimit = () => doc.page.height - 42;

    const drawTableHeader = () => {
      const y = doc.y;
      doc.rect(doc.page.margins.left, y, pageWidth(), headerHeight).fill(COLORS.header);
      let x = doc.page.margins.left;
      columns.forEach((column, index) => {
        doc.font('Helvetica-Bold').fontSize(7.4).fillColor(COLORS.text).text(column.rotulo, x + 4, y + 7, { width: widths[index] - 8, height: headerHeight - 8, ellipsis: true });
        x += widths[index];
      });
      doc.y = y + headerHeight;
    };

    const newTablePage = () => {
      addPage();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text).text(metadata.nome);
      doc.moveDown(0.4);
      drawTableHeader();
    };

    if (!rows.length) {
      doc.roundedRect(doc.page.margins.left, doc.y, pageWidth(), 54, 5).strokeColor(COLORS.border).stroke();
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text('Nenhum registro encontrado para os filtros informados', doc.page.margins.left + 12, doc.y + 20, { width: pageWidth() - 24, align: 'center' });
    } else {
      drawTableHeader();
      rows.forEach((row, rowIndex) => {
        const values = columns.map((column) => display(row[column.chave], column.tipo));
        const heights = values.map((value, index) => doc.font('Helvetica').fontSize(7.5).heightOfString(value, { width: widths[index] - 8 }));
        const rowHeight = Math.min(62, Math.max(23, ...heights.map((height) => height + 9)));
        if (doc.y + rowHeight > bottomLimit()) newTablePage();
        const y = doc.y;
        if (rowIndex % 2 === 1) doc.rect(doc.page.margins.left, y, pageWidth(), rowHeight).fill(COLORS.stripe);
        let x = doc.page.margins.left;
        columns.forEach((column, index) => {
          const align = ['money', 'integer', 'percent'].includes(column.tipo) ? 'right' : 'left';
          doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.text).text(values[index], x + 4, y + 6, { width: widths[index] - 8, height: rowHeight - 8, align, ellipsis: true });
          x += widths[index];
        });
        doc.strokeColor(COLORS.border).lineWidth(0.35).moveTo(doc.page.margins.left, y + rowHeight).lineTo(doc.page.width - doc.page.margins.right, y + rowHeight).stroke();
        doc.y = y + rowHeight;
      });
    }

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      const footerY = doc.page.height - 27;
      doc.strokeColor(COLORS.border).lineWidth(0.4).moveTo(doc.page.margins.left, footerY - 5).lineTo(doc.page.width - doc.page.margins.right, footerY - 5).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(companyName, doc.page.margins.left, footerY, { lineBreak: false });
      const pageLabel = `Página ${index - range.start + 1} de ${range.count}`;
      const pageLabelWidth = doc.widthOfString(pageLabel);
      doc.text(pageLabel, doc.page.width - doc.page.margins.right - pageLabelWidth, footerY, { lineBreak: false });
    }
    doc.end();
  });
}

