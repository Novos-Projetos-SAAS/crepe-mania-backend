import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      ALLOWED_ORIGINS: 'http://localhost:3000',
      DATABASE_URL: '',
      DATABASE_TEST_URL: '',
      RUN_DB_INTEGRATION: 'false',
      JWT_SECRET: '',
      LOG_LEVEL: 'silent',
      PUSH_ENABLED: 'false',
      PRINT_AGENT_TOKEN: '',
      QZ_ENABLED: 'false',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage/unit',
      include: ['src/**/*.js'],
    },
  },
});
