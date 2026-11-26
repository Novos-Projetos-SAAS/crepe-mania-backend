import { DateTime } from 'luxon';
import { infinitepayPaymentService } from '../services/infinitepayPaymentService.js';
import { infinitepayConfigService } from '../services/infinitepayConfigService.js';
import { domainOutboxService } from '../services/domainOutboxService.js';
import { auditService } from '../services/auditService.js';
import { AppError } from '../utils/AppError.js';
import { success, paginated, requestAuditContext } from './helpers.js';

export function paymentResponseHeaders(_req, res, next) {
  res.set({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
  next();
}

export const infinitepayController = {
  async status(req, res) { const { pagamento } = await infinitepayPaymentService.forCode(req.params.codigo); return success(res, pagamento); },
  async confirm(req, res) {
    const { order } = await infinitepayPaymentService.forCode(req.params.codigo);
    const row = await infinitepayPaymentService.ingest(req.body, 'RETORNO', order.id);
    await infinitepayPaymentService.processInbox(row.id);
    await domainOutboxService.flush();
    const { pagamento } = await infinitepayPaymentService.forCode(req.params.codigo);
    return success(res, pagamento, ['PAGO_VERIFICADO', 'PAGO_EM_REVISAO'].includes(pagamento.estado) ? 200 : 202);
  },
  async webhook(req, res) { await infinitepayPaymentService.ingest(req.body, 'WEBHOOK'); return success(res, { recebido: true }); },
  async configuration(_req, res) { return success(res, await infinitepayConfigService.read()); },
  async updateConfiguration(req, res) { return success(res, await infinitepayConfigService.update(req.body, requestAuditContext(req))); },
  async list(req, res) {
    const query = { ...req.query };
    if (query.data_inicio) query.data_inicio = DateTime.fromISO(query.data_inicio, { zone: 'America/Sao_Paulo' }).startOf('day').toUTC().toISO();
    if (query.data_fim) query.data_fim = DateTime.fromISO(query.data_fim, { zone: 'America/Sao_Paulo' }).plus({ days: 1 }).startOf('day').toUTC().toISO();
    return paginated(res, await infinitepayPaymentService.repo.listPayments(query), req.query.page, req.query.limit);
  },
  async reconcile(req, res) {
    const attempt = await infinitepayPaymentService.repo.attempt(req.params.id);
    if (!attempt) throw new AppError('Tentativa nao encontrada.', 404, 'INFINITEPAY_ATTEMPT_NOT_FOUND');
    const row = await infinitepayPaymentService.ingest(req.body, 'ADMIN', attempt.pedido_id);
    await auditService.registrar({ usuarioId: req.user.id, acao: 'INFINITEPAY.CONCILIAR', descricao: 'Solicitada consulta oficial', recursoTipo: 'pedido', recursoId: attempt.pedido_id, ...requestAuditContext(req), payload: { tentativa_id: attempt.id } });
    await infinitepayPaymentService.processInbox(row.id);
    await domainOutboxService.flush();
    return success(res, await infinitepayPaymentService.view(await infinitepayPaymentService.repo.order(attempt.pedido_id)));
  },
};
