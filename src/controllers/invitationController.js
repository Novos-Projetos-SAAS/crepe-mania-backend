import { invitationService } from '../services/invitationService.js';
import { paginated, requestAuditContext, success } from './helpers.js';

const page = (req) => ({ ...req.query, page: Number(req.query.page ?? 1), limit: Math.min(Number(req.query.limit ?? 10), 100) });

export const invitationAdminController = {
  async list(req, res) {
    const query = page(req);
    const result = await invitationService.list(query);
    return paginated(res, result, query.page, query.limit);
  },
  async create(req, res) { return success(res, await invitationService.create(req.body, requestAuditContext(req)), 201); },
  async reissue(req, res) { return success(res, await invitationService.reissue(req.params.id, requestAuditContext(req)), 201); },
  async revoke(req, res) { return success(res, await invitationService.revoke(req.params.id, requestAuditContext(req))); },
};

export const invitationPublicController = {
  async validate(req, res) { return success(res, await invitationService.validate(req.body.token)); },
  async accept(req, res) { return success(res, await invitationService.accept(req.body, requestAuditContext(req)), 201); },
};
