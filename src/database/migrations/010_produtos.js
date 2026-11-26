import { money, timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('produtos', (table) => {
    table.bigIncrements('id');
    table.bigInteger('categoria_id').notNullable().references('id').inTable('categorias_produtos').onDelete('RESTRICT');
    table.string('nome', 140).notNullable();
    table.text('descricao');
    table.string('tipo', 20).notNullable();
    money(table, 'preco_base', { nullable: true });
    table.string('imagem_url', 2048);
    table.boolean('ativo').notNullable().defaultTo(false);
    table.boolean('disponivel_hoje').notNullable().defaultTo(false);
    table.integer('ordem_exibicao').notNullable().defaultTo(0);
    timestamps(table, knex);
    table.timestamp('deletado_em', { useTz: true });
    table.index(['categoria_id', 'ativo', 'disponivel_hoje']);
    table.check("tipo IN ('CREPE','PASTEL','PIZZA','BEBIDA','SUCO','ACAI','OUTRO')", [], 'produtos_tipo_check');
    table.check('preco_base IS NULL OR preco_base >= 0', [], 'produtos_preco_check');
    table.check('ordem_exibicao >= 0', [], 'produtos_ordem_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('produtos'); }
