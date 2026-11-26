import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { infinitepayPaymentService } from '../services/infinitepayPaymentService.js';
import { domainOutboxService } from '../services/domainOutboxService.js';

let timer;
let running;
let stopping = false;

export async function processInfinitepayWork({ payments = infinitepayPaymentService, outbox = domainOutboxService } = {}) {
  await payments.repo.maintainAttempts();
  for (let index = 0; index < 5 && await payments.processInbox(); index += 1) { /* bounded work per tick */ }
  await outbox.flush(20);
  const initial = await payments.repo.pendingCheckout();
  if (initial) await payments.checkout(initial.id);
}

export function startInfinitepayWorkers() {
  if (timer || !env.DATABASE_URL || env.NODE_ENV === 'test') return;
  stopping = false;
  const tick = () => {
    if (running || stopping) return;
    running = processInfinitepayWork().catch((error) => {
      if (error.code !== '42P01') logger.warn({ code: error.code ?? 'PAYMENT_WORKER_UNAVAILABLE' }, 'Processamento financeiro aguardando recuperacao');
    }).finally(() => { running = undefined; });
  };
  timer = setInterval(tick, 5000);
  timer.unref();
  tick();
}

export async function stopInfinitepayWorkers() { stopping = true; clearInterval(timer); timer = undefined; await running; }
