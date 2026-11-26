import { money, timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('configuracoes_loja', (table) => {
    table.specificType('id', 'smallint').primary();
    table.string('nome_fantasia', 120).notNullable();
    table.string('telefone', 30);
    table.string('whatsapp', 30);
    table.text('endereco_trailer');
    table.text('referencia_trailer');
    table.string('logo_url', 2048);
    money(table, 'taxa_entrega', { defaultValue: 0 });
    table.integer('tempo_estimado_min');
    table.boolean('aceitar_pedidos').notNullable().defaultTo(false);
    table.boolean('imprimir_automaticamente').notNullable().defaultTo(false);
    table.string('nome_impressora', 120);
    table.string('tamanho_papel', 10).notNullable().defaultTo('58mm');
    table.string('timezone', 50).notNullable().defaultTo('America/Sao_Paulo');
    timestamps(table, knex);
    table.check('id = 1', [], 'configuracoes_loja_singleton_check');
    table.check('taxa_entrega >= 0', [], 'configuracoes_loja_taxa_check');
    table.check('tempo_estimado_min IS NULL OR tempo_estimado_min > 0', [], 'configuracoes_loja_tempo_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('configuracoes_loja'); }
