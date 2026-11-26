import { REPORT_FUNCTION_SQL, dropReportFunctionSql } from '../reportFunctions.js';
export async function up(knex) { await knex.raw(REPORT_FUNCTION_SQL.entregas_retiradas); }
export async function down(knex) { await knex.raw(dropReportFunctionSql('entregas_retiradas')); }

