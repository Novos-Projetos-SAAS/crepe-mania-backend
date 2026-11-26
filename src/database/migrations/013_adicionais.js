import { money, timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('adicionais', (table) => {
    table.bigIncrements('id');
    table.string('nome', 120).notNullable();
    table.text('descricao');
    money(table, 'preco');
    table.boolean('ativo').notNullable().defaultTo(true);
    table.boolean('disponivel_hoje').notNullable().defaultTo(true);
    table.integer('ordem_exibicao').notNullable().defaultTo(0);
    timestamps(table, knex);
    table.timestamp('deletado_em', { useTz: true });
    table.check('preco >= 0', [], 'adicionais_preco_check');
    table.check('ordem_exibicao >= 0', [], 'adicionais_ordem_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('adicionais'); }
