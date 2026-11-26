import { timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('niveis_acesso', (table) => {
    table.bigIncrements('id');
    table.string('nome', 40).notNullable().unique();
    table.string('descricao', 255);
    table.boolean('ativo').notNullable().defaultTo(true);
    timestamps(table, knex);
  });
}

export async function down(knex) { await knex.schema.dropTable('niveis_acesso'); }
