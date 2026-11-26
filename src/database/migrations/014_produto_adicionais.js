import { timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('produto_adicionais', (table) => {
    table.bigIncrements('id');
    table.bigInteger('produto_id').notNullable().references('id').inTable('produtos').onDelete('CASCADE');
    table.bigInteger('adicional_id').notNullable().references('id').inTable('adicionais').onDelete('RESTRICT');
    table.integer('max_quantidade_por_item').notNullable().defaultTo(1);
    table.boolean('ativo').notNullable().defaultTo(true);
    timestamps(table, knex);
    table.unique(['produto_id', 'adicional_id']);
    table.index('adicional_id');
    table.check('max_quantidade_por_item BETWEEN 1 AND 20', [], 'produto_adicionais_max_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('produto_adicionais'); }
