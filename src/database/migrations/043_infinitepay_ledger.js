import { timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.alterTable('pedidos', (table) => {
    table.string('fluxo_pagamento', 20).notNullable().defaultTo('TRADICIONAL');
    table.timestamp('liberado_operacionalmente_em', { useTz: true });
    table.uuid('confirmacao_liberacao_id');
    table.check("fluxo_pagamento IN ('TRADICIONAL','INFINITEPAY')", [], 'pedidos_fluxo_pagamento_check');
    table.check("fluxo_pagamento <> 'INFINITEPAY' OR canal_pedido = 'WEB'", [], 'pedidos_infinitepay_canal_check');
    table.check("fluxo_pagamento <> 'TRADICIONAL' OR confirmacao_liberacao_id IS NULL", [], 'pedidos_confirmacao_fluxo_check');
    table.index(['fluxo_pagamento', 'liberado_operacionalmente_em'], 'pedidos_liberacao_operacional_idx');
  });
  await knex.raw("UPDATE pedidos SET liberado_operacionalmente_em = criado_em WHERE fluxo_pagamento = 'TRADICIONAL' AND liberado_operacionalmente_em IS NULL");
  await knex.schema.createTable('infinitepay_tentativas', (table) => {
    table.uuid('id').primary();
    table.bigInteger('pedido_id').notNullable().unique().references('id').inTable('pedidos').onDelete('RESTRICT');
    table.string('order_nsu', 100).notNullable().unique();
    table.string('estado', 30).notNullable().defaultTo('AGUARDANDO_CRIACAO');
    table.bigInteger('valor_centavos').notNullable();
    table.jsonb('metodos_permitidos').notNullable();
    table.jsonb('payload_json').notNullable();
    table.string('payload_hash', 64).notNullable();
    table.bigInteger('credencial_id').notNullable().references('id').inTable('infinitepay_credenciais').onDelete('RESTRICT');
    table.string('handle_snapshot', 100).notNullable();
    table.text('checkout_url');
    table.timestamp('valid_until', { useTz: true }).notNullable();
    table.timestamp('criacao_iniciada_em', { useTz: true });
    table.string('ultimo_erro', 100);
    timestamps(table, knex);
    table.check("estado IN ('AGUARDANDO_CRIACAO','CRIANDO','CRIACAO_INCERTA','AGUARDANDO_PAGAMENTO','PAGO_VERIFICADO','PAGO_EM_REVISAO','EXPIRADO')", [], 'infinitepay_tentativas_estado_check');
    table.check('valor_centavos >= 100', [], 'infinitepay_tentativas_valor_check');
    table.check("jsonb_typeof(metodos_permitidos) = 'array' AND metodos_permitidos <@ '[\"pix\",\"credit_card\"]'::jsonb AND jsonb_exists(metodos_permitidos, 'credit_card')", [], 'infinitepay_tentativas_metodos_check');
    table.check("payload_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(payload_json) = 'object' AND length(trim(order_nsu)) > 0", [], 'infinitepay_tentativas_payload_check');
    table.check("checkout_url IS NULL OR checkout_url LIKE 'https://%'", [], 'infinitepay_tentativas_checkout_url_check');
    table.index(['estado', 'valid_until'], 'infinitepay_tentativas_reconciliacao_idx');
  });
  await knex.schema.createTable('infinitepay_transacoes', (table) => {
    table.uuid('id').primary();
    table.bigInteger('pedido_id').notNullable().references('id').inTable('pedidos').onDelete('RESTRICT');
    table.uuid('tentativa_id').notNullable().references('id').inTable('infinitepay_tentativas').onDelete('RESTRICT');
    table.string('transaction_nsu', 200).notNullable().unique();
    table.string('invoice_slug', 200).notNullable();
    table.bigInteger('amount').notNullable();
    table.bigInteger('paid_amount').notNullable();
    table.string('capture_method', 30).notNullable();
    table.integer('installments').notNullable();
    table.text('receipt_url');
    table.string('classificacao', 20).notNullable();
    table.timestamp('provider_verified_at', { useTz: true }).notNullable();
    table.jsonb('evidence_json').notNullable();
    table.timestamp('criado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.check("classificacao IN ('ELEGIVEL','DIVERGENTE','CANCELADO','DUPLICADO')", [], 'infinitepay_transacoes_classificacao_check');
    table.check('amount >= 0 AND paid_amount >= 0 AND installments >= 0', [], 'infinitepay_transacoes_valores_check');
    table.check("length(trim(transaction_nsu)) > 0 AND length(trim(invoice_slug)) > 0 AND jsonb_typeof(evidence_json) = 'object'", [], 'infinitepay_transacoes_evidencia_check');
    table.index(['pedido_id', 'criado_em'], 'infinitepay_transacoes_pedido_idx');
    table.index('tentativa_id');
  });
  await knex.schema.createTable('infinitepay_confirmacoes', (table) => {
    table.uuid('id').primary();
    table.uuid('transacao_id').notNullable().unique().references('id').inTable('infinitepay_transacoes').onDelete('RESTRICT');
    table.bigInteger('pedido_id').notNullable().references('id').inTable('pedidos').onDelete('RESTRICT');
    table.uuid('tentativa_id').notNullable().references('id').inTable('infinitepay_tentativas').onDelete('RESTRICT');
    table.boolean('elegivel').notNullable();
    table.timestamp('verificado_em', { useTz: true }).notNullable();
    table.jsonb('consulta_json').notNullable();
    table.jsonb('evidencia_json').notNullable();
    table.string('hash_evidencia', 64).notNullable();
    table.check("hash_evidencia ~ '^[a-f0-9]{64}$' AND jsonb_typeof(consulta_json) = 'object' AND jsonb_typeof(evidencia_json) = 'object'", [], 'infinitepay_confirmacoes_evidencia_check');
    table.index(['pedido_id', 'elegivel'], 'infinitepay_confirmacoes_pedido_idx');
  });
  await knex.schema.alterTable('pedidos', (table) => {
    table.foreign('confirmacao_liberacao_id').references('id').inTable('infinitepay_confirmacoes').onDelete('RESTRICT');
  });
}

export async function down() {
  throw new Error('Rollback bloqueado: preservar ledger financeiro; realizar reversão por flags.');
}
