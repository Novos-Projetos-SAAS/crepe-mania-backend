import { Router } from 'express';
import { androidPrintingController } from '../controllers/androidPrintingController.js';
import { asyncHandler } from '../controllers/helpers.js';
import { requirePrintDevice } from '../middlewares/printDeviceAuth.js';
import { printPairingLimiter } from '../middlewares/security.js';
import { validate } from '../middlewares/validate.js';
import { idParamsSchema, pairPrintDeviceSchema, printHeartbeatSchema, printLeaseSchema, printResultSchema } from '../validators/schemas.js';

export const androidPrintAgentRoutes = Router();
androidPrintAgentRoutes.post('/parear', printPairingLimiter, validate(pairPrintDeviceSchema), asyncHandler(androidPrintingController.pair));
androidPrintAgentRoutes.use(requirePrintDevice);
androidPrintAgentRoutes.post('/heartbeat', validate(printHeartbeatSchema), asyncHandler(androidPrintingController.heartbeat));
androidPrintAgentRoutes.post('/credencial/rotacionar', asyncHandler(androidPrintingController.rotate));
androidPrintAgentRoutes.post('/credencial/desvincular', asyncHandler(androidPrintingController.unlink));
androidPrintAgentRoutes.get('/eventos', androidPrintingController.events);
androidPrintAgentRoutes.post('/jobs/reservar', asyncHandler(androidPrintingController.reserve));
androidPrintAgentRoutes.get('/jobs/:id/estado', validate(idParamsSchema, 'params'), asyncHandler(androidPrintingController.jobState));
androidPrintAgentRoutes.post('/jobs/:id/iniciar-envio', validate(idParamsSchema, 'params'), validate(printLeaseSchema), asyncHandler(androidPrintingController.startSending));
androidPrintAgentRoutes.post('/jobs/:id/resultado', validate(idParamsSchema, 'params'), validate(printResultSchema), asyncHandler(androidPrintingController.result));
