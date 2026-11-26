export async function up(knex) {
  await knex.schema.createTable('permissoes', (table) => {
    table.bigIncrements('id');
    table.string('nome', 100).notNullable().unique();
    table.string('descricao', 255).notNullable();
    table.timestamp('criado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex) { await knex.schema.dropTable('permissoes'); }
