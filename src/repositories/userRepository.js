import { getDb } from '../database/connection.js';

export function applyUserListFilters(query, { busca, ativo } = {}) {
  if (busca) query.where((builder) => builder.whereILike('u.nome', `%${busca}%`).orWhereILike('u.email', `%${busca}%`));
  if (ativo !== undefined) query.where('u.ativo', ativo);
  return query;
}

export class UserRepository {
  constructor(db) { this.db = db; }
  get database() { return this.db ?? getDb(); }

  async list({ page = 1, limit = 10, busca, ativo } = {}) {
    const query = applyUserListFilters(this.database('usuarios as u').join('niveis_acesso as n', 'n.id', 'u.nivel_acesso_id'), { busca, ativo });
    const [{ total }] = await query.clone().clearSelect().count('* as total');
    const items = await query.select('u.id', 'u.nome', 'u.email', 'u.ativo', 'u.criado_em', 'u.atualizado_em', 'n.id as nivel_acesso_id', 'n.nome as nivel').orderBy([{ column: 'u.nome', order: 'asc' }, { column: 'u.id', order: 'asc' }]).limit(limit).offset((page - 1) * limit);
    return { items, total: Number(total) };
  }

  async detail(id, trx = this.database) {
    const user = await trx('usuarios as u').join('niveis_acesso as n', 'n.id', 'u.nivel_acesso_id').where('u.id', id).whereNull('u.deletado_em').select('u.id', 'u.nome', 'u.email', 'u.ativo', 'u.criado_em', 'u.atualizado_em', 'n.id as nivel_acesso_id', 'n.nome as nivel').first();
    if (!user) return null;
    const permissions = await trx('permissoes_usuarios as pu').join('permissoes as p', 'p.id', 'pu.permissao_id').where('pu.usuario_id', id).select('p.nome').orderBy('p.nome');
    return { ...user, permissoes: permissions.map((item) => item.nome) };
  }
}
