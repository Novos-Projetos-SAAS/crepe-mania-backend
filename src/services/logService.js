import { getDb } from '../database/connection.js';
import { AppError } from '../utils/AppError.js';
import { DateTime } from 'luxon';

export class LogService {
  constructor(dbProvider = getDb) { this.dbProvider = dbProvider; }
  async list({ page = 1, limit = 10, tipo, acao, usuario_id, data_inicio, data_fim }) {
    const db = this.dbProvider();
    const query = db('logs');
    if (tipo) query.where({ tipo }); if (acao) query.whereILike('acao', `%${acao}%`); if (usuario_id) query.where({ usuario_id });
    if (data_inicio) query.where('criado_em', '>=', DateTime.fromISO(data_inicio, { zone: 'America/Sao_Paulo' }).startOf('day').toUTC().toJSDate());
    if (data_fim) query.where('criado_em', '<', DateTime.fromISO(data_fim, { zone: 'America/Sao_Paulo' }).plus({ days: 1 }).startOf('day').toUTC().toJSDate());
    const [{ total }] = await query.clone().count('* as total');
    const items = await query.select('*').orderBy([{ column: 'criado_em', order: 'desc' }, { column: 'id', order: 'desc' }]).limit(limit).offset((page - 1) * limit);
    return { items, total: Number(total) };
  }
  async detail(id) { const row = await this.dbProvider()('logs').where({ id }).first(); if (!row) throw new AppError('Log nao encontrado.', 404, 'LOG_NOT_FOUND'); return row; }
}

export const logService = new LogService();
