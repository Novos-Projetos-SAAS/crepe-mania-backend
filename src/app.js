import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { requestContext } from './middlewares/requestContext.js';
import { errorHandler, notFound } from './middlewares/errorHandler.js';
import { publicRoutes } from './routes/publicRoutes.js';
import { authRoutes } from './routes/authRoutes.js';
import { adminRoutes } from './routes/adminRoutes.js';
import { printAgentRoutes } from './routes/printAgentRoutes.js';
import { androidPrintAgentRoutes } from './routes/androidPrintAgentRoutes.js';
import { openapi } from './docs/openapi.js';
import { AppError } from './utils/AppError.js';
import { safeRequestPath } from './utils/sanitize.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(pinoHttp({
    logger,
    genReqId: (req) => req.id,
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, path: safeRequestPath(req.url), remoteAddress: req.remoteAddress }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin(origin, callback) { if (!origin || env.allowedOrigins.includes(origin)) return callback(null, true); return callback(new AppError('Origem nao autorizada.', 403, 'ORIGIN_NOT_ALLOWED')); }, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: env.BODY_LIMIT }));
  app.use(cookieParser());
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));
  app.get('/openapi.json', (_req, res) => res.json(openapi));
  app.use('/api/v1', publicRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/agente-impressao/android', androidPrintAgentRoutes);
  app.use('/api/v1/agente-impressao', printAgentRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export const app = createApp();
