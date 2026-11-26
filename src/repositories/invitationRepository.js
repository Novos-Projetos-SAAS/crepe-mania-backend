import { getDb } from '../database/connection.js';

export class InvitationRepository {
  constructor(db) { this.db = db; }
  get database() { return this.db ?? getDb(); }

  async list({ page = 1, limit = 10, busca, status } = {}) {
    const db = this.database;
    const query = db('convites_usuarios as c')
      .join('niveis_acesso as n', 'n.id', 'c.nivel_acesso_id')
      .leftJoin('usuarios as criador', 'criador.id', 'c.criado_por_usuario_id');
    if (busca) query.whereILike('c.email_normalizado', `%${busca.toLowerCase()}%`);
    if (status === 'PENDENTE') query.where({ 'c.status': 'PENDENTE' }).where('c.expira_em', '>', db.fn.now());
    else if (status === 'EXPIRADO') query.where((builder) => builder.where({ 'c.status': 'EXPIRADO' }).orWhere((nested) => nested.where({ 'c.status': 'PENDENTE' }).where('c.expira_em', '<=', db.fn.now())));
    else if (status) query.where({ 'c.status': status });
    const [{ total }] = await query.clone().clearSelect().clearOrder().count('* as total');
    const items = await query
      .select(
        'c.id', 'c.email_normalizado as email', 'c.nivel_acesso_id', 'n.nome as nivel',
        'c.expira_em', 'c.aceito_em', 'c.revogado_em', 'c.criado_em', 'c.atualizado_em',
        'c.criado_por_usuario_id', 'criador.nome as criado_por_nome',
        db.raw("CASE WHEN c.status = 'PENDENTE' AND c.expira_em <= CURRENT_TIMESTAMP THEN 'EXPIRADO' ELSE c.status END AS status"),
      )
      .orderBy([{ column: 'c.criado_em', order: 'desc' }, { column: 'c.id', order: 'desc' }])
      .limit(limit)
      .offset((page - 1) * limit);
    return { items, total: Number(total) };
  }

  lockEmail(email, trx) {
    return trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`convite:${email}`]);
  }

  findActivePendingByEmail(email, trx) {
    return trx('convites_usuarios').where({ email_normalizado: email, status: 'PENDENTE' })
      .where('expira_em', '>', trx.fn.now()).forUpdate().first();
  }

  findExistingUserByEmail(email, trx) {
    return trx('usuarios').whereRaw('LOWER(email) = ?', [email]).whereNull('deletado_em').first();
  }

  findLevel(id, trx) {
    return trx('niveis_acesso').where({ id, ativo: true }).first();
  }

  async findByTokenHash(tokenHash, trx = this.database, { forUpdate = false } = {}) {
    let query = trx('convites_usuarios as c')
      .join('niveis_acesso as n', 'n.id', 'c.nivel_acesso_id')
      .where({ 'c.token_hash': tokenHash })
      .select('c.*', 'n.nome as nivel', 'n.ativo as nivel_ativo');
    if (forUpdate) query = query.forUpdate('c');
    return query.first();
  }

  findByIdForUpdate(id, trx) {
    return trx('convites_usuarios').where({ id }).forUpdate().first();
  }

  findById(id, trx = this.database) {
    return trx('convites_usuarios').where({ id }).first();
  }

  async create(data, trx) {
    const [row] = await trx('convites_usuarios').insert(data).returning('*');
    return row;
  }

  async createUser(data, trx) {
    const [row] = await trx('usuarios').insert(data).returning(['id', 'nome', 'email', 'nivel_acesso_id', 'ativo', 'criado_em']);
    return row;
  }

  async update(id, data, trx) {
    const [row] = await trx('convites_usuarios').where({ id }).update({ ...data, atualizado_em: trx.fn.now() }).returning('*');
    return row;
  }

  revokeActivePendingByEmail(email, exceptId, trx) {
    let query = trx('convites_usuarios').where({ email_normalizado: email, status: 'PENDENTE' })
      .where('expira_em', '>', trx.fn.now());
    if (exceptId != null) query = query.whereNot({ id: exceptId });
    return query.update({ status: 'REVOGADO', revogado_em: trx.fn.now(), atualizado_em: trx.fn.now() });
  }
}
