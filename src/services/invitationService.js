import { env } from '../config/env.js';
import { InvitationRepository } from '../repositories/invitationRepository.js';
import { AppError } from '../utils/AppError.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { hashPassword } from '../utils/password.js';
import { auditService } from './auditService.js';

export const normalizeInvitationEmail = (email) => String(email).trim().toLowerCase();

function effectiveStatus(invitation, now = new Date()) {
  if (invitation.status === 'PENDENTE' && new Date(invitation.expira_em) <= now) return 'EXPIRADO';
  return invitation.status;
}

function serializeInvitation(invitation, now) {
  return {
    id: String(invitation.id),
    email: invitation.email ?? invitation.email_normalizado,
    nivel_acesso_id: String(invitation.nivel_acesso_id),
    nivel: invitation.nivel,
    status: effectiveStatus(invitation, now),
    expira_em: invitation.expira_em,
    aceito_em: invitation.aceito_em ?? null,
    revogado_em: invitation.revogado_em ?? null,
    criado_em: invitation.criado_em,
    atualizado_em: invitation.atualizado_em,
    criado_por_usuario_id: invitation.criado_por_usuario_id == null ? null : String(invitation.criado_por_usuario_id),
    criado_por_nome: invitation.criado_por_nome ?? null,
  };
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

const unavailable = () => new AppError('Convite invalido, expirado ou indisponivel.', 409, 'INVITATION_UNAVAILABLE');

export class InvitationService {
  constructor(repository = new InvitationRepository(), dependencies = {}) {
    this.repository = repository;
    this.audit = dependencies.audit ?? auditService;
    this.config = dependencies.config ?? env;
    this.tokenFactory = dependencies.tokenFactory ?? randomToken;
    this.hashToken = dependencies.hashToken ?? sha256;
    this.passwordHasher = dependencies.passwordHasher ?? hashPassword;
    this.now = dependencies.now ?? (() => new Date());
  }

  async list(query) {
    const result = await this.repository.list(query);
    const now = this.now();
    return { ...result, items: result.items.map((item) => serializeInvitation(item, now)) };
  }

  async create(data, context) {
    const db = this.repository.database;
    const email = normalizeInvitationEmail(data.email);
    return db.transaction(async (trx) => {
      await this.repository.lockEmail(email, trx);
      const level = await this.repository.findLevel(data.nivel_acesso_id, trx);
      if (!level) throw new AppError('Nivel de acesso invalido.', 422, 'INVALID_ACCESS_LEVEL');
      if (level.nome === 'admin' && context.user.nivel !== 'admin') throw new AppError('Somente administradores podem convidar outro administrador.', 403, 'ADMIN_INVITE_FORBIDDEN');
      if (await this.repository.findExistingUserByEmail(email, trx)) throw new AppError('Ja existe um colaborador com este e-mail.', 409, 'EMAIL_EXISTS');
      if (await this.repository.findActivePendingByEmail(email, trx)) throw new AppError('Ja existe um convite pendente para este e-mail.', 409, 'INVITATION_PENDING');
      const rawToken = this.tokenFactory(32);
      const now = this.now();
      const invitation = await this.repository.create({
        email_normalizado: email,
        nivel_acesso_id: data.nivel_acesso_id,
        token_hash: this.hashToken(rawToken),
        status: 'PENDENTE',
        expira_em: new Date(now.getTime() + this.config.INVITE_EXPIRATION_HOURS * 60 * 60 * 1000),
        criado_por_usuario_id: context.user.id,
      }, trx);
      await this.audit.registrar({
        trx, usuarioId: context.user.id, acao: 'CONVITE.CRIAR', descricao: 'Convite de colaborador criado',
        recursoTipo: 'convite_usuario', recursoId: invitation.id, ...context,
        payload: { convite_id: String(invitation.id), nivel_acesso_id: String(data.nivel_acesso_id) },
      });
      return { convite: serializeInvitation({ ...invitation, nivel: level.nome }, now), token: rawToken };
    });
  }

  async reissue(id, context) {
    const db = this.repository.database;
    const reference = await this.repository.findById(id);
    if (!reference) throw new AppError('Convite nao encontrado.', 404, 'INVITATION_NOT_FOUND');
    return db.transaction(async (trx) => {
      await this.repository.lockEmail(reference.email_normalizado, trx);
      const current = await this.repository.findByIdForUpdate(id, trx);
      if (!current) throw new AppError('Convite nao encontrado.', 404, 'INVITATION_NOT_FOUND');
      if (effectiveStatus(current, this.now()) === 'ACEITO') throw new AppError('Convite aceito nao pode ser reemitido.', 409, 'INVITATION_ACCEPTED');
      if (await this.repository.findExistingUserByEmail(current.email_normalizado, trx)) throw new AppError('Ja existe um colaborador com este e-mail.', 409, 'EMAIL_EXISTS');
      const level = await this.repository.findLevel(current.nivel_acesso_id, trx);
      if (!level) throw new AppError('Nivel de acesso do convite nao esta disponivel.', 409, 'INVITATION_LEVEL_UNAVAILABLE');
      if (level.nome === 'admin' && context.user.nivel !== 'admin') throw new AppError('Somente administradores podem convidar outro administrador.', 403, 'ADMIN_INVITE_FORBIDDEN');
      if (current.status !== 'REVOGADO') {
        await this.repository.update(current.id, {
          status: 'REVOGADO', revogado_em: trx.fn.now(),
        }, trx);
      }
      await this.repository.revokeActivePendingByEmail(current.email_normalizado, current.id, trx);
      const rawToken = this.tokenFactory(32);
      const now = this.now();
      const invitation = await this.repository.create({
        email_normalizado: current.email_normalizado,
        nivel_acesso_id: current.nivel_acesso_id,
        token_hash: this.hashToken(rawToken),
        status: 'PENDENTE',
        expira_em: new Date(now.getTime() + this.config.INVITE_EXPIRATION_HOURS * 60 * 60 * 1000),
        criado_por_usuario_id: context.user.id,
      }, trx);
      await this.audit.registrar({
        trx, usuarioId: context.user.id, acao: 'CONVITE.REEMITIR', descricao: 'Convite de colaborador reemitido',
        recursoTipo: 'convite_usuario', recursoId: invitation.id, ...context,
        payload: { convite_anterior_id: String(current.id), convite_id: String(invitation.id) },
      });
      return { convite: serializeInvitation({ ...invitation, nivel: level.nome }, now), token: rawToken };
    });
  }

  async revoke(id, context) {
    const db = this.repository.database;
    return db.transaction(async (trx) => {
      const invitation = await this.repository.findByIdForUpdate(id, trx);
      if (!invitation) throw new AppError('Convite nao encontrado.', 404, 'INVITATION_NOT_FOUND');
      if (effectiveStatus(invitation, this.now()) === 'ACEITO') throw new AppError('Convite aceito nao pode ser revogado.', 409, 'INVITATION_ACCEPTED');
      const row = invitation.status === 'REVOGADO' ? invitation : await this.repository.update(id, {
        status: 'REVOGADO', revogado_em: trx.fn.now(),
      }, trx);
      await this.audit.registrar({
        trx, usuarioId: context.user.id, acao: 'CONVITE.REVOGAR', descricao: 'Convite de colaborador revogado',
        recursoTipo: 'convite_usuario', recursoId: id, ...context, payload: { convite_id: String(id) },
      });
      return serializeInvitation(row, this.now());
    });
  }

  async validate(token) {
    const invitation = await this.repository.findByTokenHash(this.hashToken(token));
    if (!invitation || !invitation.nivel_ativo || effectiveStatus(invitation, this.now()) !== 'PENDENTE') return { valido: false };
    return {
      valido: true,
      email_mascarado: maskEmail(invitation.email_normalizado),
      nivel: invitation.nivel,
      expira_em: invitation.expira_em,
    };
  }

  async accept(data, context) {
    const db = this.repository.database;
    return db.transaction(async (trx) => {
      const invitation = await this.repository.findByTokenHash(this.hashToken(data.token), trx, { forUpdate: true });
      if (!invitation || !invitation.nivel_ativo || effectiveStatus(invitation, this.now()) !== 'PENDENTE') throw unavailable();
      if (await this.repository.findExistingUserByEmail(invitation.email_normalizado, trx)) throw unavailable();
      let user;
      try {
        user = await this.repository.createUser({
          nivel_acesso_id: invitation.nivel_acesso_id,
          nome: data.nome,
          email: invitation.email_normalizado,
          senha_hash: await this.passwordHasher(data.senha),
          ativo: true,
        }, trx);
      } catch (error) {
        if (error?.code === '23505') throw unavailable();
        throw error;
      }
      await this.repository.update(invitation.id, {
        status: 'ACEITO', aceito_em: trx.fn.now(), aceito_por_usuario_id: user.id,
      }, trx);
      await this.audit.registrar({
        trx, usuarioId: user.id, tipo: 'SEGURANCA', acao: 'CONVITE.ACEITAR',
        descricao: 'Convite aceito e conta de colaborador criada', recursoTipo: 'convite_usuario',
        recursoId: invitation.id, metodo: context.method, endpoint: context.endpoint, requestId: context.requestId,
        payload: { convite_id: String(invitation.id), usuario_id: String(user.id) },
      });
      return { aceito: true, login_necessario: true };
    });
  }
}

export const invitationService = new InvitationService();
