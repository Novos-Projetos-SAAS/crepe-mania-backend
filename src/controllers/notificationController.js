import { pushConfiguration } from '../notifications/pushWorker.js';
import { notificationService } from '../services/notificationService.js';
import { paginated, requestAuditContext, success } from './helpers.js';

export const notificationController = {
  config(_req, res) { return success(res, pushConfiguration()); },
  async subscribe(req, res) { return success(res, await notificationService.subscribe(req.user.id, req.body, requestAuditContext(req)), 201); },
  async unsubscribe(req, res) { await notificationService.unsubscribe(req.user.id, req.body.endpoint, requestAuditContext(req)); return success(res, null, 200, 'Inscricao removida.'); },
  async list(req, res) { const page = Number(req.query.page ?? 1); const limit = Math.min(Number(req.query.limit ?? 10), 100); const result = await notificationService.list(req.user.id, { page, limit }); return paginated(res, result, page, limit); },
  async read(req, res) { return success(res, await notificationService.markRead(req.user.id, req.params.id)); },
  async unread(req, res) { return success(res, { total: await notificationService.unreadCount(req.user.id) }); },
};
