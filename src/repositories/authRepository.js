import { getDb } from '../database/connection.js';

export class AuthRepository {
  constructor(db) { this.db = db; }
  get database() { return this.db ?? getDb(); }

  async findUserByEmail(email, trx = this.database) {
    return trx('usuarios as u').join('niveis_acesso as n', 'n.id', 'u.nivel_acesso_id')
      .whereRaw('LOWER(u.email) = LOWER(?)', [email]).whereNull('u.deletado_em')
      .select('u.*', 'n.nome as nivel_nome').first();
  }

  async findActiveUserWithPermissions(id, trx = this.database) {
    const user = await trx('usuarios as u').join('niveis_acesso as n', 'n.id', 'u.nivel_acesso_id')
      .where({ 'u.id': id, 'u.ativo': true, 'n.ativo': true }).whereNull('u.deletado_em')
      .select('u.id', 'u.nome', 'u.email', 'n.nome as nivel').first();
    if (!user) return null;
    const rows = await trx('permissoes_usuarios as pu').join('permissoes as p', 'p.id', 'pu.permissao_id')
      .where('pu.usuario_id', id).select('p.nome');
    return { ...user, permissoes: rows.map((row) => row.nome) };
  }

  upgradePasswordHash(userId, previousHash, newHash, trx = this.database) {
    return trx('usuarios')
      .where({ id: userId, senha_hash: previousHash, ativo: true })
      .whereNull('deletado_em')
      .update({ senha_hash: newHash, atualizado_em: trx.fn.now() });
  }

  findUserForPasswordUpdate(userId, trx) {
    return trx('usuarios').where({ id: userId, ativo: true }).whereNull('deletado_em').forUpdate().first();
  }

  updatePasswordHash(userId, passwordHash, trx) {
    return trx('usuarios').where({ id: userId, ativo: true }).whereNull('deletado_em')
      .update({ senha_hash: passwordHash, atualizado_em: trx.fn.now() });
  }

  createSession(data, trx = this.database) { return trx('sessoes').insert(data); }
  findSessionForUpdate(id, trx) { return trx('sessoes').where({ id }).forUpdate().first(); }
  findActiveSession(id, userId, trx = this.database) { return trx('sessoes').where({ id, usuario_id: userId }).whereNull('revogada_em').where('expira_em', '>', trx.fn.now()).first(); }
  updateSession(id, data, trx = this.database) { return trx('sessoes').where({ id }).update(data); }
  revokeAll(userId, trx = this.database) { return trx('sessoes').where({ usuario_id: userId }).whereNull('revogada_em').update({ revogada_em: trx.fn.now() }); }
}
