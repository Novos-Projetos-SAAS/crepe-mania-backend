import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { defineConfig } from 'vitest/config';

// O opt-in e capturado antes do dotenv: RUN_DB_INTEGRATION no arquivo .env
// nunca habilita a suite por conta propria.
const explicitIntegrationOptIn = process.env.RUN_DB_INTEGRATION === 'true';
const inheritedSourceNodeEnv = process.env.INTEGRATION_SOURCE_NODE_ENV ?? process.env.NODE_ENV;
const dotenvResult = dotenv.config({ quiet: true });
const sourceCandidates = [
  process.env.INTEGRATION_SOURCE_NODE_ENV,
  inheritedSourceNodeEnv,
  dotenvResult.parsed?.NODE_ENV,
].filter(Boolean);
const sourceNodeEnv = sourceCandidates.includes('production') ? 'production' : (sourceCandidates[0] ?? 'development');
const integrationJwtSecret = randomBytes(48).toString('base64url');
const integrationPrintAgentToken = randomBytes(32).toString('base64url');

// Config separado: somente o comando opt-in de integracao enxerga
// DATABASE_TEST_URL. A suite unitaria sempre limpa URLs no vitest.config.js.
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage/integration',
      include: ['src/**/*.js'],
    },
    env: {
      NODE_ENV: 'test',
      INTEGRATION_SOURCE_NODE_ENV: sourceNodeEnv,
      RUN_DB_INTEGRATION: explicitIntegrationOptIn ? 'true' : 'false',
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      DATABASE_TEST_URL: process.env.DATABASE_TEST_URL ?? '',
      JWT_SECRET: integrationJwtSecret,
      ADMIN_NAME: '',
      ADMIN_EMAIL: '',
      ADMIN_PASSWORD: '',
      ALLOWED_ORIGINS: 'https://integration.example.invalid',
      LOG_LEVEL: 'silent',
      PUSH_ENABLED: 'false',
      PUSH_ENCRYPTION_KEY: '',
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
      VAPID_SUBJECT: '',
      R2_ENABLED: 'false',
      QZ_ENABLED: 'false',
      PRINT_AGENT_TOKEN: integrationPrintAgentToken,
    },
  },
});
