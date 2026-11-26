import { hashPassword } from '../utils/password.js';
import { UserRepository } from '../repositories/userRepository.js';
import { auditService } from './auditService.js';
import { AppError } from '../utils/AppError.js';
import { verifyPassword } from '../utils/password.js';
import { canReceiveNotifications, revokeNotificationAccess } from './notificationAccess.js';
import { domainEvents } from '../realtime/domainEvents.js';

export class UserService {
  constructor(repository = new UserRepository()) { this.repository = repository; }
  list(query) { return this.repository.list(query); }
  async detail(id) { const user = await this.repository.detail(id); if (!user) throw new AppError('Usuario nao encontrado.', 404, 'USER_NOT_FOUND'); return user; }

  async create(data, context) {
    const db = this.repository.database;
    return db.transaction(async (trx) => {
      const level = await trx('niveis_acesso').where({ id: data.nivel_acesso_id, ativo: true }).first();
      if (!level) throw new AppError('Nivel de acesso invalido.', 422, 'INVALID_ACCESS_LEVEL');
      const exists = await trx('usuarios').whereRaw('LOWER(email) = LOWER(?)', [data.email]).whereNull('deletado_em').first();
      if (exists) throw new AppError('E-mail ja cadastrado.', 409, 'EMAIL_EXISTS');
      const [row] = await trx('usuarios').insert({ nome: data.nome, email: data.email.toLowerCase(), nivel_acesso_id: data.nivel_acesso_id, senha_hash: await hashPassword(data.senha), ativo: true }).returning(['id', 'nome', 'email', 'nivel_acesso_id', 'ativo', 'criado_em']);
      await auditService.registrar({ trx, usuarioId: context.user.id, acao: 'USUARIO.CRIAR', descricao: 'Colaborador criado', recursoTipo: 'usuario', recursoId: row.id, ...context, payload: { id: row.id } });
      return row;
    });
  }

  async update(id, data, context) {
    const db = this.repository.database;
    const result = await db.transaction(async (trx) => {
      const before = await this.repository.detail(id, trx);
      if (!before) throw new AppError('Usuario nao encontrado.', 404, 'USER_NOT_FOUND');
      const removingAdmin = before.nivel === 'admin' && (data.ativo === false || (data.nivel_acesso_id && String(data.nivel_acesso_id) !== String(before.nivel_acesso_id)));
      if (data.ativo === false && String(id) === String(context.user.id)) throw new AppError('Nao e permitido desativar a propria conta.', 409, 'SELF_DEACTIVATION');
      if (removingAdmin) {
        const [{ total }] = await trx('usuarios as u').join('niveis_acesso as n', 'n.id', 'u.nivel_acesso_id').where({ 'u.ativo': true, 'n.nome': 'admin' }).whereNull('u.deletado_em').count('* as total');
        if (Number(total) <= 1) throw new AppError('Nao e permitido remover o ultimo administrador ativo.', 409, 'LAST_ADMIN');
      }
      if (data.email) data.email = data.email.toLowerCase();
      const [row] = await trx('usuarios').where({ id }).update({ ...data, atualizado_em: trx.fn.now() }).returning(['id', 'nome', 'email', 'nivel_acesso_id', 'ativo', 'atualizado_em']);
      if (data.ativo === false || data.nivel_acesso_id) {
        await trx('sessoes').where({ usuario_id: id }).whereNull('revogada_em').update({ revogada_em: trx.fn.now() });
        await revokeNotificationAccess(trx, id, data.ativo === false ? 'Usuario desativado' : 'Nivel de acesso alterado');
      }
      await auditService.registrar({ trx, usuarioId: context.user.id, acao: 'USUARIO.EDITAR', descricao: 'Colaborador alterado', recursoTipo: 'usuario', recursoId: id, ...context, payload: { antes: before, depois: row } });
      return row;
    });
    if (data.ativo === false || data.nivel_acesso_id) domainEvents.emit('auth_access_revoked', { usuario_id: String(id) });
    return result;
  }

  async deactivate(id, context) {
    return this.update(id, { ativo: false, deletado_em: this.repository.database.fn.now() }, context);
  }

  async setPermissions(id, names, context) {
    if (new Set(names).size !== names.length) throw new AppError('Permissoes duplicadas.', 422, 'DUPLICATE_PERMISSION');
    const db = this.repository.database;
    const result = await db.transaction(async (trx) => {
      const user = await this.repository.detail(id, trx);
      if (!user) throw new AppError('Usuario nao encontrado.', 404, 'USER_NOT_FOUND');
      const permissions = names.length ? await trx('permissoes').whereIn('nome', names) : [];
      if (permissions.length !== names.length) throw new AppError('Uma ou mais permissoes nao existem.', 422, 'INVALID_PERMISSION');
      await trx('permissoes_usuarios').where({ usuario_id: id }).delete();
      if (permissions.length) await trx('permissoes_usuarios').insert(permissions.map((permission) => ({ usuario_id: id, permissao_id: permission.id })));
      if (!canReceiveNotifications({ ...user, ativo: user.ativo, deletado_em: null, nivel_ativo: true, permissoes: names })) {
        await revokeNotificationAccess(trx, id, 'Permissao de notificacoes revogada');
      }
      await auditService.registrar({ trx, usuarioId: context.user.id, acao: 'USUARIO.PERMISSOES', descricao: 'Permissoes do colaborador substituidas', recursoTipo: 'usuario', recursoId: id, ...context, payload: { antes: user.permissoes, depois: names } });
      return { usuario_id: id, permissoes: names };
    });
    domainEvents.emit('auth_access_revoked', { usuario_id: String(id) });
    return result;
  }

  async resetPassword(id, newPassword, context) {
    if (String(id) === String(context.user.id)) throw new AppError('Use a troca de senha autenticada para a propria conta.', 409, 'USE_CHANGE_PASSWORD');
    const db = this.repository.database;
    const result = await db.transaction(async (trx) => {
      const target = await trx('usuarios as u').join('niveis_acesso as n', 'n.id', 'u.nivel_acesso_id')
        .where({ 'u.id': id, 'u.ativo': true, 'n.ativo': true }).whereNull('u.deletado_em')
        .select('u.id', 'u.senha_hash', 'n.nome as nivel').forUpdate('u').first();
      if (!target) throw new AppError('Usuario deve estar ativo para redefinir a senha.', 409, 'USER_NOT_ACTIVE');
      if (target.nivel === 'admin' && context.user.nivel !== 'admin') {
        throw new AppError('Somente outro administrador pode redefinir a senha de administrador.', 403, 'ADMIN_RESET_FORBIDDEN');
      }
      const reused = await verifyPassword(newPassword, target.senha_hash);
      if (reused.valid) throw new AppError('A senha temporaria deve ser diferente da atual.', 422, 'PASSWORD_REUSED');
      await trx('usuarios').where({ id }).update({ senha_hash: await hashPassword(newPassword), atualizado_em: trx.fn.now() });
      await trx('sessoes').where({ usuario_id: id }).whereNull('revogada_em').update({ revogada_em: trx.fn.now() });
      await auditService.registrar({
        trx, usuarioId: context.user.id, tipo: 'SEGURANCA', acao: 'USUARIO.REDEFINIR_SENHA',
        descricao: 'Senha de colaborador redefinida e sessoes revogadas',
        recursoTipo: 'usuario', recursoId: id, ...context,
        payload: { usuario_id: String(id), sessoes_revogadas: true },
      });
      return { usuario_id: String(id), sessoes_revogadas: true };
    });
    domainEvents.emit('auth_access_revoked', { usuario_id: String(id) });
    return result;
  }
}

export const userService = new UserService();
