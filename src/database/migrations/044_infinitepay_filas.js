import { timestamps } from '../migrationHelpers.js';

function queueColumns(table, knex, name) {
  table.string('estado', 20).notNullable().defaultTo('PENDENTE');
  table.integer('tentativas').notNullable().defaultTo(0);
  table.timestamp('disponivel_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  table.timestamp('lease_ate', { useTz: true });
  table.uuid('lease_token');
  table.string('ultimo_erro', 100);
  timestamps(table, knex);
  table.check("estado IN ('PENDENTE','PROCESSANDO','CONCLUIDO','FALHOU') AND tentativas >= 0", [], `${name}_estado_check`);
  table.check('(lease_ate IS NULL) = (lease_token IS NULL)', [], `${name}_lease_check`);
  table.index(['estado', 'disponivel_em', 'lease_ate'], `${name}_fila_idx`);
}

export async function up(knex) {
  await knex.schema.createTable('infinitepay_inbox', (table) => {
    table.uuid('id').primary();
    table.uuid('tentativa_id').notNullable().references('id').inTable('infinitepay_tentativas').onDelete('RESTRICT');
    table.string('transaction_nsu', 200).notNullable();
    table.string('slug', 200).notNullable();
    table.text('receipt_url');
    table.string('origem', 10).notNullable();
    table.string('event_type', 30).notNullable().defaultTo('paid');
    table.string('dedup_key', 64).notNullable().unique();
    table.jsonb('resultado_json');
    queueColumns(table, knex, 'infinitepay_inbox');
    table.check("origem IN ('WEBHOOK','RETORNO','ADMIN')", [], 'infinitepay_inbox_origem_check');
    table.check("dedup_key ~ '^[a-f0-9]{64}$' AND length(trim(transaction_nsu)) > 0 AND length(trim(slug)) > 0", [], 'infinitepay_inbox_identidade_check');
    table.index('tentativa_id');
  });
  await knex.schema.createTable('eventos_outbox', (table) => {
    table.uuid('id').primary();
    table.bigInteger('pedido_id').notNullable().references('id').inTable('pedidos').onDelete('RESTRICT');
    table.string('tipo', 60).notNullable();
    table.string('event_id', 160).notNullable().unique();
    table.jsonb('payload').notNullable();
    queueColumns(table, knex, 'eventos_outbox');
    table.check("length(trim(tipo)) > 0 AND length(trim(event_id)) > 0 AND jsonb_typeof(payload) = 'object'", [], 'eventos_outbox_payload_check');
    table.index(['pedido_id', 'criado_em'], 'eventos_outbox_pedido_idx');
  });
}

export async function down() {
  throw new Error('Rollback bloqueado: preservar eventos financeiros e entregas; realizar reversão por flags.');
}
