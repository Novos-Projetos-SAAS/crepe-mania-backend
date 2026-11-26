import { timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('infinitepay_credenciais', (table) => {
    table.bigIncrements('id');
    table.string('handle', 100).notNullable();
    table.text('api_key_ciphertext').notNullable();
    table.integer('key_version').notNullable().defaultTo(1);
    table.bigInteger('criado_por_usuario_id').references('id').inTable('usuarios').onDelete('SET NULL');
    table.timestamp('criado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.check("length(trim(handle)) > 0 AND length(api_key_ciphertext) > 0 AND key_version >= 1", [], 'infinitepay_credenciais_conteudo_check');
  });
  await knex.schema.createTable('infinitepay_configuracoes', (table) => {
    table.integer('id').primary().defaultTo(1);
    table.boolean('ativo').notNullable().defaultTo(false);
    table.boolean('pix_habilitado').notNullable().defaultTo(false);
    table.boolean('credito_habilitado').notNullable().defaultTo(false);
    table.string('handle', 100);
    table.bigInteger('credencial_id').references('id').inTable('infinitepay_credenciais').onDelete('RESTRICT');
    table.text('backend_public_url');
    table.text('redirect_url');
    table.integer('assured_installments').notNullable().defaultTo(0);
    table.integer('versao').notNullable().defaultTo(1);
    timestamps(table, knex);
    table.check('id = 1', [], 'infinitepay_configuracoes_singleton_check');
    table.check('NOT pix_habilitado OR credito_habilitado', [], 'infinitepay_configuracoes_modalidades_check');
    table.check('assured_installments BETWEEN 0 AND 12 AND versao >= 1', [], 'infinitepay_configuracoes_versao_check');
    table.check("NOT ativo OR (credito_habilitado AND credencial_id IS NOT NULL AND handle IS NOT NULL AND length(trim(handle)) > 0 AND backend_public_url IS NOT NULL AND backend_public_url LIKE 'https://%' AND redirect_url IS NOT NULL AND redirect_url LIKE 'https://%')", [], 'infinitepay_configuracoes_ativacao_check');
  });
}

export async function down() {
  throw new Error('Rollback bloqueado: preservar credenciais e histórico; realizar reversão por flags.');
}
