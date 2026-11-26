import { AuditRepository } from '../repositories/auditRepository.js';
import { sanitizeAuditPayload } from '../utils/sanitize.js';

export class AuditService {
  constructor(repository = new AuditRepository()) { this.repository = repository; }

  registrar({ trx, usuarioId = null, tipo = 'ACAO', acao, descricao, metodo, endpoint, requestId, recursoTipo, recursoId, payload = {} }) {
    return this.repository.insert({
      usuario_id: usuarioId,
      tipo,
      acao,
      descricao,
      metodo: metodo?.slice(0, 10),
      endpoint: endpoint?.slice(0, 500),
      request_id: requestId,
      recurso_tipo: recursoTipo,
      recurso_id: recursoId == null ? null : String(recursoId),
      payload: sanitizeAuditPayload(payload),
    }, trx);
  }
}

export const auditService = new AuditService();
