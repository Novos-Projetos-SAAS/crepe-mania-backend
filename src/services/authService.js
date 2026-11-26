import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from '../utils/password.js';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AuthRepository } from '../repositories/authRepository.js';
import { AppError } from '../utils/AppError.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { auditService } from './auditService.js';
import { domainEvents } from '../realtime/domainEvents.js';

export class AuthService {
  constructor(repository = new AuthRepository(), audit = auditService) { this.repository = repository; this.audit = audit; }

  requireSecret() {
    if (!env.JWT_SECRET) throw new AppError('Autenticacao ainda nao configurada.', 503, 'AUTH_NOT_CONFIGURED');
    return env.JWT_SECRET;
  }

  accessToken(user, sessionId) {
    return jwt.sign({ sub: String(user.id), sid: sessionId }, this.requireSecret(), { expiresIn: env.ACCESS_TOKEN_TTL, issuer: 'crepe-mania', audience: 'admin' });
  }

  async login(email, password) {
    const user = await this.repository.findUserByEmail(email);
    const result = user?.ativo ? await verifyPassword(password, user.senha_hash) : { valid: false };
    if (!result.valid) throw new AppError('Credenciais invalidas.', 401, 'INVALID_CREDENTIALS');

    // Rehash transparente se os parametros Argon2id mudarem. A condicao evita
    // sobrescrever uma senha alterada em outra requisicao.
    if (result.needsUpgrade) {
      const newHash = await hashPassword(password);
      const changed = await this.repository.upgradePasswordHash(user.id, user.senha_hash, newHash);
      if (!changed) throw new AppError('Credenciais invalidas.', 401, 'INVALID_CREDENTIALS');
    }
    const sessionId = randomUUID();
    const refreshSecret = randomToken(48);
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400000);
    await this.repository.createSession({ id: sessionId, usuario_id: user.id, refresh_token_hash: sha256(refreshSecret), expira_em: expiresAt });
    const safeUser = await this.repository.findActiveUserWithPermissions(user.id);
    return { user: safeUser, access: this.accessToken(user, sessionId), refresh: `${sessionId}.${refreshSecret}` };
  }

  async authenticate(accessToken) {
    if (!accessToken) throw new AppError('Autenticacao necessaria.', 401, 'UNAUTHENTICATED');
    let payload;
    try { payload = jwt.verify(accessToken, this.requireSecret(), { issuer: 'crepe-mania', audience: 'admin' }); }
    catch { throw new AppError('Sessao invalida ou expirada.', 401, 'INVALID_SESSION'); }
    const [user, session] = await Promise.all([
      this.repository.findActiveUserWithPermissions(payload.sub),
      this.repository.findActiveSession(payload.sid, payload.sub),
    ]);
    if (!user || !session) throw new AppError('Sessao revogada ou usuario inativo.', 401, 'INVALID_SESSION');
    return { ...user, sessionId: payload.sid };
  }

  async refresh(compoundToken) {
    if (!compoundToken?.includes('.')) throw new AppError('Refresh token invalido.', 401, 'INVALID_REFRESH');
    const [sessionId, secret] = compoundToken.split('.', 2);
    const db = this.repository.database;
    const result = await db.transaction(async (trx) => {
      const session = await this.repository.findSessionForUpdate(sessionId, trx);
      if (!session || session.revogada_em || new Date(session.expira_em) <= new Date()) throw new AppError('Refresh token expirado ou revogado.', 401, 'INVALID_REFRESH');
      if (session.refresh_token_hash !== sha256(secret)) {
        await this.repository.revokeAll(session.usuario_id, trx);
        return { replayDetected: true, usuarioId: String(session.usuario_id) };
      }
      const user = await this.repository.findActiveUserWithPermissions(session.usuario_id, trx);
      if (!user) throw new AppError('Usuario inativo.', 401, 'INVALID_SESSION');
      const next = randomToken(48);
      await this.repository.updateSession(session.id, { refresh_token_hash: sha256(next), ultimo_uso_em: trx.fn.now() }, trx);
      return { user, access: this.accessToken(user, session.id), refresh: `${session.id}.${next}` };
    });
    if (result.replayDetected) {
      domainEvents.emit('auth_access_revoked', { usuario_id: result.usuarioId });
      throw new AppError('Reutilizacao de refresh token detectada; sessoes revogadas.', 401, 'REFRESH_REPLAY');
    }
    return result;
  }

  async logout(sessionId) {
    await this.repository.updateSession(sessionId, { revogada_em: this.repository.database.fn.now() });
    domainEvents.emit('auth_access_revoked', { session_id: sessionId });
  }

  async logoutAll(userId) {
    await this.repository.revokeAll(userId);
    domainEvents.emit('auth_access_revoked', { usuario_id: String(userId) });
  }

  async changePassword(userId, currentPassword, newPassword, context) {
    const db = this.repository.database;
    await db.transaction(async (trx) => {
      const user = await this.repository.findUserForPasswordUpdate(userId, trx);
      if (!user) throw new AppError('Usuario inativo ou nao encontrado.', 409, 'USER_NOT_ACTIVE');
      const current = await verifyPassword(currentPassword, user.senha_hash);
      if (!current.valid) throw new AppError('Senha atual incorreta.', 422, 'CURRENT_PASSWORD_INVALID');
      const reused = await verifyPassword(newPassword, user.senha_hash);
      if (reused.valid) throw new AppError('A nova senha deve ser diferente da atual.', 422, 'PASSWORD_REUSED');
      const changed = await this.repository.updatePasswordHash(userId, await hashPassword(newPassword), trx);
      if (!changed) throw new AppError('Nao foi possivel alterar a senha.', 409, 'PASSWORD_CHANGE_CONFLICT');
      await this.repository.revokeAll(userId, trx);
      await this.audit.registrar({
        trx, usuarioId: userId, tipo: 'SEGURANCA', acao: 'AUTH.ALTERAR_SENHA',
        descricao: 'Senha alterada pelo proprio usuario; todas as sessoes foram revogadas',
        recursoTipo: 'usuario', recursoId: userId,
        metodo: context.method, endpoint: context.endpoint, requestId: context.requestId,
      });
    });
    domainEvents.emit('auth_access_revoked', { usuario_id: String(userId) });
    return { login_necessario: true };
  }
}

export const authService = new AuthService();
