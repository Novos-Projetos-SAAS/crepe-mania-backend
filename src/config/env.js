import 'dotenv/config';
import { z } from 'zod';

const booleanString = z.string().default('false').transform((value) => value === 'true');
const optionalSecret = (minimum) => z.preprocess((value) => value === '' ? undefined : value, z.string().min(minimum).optional());
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  APP_PUBLIC_URL: z.string().url().optional().or(z.literal('')),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(2).default(0),
  BODY_LIMIT: z.string().default('256kb'),
  LOG_LEVEL: z.string().default('info'),
  TZ: z.literal('America/Sao_Paulo').default('America/Sao_Paulo'),
  DATABASE_URL: z.string().optional(),
  DATABASE_TEST_URL: z.string().optional(),
  DB_SSL_MODE: z.enum(['require', 'disable']).default('require'),
  DB_SSL_CA: z.string().optional(),
  DB_POOL_MIN: z.coerce.number().int().min(0).default(0),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
  JWT_SECRET: optionalSecret(32),
  ACCESS_TOKEN_TTL: z.string().regex(/^\d+(s|m|h|d)$/).default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  INVITE_EXPIRATION_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  PUSH_ENABLED: booleanString,
  PUSH_ENCRYPTION_KEY: z.string().optional(),
  INFINITEPAY_ENCRYPTION_KEY: optionalSecret(44),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  PUSH_POLL_INTERVAL_MS: z.coerce.number().int().min(5000).default(15000),
  PUSH_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  SOCKET_REVALIDATE_MS: z.coerce.number().int().min(10000).max(300000).default(60000),
  R2_ENABLED: booleanString,
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  IMAGE_UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(10 * 1024 * 1024).default(5 * 1024 * 1024),
  IMAGE_UPLOAD_MAX_PIXELS: z.coerce.number().int().min(1000000).max(80000000).default(40000000),
  PRINT_AGENT_TOKEN: optionalSecret(32),
  PRINT_LEASE_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
  PRINT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  PRINT_PAIRING_TTL_MINUTES: z.coerce.number().int().min(2).max(30).default(10),
  PRINT_DEVICE_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(180),
  PRINT_RETRY_BASE_SECONDS: z.coerce.number().int().min(5).max(600).default(15),
  QZ_ENABLED: booleanString,
  QZ_PRIVATE_KEY: z.string().optional(),
  QZ_CERTIFICATE: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Variaveis de ambiente invalidas: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
}

export const env = {
  ...parsed.data,
  allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean),
};

export function validateRuntimeEnv() {
  const missing = [];
  if (env.INFINITEPAY_ENCRYPTION_KEY) {
    const key = Buffer.from(env.INFINITEPAY_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32 || key.toString('base64') !== env.INFINITEPAY_ENCRYPTION_KEY || env.INFINITEPAY_ENCRYPTION_KEY === env.PUSH_ENCRYPTION_KEY) missing.push('INFINITEPAY_ENCRYPTION_KEY deve ser Base64 de 32 bytes, exclusiva da InfinitePay');
  }
  if (env.NODE_ENV === 'production') {
    if (!env.DATABASE_URL) missing.push('DATABASE_URL');
    if (!env.JWT_SECRET) missing.push('JWT_SECRET (minimo 32 caracteres)');
    if (!process.env.ALLOWED_ORIGINS || !env.allowedOrigins.length) missing.push('ALLOWED_ORIGINS');
  }
  if (env.allowedOrigins.includes('*')) missing.push('ALLOWED_ORIGINS nao pode conter wildcard');
  if (env.allowedOrigins.some((origin) => !/^https?:\/\/[^\s]+$/i.test(origin))) missing.push('ALLOWED_ORIGINS contem origem invalida');
  if (env.PUSH_ENABLED && (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT || !env.PUSH_ENCRYPTION_KEY)) {
    missing.push('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT/PUSH_ENCRYPTION_KEY quando PUSH_ENABLED=true');
  }
  if (env.PUSH_ENABLED && env.PUSH_ENCRYPTION_KEY) {
    const key = Buffer.from(env.PUSH_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32 || key.toString('base64') !== env.PUSH_ENCRYPTION_KEY) missing.push('PUSH_ENCRYPTION_KEY deve ser base64 canonico de 32 bytes');
  }
  if (env.R2_ENABLED && (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET || !env.R2_PUBLIC_BASE_URL)) {
    missing.push('R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET/R2_PUBLIC_BASE_URL quando R2_ENABLED=true');
  }
  if (env.R2_ENABLED && env.R2_PUBLIC_BASE_URL && !env.R2_PUBLIC_BASE_URL.startsWith('https://')) missing.push('R2_PUBLIC_BASE_URL deve usar HTTPS');
  if (env.QZ_ENABLED && (!env.QZ_PRIVATE_KEY || !env.QZ_CERTIFICATE)) {
    missing.push('QZ_PRIVATE_KEY/QZ_CERTIFICATE quando QZ_ENABLED=true');
  }
  if (missing.length) throw new Error(`Configuracao obrigatoria ausente: ${missing.join(', ')}`);
}
