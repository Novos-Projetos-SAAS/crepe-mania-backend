import { timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('categorias_produtos', (table) => {
    table.bigIncrements('id');
    table.string('nome', 100).notNullable();
    table.string('slug', 120).notNullable();
    table.text('descricao');
    table.integer('ordem_exibicao').notNullable().defaultTo(0);
    table.boolean('ativo').notNullable().defaultTo(true);
    timestamps(table, knex);
    table.timestamp('deletado_em', { useTz: true });
    table.check('ordem_exibicao >= 0', [], 'categorias_ordem_check');
  });
  await knex.raw('CREATE UNIQUE INDEX categorias_slug_ativo_unique ON categorias_produtos (LOWER(slug)) WHERE deletado_em IS NULL');
}

export async function down(knex) { await knex.schema.dropTable('categorias_produtos'); }
