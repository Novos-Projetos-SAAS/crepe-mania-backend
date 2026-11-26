import { timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('push_subscriptions', (table) => {
    table.bigIncrements('id');
    table.bigInteger('usuario_id').notNullable().references('id').inTable('usuarios').onDelete('CASCADE');
    table.text('endpoint').notNullable().unique();
    table.text('p256dh').notNullable();
    table.text('auth').notNullable();
    table.bigInteger('expiration_time');
    table.string('dispositivo_nome', 120);
    table.boolean('ativo').notNullable().defaultTo(true);
    table.timestamp('ultimo_sucesso_em', { useTz: true });
    table.timestamp('ultima_falha_em', { useTz: true });
    timestamps(table, knex);
    table.index(['usuario_id', 'ativo']);
  });
}

export async function down(knex) { await knex.schema.dropTable('push_subscriptions'); }
