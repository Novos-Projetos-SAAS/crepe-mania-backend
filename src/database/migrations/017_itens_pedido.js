import { money, timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('itens_pedido', (table) => {
    table.bigIncrements('id');
    table.bigInteger('pedido_id').notNullable().references('id').inTable('pedidos').onDelete('CASCADE');
    table.bigInteger('produto_id').references('id').inTable('produtos').onDelete('SET NULL');
    table.string('produto_nome_snapshot', 140).notNullable();
    table.string('categoria_nome_snapshot', 100).notNullable();
    table.string('tipo_produto_snapshot', 20).notNullable();
    table.integer('quantidade').notNullable();
    money(table, 'preco_base_snapshot');
    money(table, 'preco_unitario');
    money(table, 'subtotal');
    table.text('observacoes');
    timestamps(table, knex);
    table.index('pedido_id');
    table.index('produto_id');
    table.check('quantidade BETWEEN 1 AND 50', [], 'itens_pedido_quantidade_check');
    table.check('preco_base_snapshot >= 0 AND preco_unitario >= 0 AND subtotal >= 0', [], 'itens_pedido_valores_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('itens_pedido'); }
