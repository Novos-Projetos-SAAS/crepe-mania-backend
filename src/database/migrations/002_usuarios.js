import { timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('usuarios', (table) => {
    table.bigIncrements('id');
    table.bigInteger('nivel_acesso_id').notNullable().references('id').inTable('niveis_acesso').onDelete('RESTRICT');
    table.string('nome', 120).notNullable();
    table.string('email', 254).notNullable();
    table.string('senha_hash', 255).notNullable();
    table.boolean('ativo').notNullable().defaultTo(true);
    timestamps(table, knex);
    table.timestamp('deletado_em', { useTz: true });
    table.index('nivel_acesso_id');
  });
  await knex.raw('CREATE UNIQUE INDEX usuarios_email_ativo_unique ON usuarios (LOWER(email)) WHERE deletado_em IS NULL');
}

export async function down(knex) { await knex.schema.dropTable('usuarios'); }
