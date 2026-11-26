import { env } from '../config/env.js';
import { authService } from '../services/authService.js';
import { auditService } from '../services/auditService.js';
import { AppError } from '../utils/AppError.js';
import { randomToken, signValue } from '../utils/crypto.js';
import { success } from './helpers.js';

export const sessionCookieOptions = ({
  nodeEnv = env.NODE_ENV,
  sameSite = env.COOKIE_SAMESITE,
  domain = env.COOKIE_DOMAIN,
} = {}) => ({
  httpOnly: true,
  secure: nodeEnv === 'production',
  sameSite,
  domain: domain || undefined,
});
const baseCookie = () => sessionCookieOptions();
const accessMaxAge = () => {
  const match = /^(\d+)(s|m|h|d)$/.exec(env.ACCESS_TOKEN_TTL);
  if (!match) return 15 * 60 * 1000;
  return Number(match[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 })[match[2]];
};
function setSessionCookies(res, tokens) {
  res.cookie('ls_access', tokens.access, { ...baseCookie(), path: '/', maxAge: accessMaxAge() });
  res.cookie('ls_refresh', tokens.refresh, { ...baseCookie(), path: '/api/v1/auth', maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400000 });
}
function clearSessionCookies(res) {
  res.clearCookie('ls_access', { ...baseCookie(), path: '/' });
  res.clearCookie('ls_refresh', { ...baseCookie(), path: '/api/v1/auth' });
}

export const authController = {
  csrf(req, res) {
    if (!env.JWT_SECRET) throw new AppError('Autenticacao ainda nao configurada.', 503, 'AUTH_NOT_CONFIGURED');
    const token = signValue(randomToken(24), env.JWT_SECRET);
    res.cookie('ls_csrf', token, { httpOnly: false, secure: env.NODE_ENV === 'production', sameSite: env.COOKIE_SAMESITE, domain: env.COOKIE_DOMAIN || undefined, path: '/', maxAge: 2 * 60 * 60 * 1000 });
    return success(res, { csrf_token: token });
  },
  async login(req, res) {
    let tokens;
    try {
      tokens = await authService.login(req.body.email, req.body.senha);
    } catch (error) {
      try { await auditService.registrar({ tipo: 'SEGURANCA', acao: 'AUTH.LOGIN_FALHOU', descricao: 'Tentativa de login recusada', metodo: req.method, endpoint: req.originalUrl, requestId: req.id }); } catch { /* o erro original tem precedencia */ }
      throw error;
    }
    setSessionCookies(res, tokens);
    await auditService.registrar({ usuarioId: tokens.user.id, tipo: 'SEGURANCA', acao: 'AUTH.LOGIN', descricao: 'Login administrativo realizado', metodo: req.method, endpoint: req.originalUrl, requestId: req.id, recursoTipo: 'usuario', recursoId: tokens.user.id });
    return success(res, { usuario: tokens.user }, 200, 'Login realizado.');
  },
  async refresh(req, res) { const tokens = await authService.refresh(req.cookies?.ls_refresh); setSessionCookies(res, tokens); return success(res, { usuario: tokens.user }); },
  async logout(req, res) { await auditService.registrar({ usuarioId: req.user.id, tipo: 'SEGURANCA', acao: 'AUTH.LOGOUT', descricao: 'Sessao administrativa encerrada', metodo: req.method, endpoint: req.originalUrl, requestId: req.id, recursoTipo: 'usuario', recursoId: req.user.id }); await authService.logout(req.user.sessionId); clearSessionCookies(res); return success(res, null, 200, 'Sessao encerrada.'); },
  async logoutAll(req, res) { await auditService.registrar({ usuarioId: req.user.id, tipo: 'SEGURANCA', acao: 'AUTH.LOGOUT_ALL', descricao: 'Todas as sessoes administrativas encerradas', metodo: req.method, endpoint: req.originalUrl, requestId: req.id, recursoTipo: 'usuario', recursoId: req.user.id }); await authService.logoutAll(req.user.id); clearSessionCookies(res); return success(res, null, 200, 'Todas as sessoes foram encerradas.'); },
  async changePassword(req, res) {
    const result = await authService.changePassword(req.user.id, req.body.senha_atual, req.body.nova_senha, { method: req.method, endpoint: req.originalUrl, requestId: req.id });
    clearSessionCookies(res);
    return success(res, result, 200, 'Senha alterada. Entre novamente.');
  },
  me(req, res) { return success(res, req.user); },
};
