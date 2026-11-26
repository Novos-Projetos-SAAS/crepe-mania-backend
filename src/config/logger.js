import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers.cookie', 'password', 'senha', 'senha_hash',
      'refresh_token', 'access_token', '*.auth', '*.p256dh', 'VAPID_PRIVATE_KEY', 'PUSH_ENCRYPTION_KEY',
      'token', '*.token', 'credencial', '*.credencial', 'codigo_pareamento', '*.codigo_pareamento', 'convite_token', '*.convite_token',
      'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'QZ_PRIVATE_KEY',
      'INFINITEPAY_ENCRYPTION_KEY', 'api_key', '*.api_key', 'apiKey', '*.apiKey',
      'api_key_ciphertext', '*.api_key_ciphertext', 'req.headers["x-api-key"]', '["X-Api-Key"]',
    ],
    censor: '[REDACTED]',
  },
});
