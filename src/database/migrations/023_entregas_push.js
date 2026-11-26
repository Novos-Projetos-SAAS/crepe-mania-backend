import { timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('entregas_push', (table) => {
    table.bigIncrements('id');
    table.bigInteger('notificacao_id').notNullable().references('id').inTable('notificacoes').onDelete('CASCADE');
    table.bigInteger('subscription_id').notNullable().references('id').inTable('push_subscriptions').onDelete('CASCADE');
    table.string('status', 20).notNullable().defaultTo('PENDENTE');
    table.integer('tentativas').notNullable().defaultTo(0);
    table.timestamp('proxima_tentativa_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.text('ultimo_erro_sanitizado');
    timestamps(table, knex);
    table.unique(['notificacao_id', 'subscription_id']);
    table.index(['status', 'proxima_tentativa_em']);
    table.check("status IN ('PENDENTE','ENVIADO','FALHOU','DESCARTADO')", [], 'entregas_push_status_check');
    table.check('tentativas >= 0', [], 'entregas_push_tentativas_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('entregas_push'); }
