import { ELIGIBLE_ORDERS_VIEW_SQL, REPORT_FUNCTION_SQL } from '../sql/045_reportFunctions.js';

export async function up(knex) {
  await knex.raw(ELIGIBLE_ORDERS_VIEW_SQL);
  for (const sql of Object.values(REPORT_FUNCTION_SQL)) await knex.raw(sql);
}

export async function down() {
  throw new Error('Rollback bloqueado: preservar elegibilidade e histórico financeiro; realizar reversão por flags.');
}
