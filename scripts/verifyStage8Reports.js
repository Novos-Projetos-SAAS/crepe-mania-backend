import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { REPORT_FUNCTION_NAMES } from '../src/database/reportFunctions.js';
import { closeDb, getDb } from '../src/database/connection.js';
import { authService } from '../src/services/authService.js';
import { reportService } from '../src/services/reportService.js';
import { signValue } from '../src/utils/crypto.js';

async function verify() {
  if (env.NODE_ENV !== 'development') throw new Error('ABORTADO: ambiente nao e development.');
  if (!env.JWT_SECRET) throw new Error('ABORTADO: JWT_SECRET ausente para o smoke HTTP.');

  const db = getDb();
  const expectedFunctions = Object.values(REPORT_FUNCTION_NAMES).sort();
  const [catalogSummary, functions] = await Promise.all([
    db('catalogo_relatorios')
      .select(db.raw('count(*)::int AS total'), db.raw('count(DISTINCT codigo)::int AS codigos'))
      .first(),
    db('pg_proc as p')
      .join('pg_namespace as n', 'n.oid', 'p.pronamespace')
      .where('n.nspname', 'public')
      .whereIn('p.proname', expectedFunctions)
      .whereRaw("pg_get_function_identity_arguments(p.oid) = 'p_filtros jsonb'")
      .pluck('p.proname'),
  ]);
  if (catalogSummary.total !== 12 || catalogSummary.codigos !== 12) throw new Error('Catalogo nao contem 12 codigos unicos.');
  if (functions.sort().join('|') !== expectedFunctions.join('|')) throw new Error('As 12 funcoes SQL nao foram encontradas.');

  authService.authenticate = async () => ({ id: '0', nivel: 'admin', permissoes: [] });
  reportService.audit = { registrar: async () => undefined };

  const csrf = signValue(randomBytes(24).toString('base64url'), env.JWT_SECRET);
  const origin = env.allowedOrigins[0];
  const app = createApp();
  const mutate = (path) => request(app).post(path)
    .set('Origin', origin)
    .set('x-csrf-token', csrf)
    .set('Cookie', [`ls_access=stage8-readonly`, `ls_csrf=${csrf}`]);
  const filters = { data_inicio: '2026-10-01', data_fim: '2026-10-30' };

  const catalog = await request(app).get('/api/v1/admin/relatorios').set('Cookie', 'ls_access=stage8-readonly');
  const options = await request(app).get('/api/v1/admin/relatorios/opcoes/categorias').set('Cookie', 'ls_access=stage8-readonly');
  const metadata = await request(app).get('/api/v1/admin/relatorios/faturamento_periodo').set('Cookie', 'ls_access=stage8-readonly');
  const preview = await mutate('/api/v1/admin/relatorios/faturamento_periodo/gerar').send({ filtros: filters, page: 1, limit: 10 });
  const pdf = await mutate('/api/v1/admin/relatorios/faturamento_periodo/pdf').send({ filtros: filters });

  const results = {
    catalog: { status: catalog.status, reports: catalog.body?.data?.length },
    options: { status: options.status, source: 'categorias', count: options.body?.data?.length },
    metadata: { status: metadata.status, code: metadata.body?.data?.codigo },
    preview: { status: preview.status, rows: preview.body?.data?.dados?.length, total: preview.body?.data?.paginacao?.total },
    pdf: {
      status: pdf.status,
      content_type: pdf.headers['content-type'],
      attachment: /^attachment; filename="relatorio-faturamento_periodo-/.test(pdf.headers['content-disposition'] ?? ''),
      valid_signature: Buffer.isBuffer(pdf.body) && pdf.body.subarray(0, 5).toString() === '%PDF-',
      bytes: pdf.body?.length,
    },
    database: { reports: catalogSummary.total, unique_codes: catalogSummary.codigos, functions: functions.sort() },
  };
  if ([catalog, options, metadata, preview, pdf].some(({ status }) => status !== 200)) throw new Error(`Smoke HTTP falhou: ${JSON.stringify(results)}`);
  if (catalog.body.data.length !== 12 || metadata.body.data.codigo !== 'faturamento_periodo' || !results.pdf.attachment || !results.pdf.valid_signature) {
    throw new Error(`Contrato dos relatorios divergiu: ${JSON.stringify(results)}`);
  }
  return results;
}

verify()
  .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
  .catch((error) => {
    const safeMessage = String(error?.message ?? error).replace(/postgres(?:ql)?:\/\/\S+/gi, '[REDACTED_DATABASE_URL]');
    process.stderr.write(`${safeMessage}\n`);
    process.exitCode = 1;
  })
  .finally(closeDb);
