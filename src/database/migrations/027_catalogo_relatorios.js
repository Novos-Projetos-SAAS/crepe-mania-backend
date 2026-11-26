import { timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('catalogo_relatorios', (table) => {
    table.bigIncrements('id');
    table.string('codigo', 80).notNullable().unique();
    table.string('nome', 160).notNullable();
    table.text('descricao').notNullable();
    table.string('grupo', 20).notNullable();
    table.jsonb('filtros_config').notNullable().defaultTo('[]');
    table.jsonb('colunas_config').notNullable().defaultTo('[]');
    table.integer('ordem_exibicao').notNullable().defaultTo(0);
    table.boolean('ativo').notNullable().defaultTo(true);
    table.integer('limite_linhas').notNullable().defaultTo(2000);
    timestamps(table, knex);
    table.check("grupo IN ('GERENCIAL','CADASTRAL')", [], 'catalogo_relatorios_grupo_check');
    table.check('ordem_exibicao >= 0', [], 'catalogo_relatorios_ordem_check');
    table.check('limite_linhas BETWEEN 1 AND 5000', [], 'catalogo_relatorios_limite_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('catalogo_relatorios'); }

