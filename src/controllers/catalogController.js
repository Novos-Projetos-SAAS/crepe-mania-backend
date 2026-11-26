import { catalogService } from '../services/catalogService.js';
import { paginated, requestAuditContext, success } from './helpers.js';

const queryOptions = (req) => ({ page: Number(req.query.page ?? 1), limit: Math.min(Number(req.query.limit ?? 10), 100), ativo: req.query.ativo, busca: req.query.busca, categoria_id: req.query.categoria_id, arquivado: req.query.arquivado });

export const publicCatalogController = {
  async menu(_req, res) { return success(res, await catalogService.publicMenu()); },
  async product(req, res) { return success(res, await catalogService.publicProduct(req.params.id)); },
  async paymentMethods(_req, res) { return success(res, await catalogService.publicPaymentMethods()); },
};

export function catalogController(entity) {
  return {
    async list(req, res) { const options = queryOptions(req); const result = await catalogService.list(entity, options); return paginated(res, result, options.page, options.limit); },
    async get(req, res) { return success(res, await catalogService.get(entity, req.params.id)); },
    async create(req, res) { return success(res, await catalogService.create(entity, req.body, requestAuditContext(req)), 201); },
    async update(req, res) { return success(res, await catalogService.update(entity, req.params.id, req.body, requestAuditContext(req))); },
    async remove(req, res) { return success(res, await catalogService.remove(entity, req.params.id, requestAuditContext(req)), 200, entity === 'produtos' ? 'Produto arquivado.' : 'Registro desativado.'); },
  };
}

export const productLinksController = {
  async get(req, res) { return success(res, await catalogService.getProductLinks(req.params.id)); },
  async additionals(req, res) { return success(res, await catalogService.replaceLinks('additional', req.params.id, req.body.adicionais, requestAuditContext(req))); },
};

export const productLifecycleController = {
  async deactivate(req, res) { return success(res, await catalogService.deactivateProduct(req.params.id, requestAuditContext(req)), 200, 'Produto desativado.'); },
  async reactivate(req, res) { return success(res, await catalogService.reactivateProduct(req.params.id, requestAuditContext(req)), 200, 'Produto reativado e mantido indisponivel hoje.'); },
  async restore(req, res) { return success(res, await catalogService.restoreProduct(req.params.id, requestAuditContext(req)), 200, 'Produto restaurado como inativo.'); },
};
