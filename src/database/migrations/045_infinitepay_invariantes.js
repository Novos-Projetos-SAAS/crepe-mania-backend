import { INFINITEPAY_GUARDS_SQL } from '../sql/044_infinitepayGuards.js';

export async function up(knex) { await knex.raw(INFINITEPAY_GUARDS_SQL); }

export async function down() {
  throw new Error('Rollback bloqueado: preservar provas e invariantes financeiras; realizar reversão por flags.');
}
