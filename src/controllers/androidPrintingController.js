import { domainEvents } from '../realtime/domainEvents.js';
import { androidPrintingService } from '../services/androidPrintingService.js';
import { requestAuditContext, success } from './helpers.js';

export const androidPrintingController = {
  async createPairing(req, res) { return success(res, await androidPrintingService.createPairing(req.body, requestAuditContext(req)), 201); },
  async pair(req, res) { return success(res, await androidPrintingService.pair(req.body), 201); },
  async heartbeat(req, res) { return success(res, await androidPrintingService.heartbeat(req.printDevice.id, req.body)); },
  async rotate(req, res) { return success(res, await androidPrintingService.rotateCredential(req.printDevice.id)); },
  async unlink(req, res) { return success(res, await androidPrintingService.unlink(req.printDevice.id, requestAuditContext(req))); },
  async status(_req, res) { return success(res, await androidPrintingService.adminStatus()); },
  async revoke(req, res) { return success(res, await androidPrintingService.revoke(req.params.id, requestAuditContext(req))); },
  async test(req, res) { return success(res, await androidPrintingService.createTest(requestAuditContext(req)), 201); },
  async reserve(req, res) {
    const job = await androidPrintingService.reserve(req.printDevice);
    return job ? success(res, job) : res.status(204).send();
  },
  async startSending(req, res) { return success(res, await androidPrintingService.startSending(req.printDevice.id, req.params.id, req.body.lease_token)); },
  async jobState(req, res) { return success(res, await androidPrintingService.jobState(req.params.id)); },
  async result(req, res) { return success(res, await androidPrintingService.reportResult(req.printDevice.id, req.params.id, req.body)); },
  events(req, res) {
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    res.write('event: pronto\ndata: {}\n\n');
    const onAvailable = (event) => res.write(`event: impressao_disponivel\ndata: ${JSON.stringify({ job_id: event.job_id })}\n\n`);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
    domainEvents.on('impressao_disponivel', onAvailable);
    req.on('close', () => { clearInterval(heartbeat); domainEvents.off('impressao_disponivel', onAvailable); });
  },
};
