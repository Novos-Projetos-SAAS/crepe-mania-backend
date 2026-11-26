import { timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('convites_usuarios', (table) => {
    table.bigIncrements('id');
    table.string('email_normalizado', 254).notNullable();
    table.bigInteger('nivel_acesso_id').notNullable().references('id').inTable('niveis_acesso').onDelete('RESTRICT');
    table.string('token_hash', 64).notNullable().unique();
    table.string('status', 20).notNullable().defaultTo('PENDENTE');
    table.timestamp('expira_em', { useTz: true }).notNullable();
    table.timestamp('aceito_em', { useTz: true });
    table.timestamp('revogado_em', { useTz: true });
    table.bigInteger('criado_por_usuario_id').references('id').inTable('usuarios').onDelete('SET NULL');
    table.bigInteger('aceito_por_usuario_id').references('id').inTable('usuarios').onDelete('SET NULL');
    timestamps(table, knex);
    table.index(['email_normalizado', 'status']);
    table.index(['status', 'expira_em']);
    table.index('criado_por_usuario_id');
    table.check("status IN ('PENDENTE','ACEITO','EXPIRADO','REVOGADO')", [], 'convites_usuarios_status_check');
    table.check("status <> 'ACEITO' OR (aceito_em IS NOT NULL AND aceito_por_usuario_id IS NOT NULL)", [], 'convites_usuarios_aceite_check');
    table.check("status <> 'REVOGADO' OR revogado_em IS NOT NULL", [], 'convites_usuarios_revogacao_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('convites_usuarios'); }
