export async function up(knex) {
  await knex.schema.createTable('idempotencia_requisicoes', (table) => {
    table.bigIncrements('id');
    table.string('chave', 200).notNullable().unique();
    table.string('endpoint', 300).notNullable();
    table.string('payload_hash', 64).notNullable();
    table.bigInteger('pedido_id').references('id').inTable('pedidos').onDelete('SET NULL');
    table.jsonb('resultado_json');
    table.string('estado', 20).notNullable().defaultTo('PROCESSANDO');
    table.timestamp('criado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('expira_em', { useTz: true }).notNullable();
    table.index('expira_em');
    table.check("estado IN ('PROCESSANDO','CONCLUIDO','FALHOU')", [], 'idempotencia_estado_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('idempotencia_requisicoes'); }
