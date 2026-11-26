import { timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('metodos_pagamento', (table) => {
    table.bigIncrements('id');
    table.string('codigo', 40).notNullable().unique();
    table.string('nome', 100).notNullable();
    table.boolean('ativo').notNullable().defaultTo(true);
    table.integer('ordem_exibicao').notNullable().defaultTo(0);
    timestamps(table, knex);
    table.check('ordem_exibicao >= 0', [], 'metodos_pagamento_ordem_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('metodos_pagamento'); }
