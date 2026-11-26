export async function up(knex) {
  await knex.schema.createTable('historico_status_pedidos', (table) => {
    table.bigIncrements('id');
    table.bigInteger('pedido_id').notNullable().references('id').inTable('pedidos').onDelete('RESTRICT');
    table.string('status_anterior', 30);
    table.string('status_novo', 30).notNullable();
    table.bigInteger('usuario_id').references('id').inTable('usuarios').onDelete('SET NULL');
    table.string('origem', 20).notNullable();
    table.text('motivo');
    table.timestamp('criado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['pedido_id', 'criado_em']);
    table.check("origem IN ('WEB','PAINEL','SISTEMA')", [], 'historico_origem_check');
    table.check("status_novo IN ('PENDENTE','EM_PREPARO','PRONTO_PARA_RETIRADA','SAIU_PARA_ENTREGA','ENTREGUE','CANCELADO')", [], 'historico_status_novo_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('historico_status_pedidos'); }
