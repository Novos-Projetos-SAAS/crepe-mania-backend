import { describe, expect, it, vi } from 'vitest';
import { InfinitepayRepository } from '../../src/repositories/infinitepayRepository.js';

function fixture(row) {
  const trace = [];
  const updates = [];
  const builder = { where: () => builder, whereIn: () => builder, orWhere: () => builder, orderBy: () => builder, forUpdate: () => { trace.push('job-lock'); return builder; }, skipLocked: () => builder, first: async () => row, select: async () => [row], limit: () => builder, update: (patch) => { trace.push('update'); updates.push(patch); return builder; }, returning: async () => [row] };
  const db = Object.assign(() => builder, { transaction: (callback) => callback(db), fn: { now: () => new Date() } });
  const repo = new InfinitepayRepository(db);
  repo.order = vi.fn(async () => { trace.push('parent-lock'); return { id: '1' }; });
  repo.attempt = vi.fn(async () => { trace.push('attempt-lock'); return row; });
  repo.updateAttempt = vi.fn(async () => { trace.push('attempt-update'); });
  return { repo, trace, updates };
}

describe('ordem dos locks financeiros', () => {
  it('encerra outbox cancelado antes de PROCESSANDO sem bloquear o proximo evento', async () => {
    const { repo, updates } = fixture({ id: 'event', pedido_id: '1', tentativas: 0 });
    repo.order.mockResolvedValue({ id: '1', fluxo_pagamento: 'INFINITEPAY', status: 'CANCELADO', confirmacao_liberacao_id: 'proof', liberado_operacionalmente_em: new Date() });
    await repo.claimQueue('eventos_outbox');
    expect(updates[0]).toMatchObject({ estado: 'CONCLUIDO' });
    expect(updates.some((item) => item.estado === 'PROCESSANDO')).toBe(false);
  });
  it('reserva outbox com pedido antes do lock no evento', async () => {
    const { repo, trace } = fixture({ id: 'event', pedido_id: '1', tentativas: 0 });
    await repo.claimQueue('eventos_outbox');
    expect(trace.indexOf('parent-lock')).toBeGreaterThanOrEqual(0);
    expect(trace.indexOf('parent-lock')).toBeLessThan(trace.indexOf('job-lock'));
  });
  it('expira tentativas somente depois de bloquear o pedido', async () => {
    const { repo, trace } = fixture({ id: 'attempt', pedido_id: '1', estado: 'CRIANDO', criacao_iniciada_em: new Date(0) });
    await repo.maintainAttempts();
    expect(trace.indexOf('parent-lock')).toBeGreaterThanOrEqual(0);
    expect(trace.indexOf('parent-lock')).toBeLessThan(trace.indexOf('attempt-update'));
  });
});
