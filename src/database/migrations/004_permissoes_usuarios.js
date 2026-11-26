export async function up(knex) {
  await knex.schema.createTable('permissoes_usuarios', (table) => {
    table.bigIncrements('id');
    table.bigInteger('usuario_id').notNullable().references('id').inTable('usuarios').onDelete('CASCADE');
    table.bigInteger('permissao_id').notNullable().references('id').inTable('permissoes').onDelete('CASCADE');
    table.timestamp('criado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['usuario_id', 'permissao_id']);
    table.index('permissao_id');
  });
}

export async function down(knex) { await knex.schema.dropTable('permissoes_usuarios'); }
