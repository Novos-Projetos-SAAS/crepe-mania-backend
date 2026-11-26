import { Router } from 'express';
import { printingController } from '../controllers/printingController.js';
import { asyncHandler } from '../controllers/helpers.js';
import { requirePrintAgent } from '../middlewares/security.js';
import { validate } from '../middlewares/validate.js';
import { idParamsSchema, printAckSchema } from '../validators/schemas.js';

export const printAgentRoutes = Router();
printAgentRoutes.use(requirePrintAgent);
printAgentRoutes.get('/impressoes/proxima', asyncHandler(printingController.next));
printAgentRoutes.post('/impressoes/:id/ack', validate(idParamsSchema, 'params'), validate(printAckSchema), asyncHandler(printingController.ack));
