




import http from 'node:http';
import { app } from './app.js';
import { env, validateRuntimeEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDb } from './database/connection.js';
import { attachSocket } from './realtime/socket.js';
import { startPushWorker, stopPushWorker } from './notifications/pushWorker.js';
import { startInfinitepayWorkers, stopInfinitepayWorkers } from './workers/infinitepayWorkers.js';

validateRuntimeEnv();
const server = http.createServer(app);
attachSocket(server);
startPushWorker();
startInfinitepayWorkers();

server.listen(env.PORT, () => logger.info({ port: env.PORT }, 'API iniciada'));

async function shutdown(signal) {
  logger.info({ signal }, 'Encerrando API');
  stopPushWorker();
  const stopped = stopInfinitepayWorkers();
  server.close(async () => { await stopped; await closeDb(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
