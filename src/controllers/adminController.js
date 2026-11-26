import { getDb } from '../database/connection.js';
import { userService } from '../services/userService.js';
import { logService } from '../services/logService.js';
import { reportService } from '../services/reportService.js';
import { paginated, requestAuditContext, success } from './helpers.js';

const page = (req) => ({ ...req.query, page: Number(req.query.page ?? 1), limit: Math.min(Number(req.query.limit ?? 10), 100) });

export const userController = {
  async list(req, res) { const q = page(req); const result = await userService.list(q); return paginated(res, result, q.page, q.limit); },
  async detail(req, res) { return success(res, await userService.detail(req.params.id)); },
  async create(req, res) { return success(res, await userService.create(req.body, requestAuditContext(req)), 201); },
  async update(req, res) { return success(res, await userService.update(req.params.id, req.body, requestAuditContext(req))); },
  async remove(req, res) { return success(res, await userService.deactivate(req.params.id, requestAuditContext(req))); },
  async permissions(req, res) { return success(res, await userService.setPermissions(req.params.id, req.body.permissoes, requestAuditContext(req))); },
  async resetPassword(req, res) { return success(res, await userService.resetPassword(req.params.id, req.body.nova_senha, requestAuditContext(req)), 200, 'Senha redefinida e sessoes revogadas.'); },
  async permissionCatalog(_req, res) { return success(res, await getDb()('permissoes').select('*').orderBy('nome')); },
  async accessLevels(_req, res) { return success(res, await getDb()('niveis_acesso').where({ ativo: true }).select('*').orderBy('id')); },
};

export const logController = {
  async list(req, res) { const q = page(req); const result = await logService.list(q); return paginated(res, result, q.page, q.limit); },
  async detail(req, res) { return success(res, await logService.detail(req.params.id)); },
};

export const reportController = {
  async catalog(_req, res) { return success(res, await reportService.catalog()); },
  async options(req, res) { return success(res, await reportService.filterOptions(req.params.fonte)); },
  async metadata(req, res) { return success(res, await reportService.metadata(req.params.codigo)); },
  async generate(req, res) { return success(res, await reportService.generate(req.params.codigo, req.body, requestAuditContext(req))); },
  async pdf(req, res) {
    const result = await reportService.pdf(req.params.codigo, req.body, requestAuditContext(req));
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length': String(result.buffer.length),
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.status(200).send(result.buffer);
  },
  async dashboard(req, res) { return success(res, await reportService.dashboard(req.query)); },
  async sales(req, res) { return success(res, await reportService.sales(req.query)); },
  async products(req, res) { return success(res, await reportService.products(req.query)); },
  async additionals(req, res) { return success(res, await reportService.additionals(req.query)); },
  async payments(req, res) { return success(res, await reportService.payments(req.query)); },
  async csv(req, res) { res.type('text/csv; charset=utf-8').attachment('vendas.csv').send(await reportService.salesCsv(req.query)); },
};
