import { money, timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('itens_pedido_adicionais', (table) => {
    table.bigIncrements('id');
    table.bigInteger('item_pedido_id').notNullable().references('id').inTable('itens_pedido').onDelete('CASCADE');
    table.bigInteger('adicional_id').references('id').inTable('adicionais').onDelete('SET NULL');
    table.string('nome_snapshot', 120).notNullable();
    table.integer('quantidade_por_unidade').notNullable();
    money(table, 'preco_unitario_snapshot');
    money(table, 'subtotal');
    timestamps(table, knex);
    table.unique(['item_pedido_id', 'adicional_id']);
    table.check('quantidade_por_unidade BETWEEN 1 AND 20', [], 'itens_adicionais_quantidade_check');
    table.check('preco_unitario_snapshot >= 0 AND subtotal >= 0', [], 'itens_adicionais_valores_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('itens_pedido_adicionais'); }
