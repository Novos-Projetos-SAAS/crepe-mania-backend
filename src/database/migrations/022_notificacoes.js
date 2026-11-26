export async function up(knex) {
  await knex.schema.createTable('notificacoes', (table) => {
    table.bigIncrements('id');
    table.bigInteger('usuario_id').notNullable().references('id').inTable('usuarios').onDelete('CASCADE');
    table.string('tipo', 60).notNullable();
    table.string('titulo', 140).notNullable();
    table.text('corpo').notNullable();
    table.bigInteger('pedido_id').references('id').inTable('pedidos').onDelete('SET NULL');
    table.string('dedup_key', 180).notNullable();
    table.timestamp('lida_em', { useTz: true });
    table.timestamp('criado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['usuario_id', 'dedup_key']);
    table.index(['usuario_id', 'lida_em', 'criado_em']);
  });
}

export async function down(knex) { await knex.schema.dropTable('notificacoes'); }
