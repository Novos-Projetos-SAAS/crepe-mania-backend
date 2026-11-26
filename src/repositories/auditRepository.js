import { getDb } from '../database/connection.js';

export class AuditRepository {
  constructor(db) { this.db = db; }
  get database() { return this.db ?? getDb(); }
  insert(data, trx = this.database) { return trx('logs').insert(data); }
}
