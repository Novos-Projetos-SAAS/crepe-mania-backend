import { REPORT_FUNCTION_SQL, dropReportFunctionSql } from '../reportFunctions.js';
export async function up(knex) { await knex.raw(REPORT_FUNCTION_SQL.saida_adicionais); }
export async function down(knex) { await knex.raw(dropReportFunctionSql('saida_adicionais')); }

