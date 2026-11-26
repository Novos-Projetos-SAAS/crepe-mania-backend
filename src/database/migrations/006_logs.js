export async function up(knex) {
  await knex.schema.createTable('logs', (table) => {
    table.bigIncrements('id');
    table.bigInteger('usuario_id').references('id').inTable('usuarios').onDelete('SET NULL');
    table.string('tipo', 20).notNullable();
    table.string('acao', 100).notNullable();
    table.text('descricao').notNullable();
    table.string('metodo', 10);
    table.string('endpoint', 500);
    table.uuid('request_id');
    table.string('recurso_tipo', 80);
    table.string('recurso_id', 80);
    table.jsonb('payload').notNullable().defaultTo('{}');
    table.timestamp('criado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['criado_em', 'tipo']);
    table.index(['usuario_id', 'criado_em']);
    table.index('acao');
    table.check("tipo IN ('ACAO','ERRO','SEGURANCA','SISTEMA')", [], 'logs_tipo_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('logs'); }
