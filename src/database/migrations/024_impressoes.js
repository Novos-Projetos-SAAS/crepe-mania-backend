import { timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('impressoes', (table) => {
    table.bigIncrements('id');
    table.bigInteger('pedido_id').notNullable().references('id').inTable('pedidos').onDelete('RESTRICT');
    table.string('tipo', 20).notNullable();
    table.string('origem', 20).notNullable();
    table.string('status', 30).notNullable().defaultTo('PENDENTE');
    table.jsonb('payload_snapshot').notNullable();
    table.integer('tentativas').notNullable().defaultTo(0);
    table.timestamp('lease_ate', { useTz: true });
    table.string('lease_token_hash', 64);
    table.text('ultimo_erro');
    table.bigInteger('solicitado_por_usuario_id').references('id').inTable('usuarios').onDelete('SET NULL');
    timestamps(table, knex);
    table.timestamp('concluido_em', { useTz: true });
    table.index(['status', 'lease_ate']);
    table.index(['pedido_id', 'criado_em']);
    table.check("tipo IN ('COMANDA','REIMPRESSAO')", [], 'impressoes_tipo_check');
    table.check("origem IN ('AUTOMATICA','MANUAL')", [], 'impressoes_origem_check');
    table.check("status IN ('PENDENTE','EM_PROCESSAMENTO','CONCLUIDA','FALHOU')", [], 'impressoes_status_check');
  });
  await knex.raw("CREATE UNIQUE INDEX impressoes_automatica_pedido_unique ON impressoes (pedido_id) WHERE origem = 'AUTOMATICA'");
}

export async function down(knex) { await knex.schema.dropTable('impressoes'); }
