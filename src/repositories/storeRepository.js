import { getDb } from '../database/connection.js';

export class StoreRepository {
  constructor(db) { this.db = db; }
  get database() { return this.db ?? getDb(); }
  config(trx = this.database, lock = false) {
    const query = trx('configuracoes_loja').where({ id: 1 });
    return (lock ? query.forUpdate() : query).first();
  }
  schedules(trx = this.database) { return trx('horarios_funcionamento').where({ ativo: true }).orderBy(['dia_semana', 'hora_inicio']); }
  async updateConfig(data, trx = this.database) { const [row] = await trx('configuracoes_loja').where({ id: 1 }).update({ ...data, atualizado_em: trx.fn.now() }).returning('*'); return row; }
  async replaceSchedules(items, trx) {
    await trx('horarios_funcionamento').delete();
    if (items.length) await trx('horarios_funcionamento').insert(items.map((item) => ({ ...item, hora_inicio: `${item.hora_inicio}:00`, hora_fim: `${item.hora_fim}:00` })));
    return this.schedules(trx);
  }
}
