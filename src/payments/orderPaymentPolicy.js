import { AppError } from '../utils/AppError.js';

export function isOperationallyReleased(order) {
  if (!order) return false;
  if (order.fluxo_pagamento == null || order.fluxo_pagamento === 'TRADICIONAL') return true;
  return order.fluxo_pagamento === 'INFINITEPAY' && Boolean(order.liberado_operacionalmente_em && order.confirmacao_liberacao_id && order.status !== 'CANCELADO');
}

export function assertOperationalRelease(order) {
  if (!order || !isOperationallyReleased(order)) throw new AppError('Pedido aguardando confirmacao oficial do pagamento.', 409, 'ORDER_PAYMENT_PENDING');
}

export function assertTraditionalPayment(order) {
  if (order.fluxo_pagamento === 'INFINITEPAY') throw new AppError('Pagamento online e seus valores sao gerenciados pela integracao.', 409, 'ONLINE_PAYMENT_MANAGED');
}

export function applyOperationalFilter(query, alias = 'pedidos') {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias)) throw new Error('Alias invalido');
  return query.whereRaw("(?? = 'TRADICIONAL' OR (?? IS NOT NULL AND ?? IS NOT NULL AND ?? <> 'CANCELADO'))", [`${alias}.fluxo_pagamento`, `${alias}.confirmacao_liberacao_id`, `${alias}.liberado_operacionalmente_em`, `${alias}.status`]);
}

export function validateModalityFlags(config) {
  if (config.pix_habilitado && !config.credito_habilitado) throw new AppError('PIX online exige credito online: o provedor sempre oferece cartao.', 422, 'INFINITEPAY_PIX_REQUIRES_CREDIT');
}

export function deriveOnlinePolicy(config, channel, method) {
  if (channel !== 'WEB' || !config?.ativo) return null;
  validateModalityFlags(config);
  if (method === 'PIX' && config.pix_habilitado) return ['pix', 'credit_card'];
  if (method === 'CREDITO' && config.credito_habilitado) return ['credit_card'];
  return null;
}

export function validatePaymentCheck(result, attempt, identifiers) {
  if (result?.success !== true || result?.paid !== true) throw new AppError('Pagamento ainda nao confirmado pela API oficial.', 202, 'INFINITEPAY_NOT_CONFIRMED');
  if (!Number.isSafeInteger(result.amount) || result.amount < 0 || !Number.isSafeInteger(result.paid_amount) || result.paid_amount < 0 || !Number.isInteger(result.installments) || result.installments < 1 || result.installments > 12 || typeof result.capture_method !== 'string' || !/^[a-z_]{1,30}$/.test(result.capture_method)) {
    throw new AppError('Resposta de pagamento invalida.', 502, 'INFINITEPAY_INVALID_RESPONSE');
  }
  const pairs = [[result.order_nsu, attempt.order_nsu], [result.transaction_nsu, identifiers.transaction_nsu], [result.slug ?? result.invoice_slug, identifiers.slug]];
  if (pairs.some(([actual, expected]) => actual != null && actual !== expected)) throw new AppError('Identidade do pagamento divergente.', 502, 'INFINITEPAY_IDENTITY_MISMATCH');
  return {
    amount: result.amount, paid_amount: result.paid_amount, capture_method: result.capture_method, installments: result.installments,
    elegivel: result.amount === Number(attempt.valor_centavos) && result.paid_amount >= result.amount && attempt.metodos_permitidos.includes(result.capture_method),
  };
}
