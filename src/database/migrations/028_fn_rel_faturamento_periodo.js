import { REPORT_FUNCTION_SQL, dropReportFunctionSql } from '../reportFunctions.js';
export async function up(knex) { await knex.raw(REPORT_FUNCTION_SQL.faturamento_periodo); }
export async function down(knex) { await knex.raw(dropReportFunctionSql('faturamento_periodo')); }

