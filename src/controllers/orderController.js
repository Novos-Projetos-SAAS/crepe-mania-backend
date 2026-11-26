import { DateTime } from 'luxon';
import { orderService } from '../services/orderService.js';
import { paginated, requestAuditContext, success } from './helpers.js';

function filters(req) {
  const result = { ...req.query, page: Number(req.query.page ?? 1), limit: Math.min(Number(req.query.limit ?? 10), 100) };
  if (result.data_inicio) result.data_inicio = DateTime.fromISO(result.data_inicio, { zone: 'America/Sao_Paulo' }).startOf('day').toUTC().toJSDate();
  if (result.data_fim) result.data_fim = DateTime.fromISO(result.data_fim, { zone: 'America/Sao_Paulo' }).plus({ days: 1 }).startOf('day').toUTC().toJSDate();
  return result;
}

export const orderController = {
  async createPublic(req, res) { const data = await orderService.createPublic(req.body, req.get('idempotency-key'), { method: req.method, endpoint: req.originalUrl, requestId: req.id }); const pending = ['CRIANDO', 'CRIACAO_INCERTA', 'AGUARDANDO_CRIACAO'].includes(data.pagamento?.estado); return success(res, data, data.idempotent_replay ? 200 : pending ? 202 : 201); },
  async track(req, res) { return success(res, await orderService.track(req.params.codigo)); },
  async list(req, res) { const options = filters(req); const result = await orderService.list(options); return paginated(res, result, options.page, options.limit); },
  async createAdmin(req, res) { return success(res, await orderService.createAdmin(req.body, requestAuditContext(req)), 201); },
  async detail(req, res) { return success(res, await orderService.detail(req.params.id)); },
  async update(req, res) { return success(res, await orderService.update(req.params.id, req.body, requestAuditContext(req))); },
  async status(req, res) { return success(res, await orderService.changeStatus(req.params.id, req.body.status, req.body.motivo, req.body.versao, requestAuditContext(req))); },
  async payment(req, res) { return success(res, await orderService.changePayment(req.params.id, req.body.status_pagamento, req.body.motivo, req.body.versao, requestAuditContext(req))); },
  async cancel(req, res) { return success(res, await orderService.cancel(req.params.id, req.body.motivo, req.body.versao, requestAuditContext(req))); },
  async history(req, res) { return success(res, (await orderService.detail(req.params.id)).historico); },
};
