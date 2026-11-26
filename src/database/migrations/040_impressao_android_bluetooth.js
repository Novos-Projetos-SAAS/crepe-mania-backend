import { timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('dispositivos_impressao', (table) => {
    table.bigIncrements('id');
    table.string('installation_id', 100).notNullable().unique();
    table.string('nome', 120).notNullable();
    table.string('credencial_hash', 64).notNullable().unique();
    table.timestamp('credencial_expira_em', { useTz: true }).notNullable();
    table.string('status', 20).notNullable().defaultTo('ATIVO');
    table.boolean('turno_ativo').notNullable().defaultTo(false);
    table.string('app_version', 40);
    table.string('android_version', 40);
    table.string('impressora_nome', 120);
    table.string('impressora_endereco', 32);
    table.integer('bobina_mm').notNullable().defaultTo(58);
    table.string('codificacao', 16).notNullable().defaultTo('CP860');
    table.boolean('corte_automatico').notNullable().defaultTo(false);
    table.string('ultimo_status', 40).notNullable().defaultTo('PAREADO');
    table.text('ultimo_erro');
    table.timestamp('pareado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('ultimo_contato_em', { useTz: true });
    table.timestamp('revogado_em', { useTz: true });
    timestamps(table, knex);
    table.index(['status', 'ultimo_contato_em']);
    table.check("status IN ('ATIVO','REVOGADO')", [], 'dispositivos_impressao_status_check');
    table.check('bobina_mm IN (58,80)', [], 'dispositivos_impressao_bobina_check');
    table.check("codificacao IN ('CP860','CP850')", [], 'dispositivos_impressao_codificacao_check');
  });

  await knex.schema.createTable('pareamentos_impressao', (table) => {
    table.bigIncrements('id');
    table.string('codigo_hash', 64).notNullable().unique();
    table.bigInteger('criado_por_usuario_id').references('id').inTable('usuarios').onDelete('SET NULL');
    table.bigInteger('dispositivo_id').references('id').inTable('dispositivos_impressao').onDelete('SET NULL');
    table.timestamp('expira_em', { useTz: true }).notNullable();
    table.timestamp('usado_em', { useTz: true });
    timestamps(table, knex);
    table.index(['expira_em', 'usado_em']);
  });

  await knex.schema.alterTable('impressoes', (table) => {
    table.bigInteger('pedido_id').nullable().alter();
    table.bigInteger('dispositivo_id').references('id').inTable('dispositivos_impressao').onDelete('SET NULL');
    table.string('destino', 30).notNullable().defaultTo('AGENTE_LEGADO');
    table.string('dedup_key', 160);
    table.timestamp('disponivel_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('envio_iniciado_em', { useTz: true });
    table.timestamp('enviado_em', { useTz: true });
    table.string('resultado', 40);
    table.index(['destino', 'status', 'disponivel_em'], 'impressoes_destino_fila_idx');
    table.index('dispositivo_id');
  });
  await knex('impressoes').whereNull('dedup_key').update({ dedup_key: knex.raw("'legado:' || id::text") });
  await knex.schema.alterTable('impressoes', (table) => table.string('dedup_key', 160).notNullable().alter());
  await knex.schema.alterTable('impressoes', (table) => table.unique(['dedup_key'], { indexName: 'impressoes_dedup_key_unique' }));
  await knex.raw('ALTER TABLE impressoes DROP CONSTRAINT impressoes_tipo_check');
  await knex.raw('ALTER TABLE impressoes DROP CONSTRAINT impressoes_status_check');
  await knex.raw("ALTER TABLE impressoes ADD CONSTRAINT impressoes_tipo_check CHECK (tipo IN ('COMANDA','REIMPRESSAO','TESTE'))");
  await knex.raw("ALTER TABLE impressoes ADD CONSTRAINT impressoes_status_check CHECK (status IN ('PENDENTE','EM_PROCESSAMENTO','CONCLUIDA','FALHOU','RESULTADO_INDETERMINADO'))");
  await knex.raw("ALTER TABLE impressoes ADD CONSTRAINT impressoes_destino_check CHECK (destino IN ('ANDROID_BLUETOOTH','AGENTE_LEGADO'))");
  await knex.raw("ALTER TABLE impressoes ADD CONSTRAINT impressoes_resultado_check CHECK (resultado IS NULL OR resultado IN ('ENVIADO','FALHA_ANTES_ENVIO','RESULTADO_INDETERMINADO'))");
  await knex.raw("ALTER TABLE impressoes ADD CONSTRAINT impressoes_pedido_tipo_check CHECK (pedido_id IS NOT NULL OR tipo = 'TESTE')");

  await knex.schema.alterTable('configuracoes_loja', (table) => {
    table.string('metodo_impressao', 30).notNullable().defaultTo('DESABILITADA');
    table.boolean('imprimir_pedidos_painel').notNullable().defaultTo(false);
  });
  await knex.raw("UPDATE configuracoes_loja SET metodo_impressao = CASE WHEN imprimir_automaticamente THEN 'AGENTE_LEGADO' ELSE 'DESABILITADA' END");
  await knex.raw("ALTER TABLE configuracoes_loja ADD CONSTRAINT configuracoes_loja_metodo_impressao_check CHECK (metodo_impressao IN ('DESABILITADA','ANDROID_BLUETOOTH','AGENTE_LEGADO'))");
}

export async function down(knex) {
  await knex.raw('ALTER TABLE configuracoes_loja DROP CONSTRAINT configuracoes_loja_metodo_impressao_check');
  await knex.schema.alterTable('configuracoes_loja', (table) => {
    table.dropColumn('imprimir_pedidos_painel');
    table.dropColumn('metodo_impressao');
  });
  await knex.raw('ALTER TABLE impressoes DROP CONSTRAINT impressoes_pedido_tipo_check');
  await knex.raw('ALTER TABLE impressoes DROP CONSTRAINT impressoes_resultado_check');
  await knex.raw('ALTER TABLE impressoes DROP CONSTRAINT impressoes_destino_check');
  await knex.raw('ALTER TABLE impressoes DROP CONSTRAINT impressoes_status_check');
  await knex.raw('ALTER TABLE impressoes DROP CONSTRAINT impressoes_tipo_check');
  await knex.raw("ALTER TABLE impressoes ADD CONSTRAINT impressoes_tipo_check CHECK (tipo IN ('COMANDA','REIMPRESSAO'))");
  await knex.raw("ALTER TABLE impressoes ADD CONSTRAINT impressoes_status_check CHECK (status IN ('PENDENTE','EM_PROCESSAMENTO','CONCLUIDA','FALHOU'))");
  await knex.schema.alterTable('impressoes', (table) => {
    table.dropUnique(['dedup_key'], 'impressoes_dedup_key_unique');
    table.dropIndex(['destino', 'status', 'disponivel_em'], 'impressoes_destino_fila_idx');
    table.dropColumn('resultado');
    table.dropColumn('enviado_em');
    table.dropColumn('envio_iniciado_em');
    table.dropColumn('disponivel_em');
    table.dropColumn('dedup_key');
    table.dropColumn('destino');
    table.dropColumn('dispositivo_id');
    table.bigInteger('pedido_id').notNullable().alter();
  });
  await knex.schema.dropTable('pareamentos_impressao');
  await knex.schema.dropTable('dispositivos_impressao');
}
