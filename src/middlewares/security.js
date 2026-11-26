import { createHmac, randomBytes } from 'node:crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { safeEqual, verifySignedValue } from '../utils/crypto.js';

const rateKeySecret = randomBytes(32);
const rateHandler = (req, res) => res.status(429).json({ status: 'fail', code: 'RATE_LIMITED', message: 'Muitas requisicoes. Aguarde antes de tentar novamente.', request_id: req.id });
const limiter = (options) => rateLimit({ standardHeaders: true, legacyHeaders: false, handler: rateHandler, ...options });

export const RATE_LIMIT_POLICIES = Object.freeze({
  login: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 20 }),
  loginAccount: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 5 }),
  refresh: Object.freeze({ windowMs: 5 * 60 * 1000, limit: 30 }),
  publicOrder: Object.freeze({ windowMs: 10 * 60 * 1000, limit: 30 }),
  publicOrderCustomer: Object.freeze({ windowMs: 10 * 60 * 1000, limit: 10 }),
  tracking: Object.freeze({ windowMs: 5 * 60 * 1000, limit: 60 }),
  publicStatus: Object.freeze({ windowMs: 60 * 1000, limit: 120 }),
  push: Object.freeze({ windowMs: 10 * 60 * 1000, limit: 30 }),
  upload: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 20 }),
  invitationValidate: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 30 }),
  invitationAccept: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 10 }),
  printPairing: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 10 }),
  paymentConfirm: Object.freeze({ windowMs: 5 * 60 * 1000, limit: 30 }),
  paymentWebhook: Object.freeze({ windowMs: 60 * 1000, limit: 120 }),
});

export function privacyRateKey(req, scope, identity = '') {
  const ip = ipKeyGenerator(req.ip || req.socket?.remoteAddress || '0.0.0.0');
  const normalized = String(identity || '').trim().toLowerCase().slice(0, 254) || 'ausente';
  return createHmac('sha256', rateKeySecret).update(`${scope}\0${ip}\0${normalized}`).digest('base64url');
}

export function createRateLimiter(name) {
  const policy = RATE_LIMIT_POLICIES[name];
  if (!policy) throw new TypeError(`Rate limiter desconhecido: ${name}`);
  const options = { ...policy };
  if (name === 'loginAccount') options.keyGenerator = (req) => privacyRateKey(req, 'login', req.body?.email);
  if (name === 'refresh') options.keyGenerator = (req) => privacyRateKey(req, 'refresh');
  if (name === 'publicOrderCustomer') options.keyGenerator = (req) => privacyRateKey(req, 'pedido', String(req.body?.cliente?.telefone ?? '').replace(/\D/g, ''));
  if (name === 'push') options.keyGenerator = (req) => privacyRateKey(req, 'push', req.user?.id);
  if (name === 'upload') options.keyGenerator = (req) => privacyRateKey(req, 'upload', req.user?.id);
  if (name === 'invitationValidate') options.keyGenerator = (req) => privacyRateKey(req, 'convite-validar', req.body?.token);
  if (name === 'invitationAccept') options.keyGenerator = (req) => privacyRateKey(req, 'convite-aceitar', req.body?.token);
  return limiter(options);
}

export const loginLimiter = createRateLimiter('login');
export const loginAccountLimiter = createRateLimiter('loginAccount');
export const refreshLimiter = createRateLimiter('refresh');
export const publicOrderLimiter = createRateLimiter('publicOrder');
export const publicOrderCustomerLimiter = createRateLimiter('publicOrderCustomer');
export const trackingLimiter = createRateLimiter('tracking');
export const publicStatusLimiter = createRateLimiter('publicStatus');
export const pushLimiter = createRateLimiter('push');
export const uploadLimiter = createRateLimiter('upload');
export const invitationValidateLimiter = createRateLimiter('invitationValidate');
export const invitationAcceptLimiter = createRateLimiter('invitationAccept');
export const printPairingLimiter = createRateLimiter('printPairing');
export const paymentConfirmLimiter = createRateLimiter('paymentConfirm');
export const paymentWebhookLimiter = createRateLimiter('paymentWebhook');

export function invitationResponseHeaders(_req, res, next) {
  res.set({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  next();
}

export function requireAllowedOrigin(req, _res, next) {
    const origin = req.get('origin');
    if ((!origin && env.NODE_ENV === 'production') || (origin && !env.allowedOrigins.includes(origin))) {
        return next(new AppError('Origem nao autorizada.', 403, 'ORIGIN_NOT_ALLOWED'));
    }
    next();
}

export function requireCsrf(req, _res, next) {
    const header = req.get('x-csrf-token');
    const cookie = req.cookies?.ls_csrf;
    if (!env.JWT_SECRET) return next(new AppError('Autenticacao ainda nao configurada.', 503, 'AUTH_NOT_CONFIGURED'));
    if (!header || !cookie || !safeEqual(header, cookie) || !verifySignedValue(cookie, env.JWT_SECRET)) {
        return next(new AppError('Token CSRF invalido.', 403, 'INVALID_CSRF'));
    }
    next();
}

export function requirePrintAgent(req, _res, next) {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!env.PRINT_AGENT_TOKEN) return next(new AppError('Agente de impressao nao configurado.', 503, 'PRINT_AGENT_DISABLED'));
    if (!token || !safeEqual(token, env.PRINT_AGENT_TOKEN)) return next(new AppError('Token do agente invalido.', 401, 'INVALID_AGENT_TOKEN'));
    next();
}
