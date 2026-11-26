import { timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('horarios_funcionamento', (table) => {
    table.bigIncrements('id');
    table.specificType('dia_semana', 'smallint').notNullable();
    table.time('hora_inicio').notNullable();
    table.time('hora_fim').notNullable();
    table.boolean('ativo').notNullable().defaultTo(true);
    timestamps(table, knex);
    table.unique(['dia_semana', 'hora_inicio', 'hora_fim']);
    table.check('dia_semana BETWEEN 0 AND 6', [], 'horarios_dia_check');
    table.check('hora_inicio <> hora_fim', [], 'horarios_intervalo_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('horarios_funcionamento'); }
