import { describe, expect, it, vi } from 'vitest';

function fixture() {
  const row = { id: 'event', tipo: 'novo_pedido_recebido', pedido_id: '1', event_id: 'pedido:1:novo', payload: { pedido_id: '1', event_id: 'pedido:1:novo' }, lease_token: 'lease' };
  const repo = { claimQueue: vi.fn().mockResolvedValueOnce(row).mockResolvedValue(null), order: vi.fn(async () => ({ fluxo_pagamento: 'INFINITEPAY', confirmacao_liberacao_id: 'proof', liberado_operacionalmente_em: new Date() })), finishQueue: vi.fn(), failQueue: vi.fn() };
  return { row, repo, emit: vi.fn() };
}

describe('outbox recuperavel', () => {
  it('repete com event_id estavel apos falha de emissao e finaliza sob lease', async () => {
    const { DomainOutboxService } = await import('../../src/services/domainOutboxService.js');
    const f = fixture();
    f.emit.mockImplementationOnce(() => { throw new Error('transport'); });
    const service = new DomainOutboxService({ repo: f.repo, emit: f.emit });
    await service.processNext();
    expect(f.repo.failQueue).toHaveBeenCalledWith('eventos_outbox', f.row, 'OUTBOX_DELIVERY_FAILED');
    expect(f.repo.finishQueue).not.toHaveBeenCalled();
    f.repo.claimQueue.mockResolvedValueOnce(f.row);
    await service.processNext();
    expect(f.emit).toHaveBeenLastCalledWith('novo_pedido_recebido', expect.objectContaining({ event_id: 'pedido:1:novo' }));
    expect(f.repo.finishQueue).toHaveBeenCalledWith('eventos_outbox', f.row);
  });
  it('nao emite evento forjado para pendente ou cancelado', async () => {
    const { DomainOutboxService } = await import('../../src/services/domainOutboxService.js');
    const f = fixture();
    f.repo.order.mockResolvedValue({ fluxo_pagamento: 'INFINITEPAY', status: 'PENDENTE' });
    await new DomainOutboxService({ repo: f.repo, emit: f.emit }).processNext();
    expect(f.emit).not.toHaveBeenCalled();
    expect(f.repo.finishQueue).toHaveBeenCalled();
  });
});
