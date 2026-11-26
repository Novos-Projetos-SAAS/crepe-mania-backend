import { REPORT_FUNCTION_SQL, dropReportFunctionSql } from '../reportFunctions.js';
export async function up(knex) { await knex.raw(REPORT_FUNCTION_SQL.vendas_categoria); }
export async function down(knex) { await knex.raw(dropReportFunctionSql('vendas_categoria')); }

