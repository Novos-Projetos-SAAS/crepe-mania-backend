export async function up(knex) {
  await knex.schema.createTable('sessoes', (table) => {
    table.uuid('id').primary();
    table.bigInteger('usuario_id').notNullable().references('id').inTable('usuarios').onDelete('CASCADE');
    table.string('refresh_token_hash', 64).notNullable().unique();
    table.timestamp('expira_em', { useTz: true }).notNullable();
    table.timestamp('revogada_em', { useTz: true });
    table.timestamp('ultimo_uso_em', { useTz: true });
    table.timestamp('criado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['usuario_id', 'revogada_em']);
  });
}

export async function down(knex) { await knex.schema.dropTable('sessoes'); }
