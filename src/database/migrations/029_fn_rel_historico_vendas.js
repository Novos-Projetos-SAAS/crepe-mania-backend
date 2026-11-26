import { REPORT_FUNCTION_SQL, dropReportFunctionSql } from '../reportFunctions.js';
export async function up(knex) { await knex.raw(REPORT_FUNCTION_SQL.historico_vendas); }
export async function down(knex) { await knex.raw(dropReportFunctionSql('historico_vendas')); }

