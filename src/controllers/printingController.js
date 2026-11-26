import { printingService } from '../services/printingService.js';
import { paginated, requestAuditContext, success } from './helpers.js';

export const printingController = {
  async receipt(req, res) { const result = await printingService.receipt(req.params.id, req.query.formato ?? 'texto'); return res.type(result.contentType).send(result.content); },
  async request(req, res) { return success(res, await printingService.request(req.params.id, requestAuditContext(req)), 201); },
  async list(req, res) { const page = Number(req.query.page ?? 1); const limit = Math.min(Number(req.query.limit ?? 10), 100); const result = await printingService.list({ page, limit, status: req.query.status }); return paginated(res, result, page, limit); },
  async detail(req, res) { return success(res, await printingService.detail(req.params.id)); },
  async next(_req, res) { const job = await printingService.next(); return job ? success(res, job) : res.status(204).send(); },
  async ack(req, res) { return success(res, await printingService.ack(req.params.id, req.body)); },
  qzConfig(_req, res) { return success(res, printingService.qzConfiguration()); },
  qzCertificate(_req, res) {
    const certificate = printingService.qzCertificate();
    return res.type('text/plain').send(certificate);
  },
  async qzSign(req, res) { return success(res, { assinatura: await printingService.qzSign(req.body) }); },
};
