import { describe, expect, it, vi } from 'vitest';
import { processInfinitepayWork } from '../../src/workers/infinitepayWorkers.js';

describe('recuperacao depois do commit', () => {
  it('recupera tentativa que nunca foi enviada, sem reabrir resultado incerto', async () => {
    const payments = { repo: { maintainAttempts: vi.fn(), pendingCheckout: vi.fn(async () => ({ id: 'never-sent' })) }, processInbox: vi.fn(async () => false), checkout: vi.fn() };
    const outbox = { flush: vi.fn() };
    await processInfinitepayWork({ payments, outbox });
    expect(payments.repo.pendingCheckout).toHaveBeenCalledOnce();
    expect(payments.checkout).toHaveBeenCalledWith('never-sent');
    expect(outbox.flush).toHaveBeenCalled();
  });
});
