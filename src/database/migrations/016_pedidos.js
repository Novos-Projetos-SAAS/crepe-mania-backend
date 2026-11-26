import { money, timestamps } from '../migrationHelpers.js';

export async function up(knex) {
  await knex.schema.createTable('pedidos', (table) => {
    table.bigIncrements('id');
    table.string('codigo_acompanhamento', 64).notNullable().unique();
    table.string('canal_pedido', 20).notNullable();
    table.string('cliente_nome', 120).notNullable();
    table.string('cliente_telefone', 20).notNullable();
    table.string('tipo_entrega', 20).notNullable();
    table.string('endereco_logradouro', 160);
    table.string('endereco_numero', 30);
    table.boolean('endereco_sem_numero').notNullable().defaultTo(false);
    table.string('endereco_bairro', 100);
    table.string('endereco_cidade', 100);
    table.string('endereco_uf', 2);
    table.string('endereco_complemento', 160);
    table.string('endereco_referencia', 200);
    table.bigInteger('metodo_pagamento_id').notNullable().references('id').inTable('metodos_pagamento').onDelete('RESTRICT');
    table.string('metodo_pagamento_nome_snapshot', 100).notNullable();
    table.string('status', 30).notNullable().defaultTo('PENDENTE');
    table.string('status_pagamento', 20).notNullable().defaultTo('PENDENTE');
    money(table, 'subtotal');
    money(table, 'taxa_entrega', { defaultValue: 0 });
    money(table, 'desconto', { defaultValue: 0 });
    money(table, 'total');
    table.boolean('precisa_troco').notNullable().defaultTo(false);
    money(table, 'troco_para', { nullable: true });
    money(table, 'troco_previsto', { nullable: true });
    table.text('observacoes');
    table.text('motivo_cancelamento');
    table.bigInteger('criado_por_usuario_id').references('id').inTable('usuarios').onDelete('SET NULL');
    table.integer('versao').notNullable().defaultTo(1);
    timestamps(table, knex);
    table.timestamp('cancelado_em', { useTz: true });
    table.index(['criado_em', 'status']);
    table.index(['tipo_entrega', 'status']);
    table.index('cliente_telefone');
    table.check("canal_pedido IN ('WEB','PAINEL')", [], 'pedidos_canal_check');
    table.check("tipo_entrega IN ('ENTREGA','RETIRADA')", [], 'pedidos_entrega_check');
    table.check("status IN ('PENDENTE','EM_PREPARO','PRONTO_PARA_RETIRADA','SAIU_PARA_ENTREGA','ENTREGUE','CANCELADO')", [], 'pedidos_status_check');
    table.check("status_pagamento IN ('PENDENTE','PAGO','ESTORNADO')", [], 'pedidos_pagamento_check');
    table.check('subtotal >= 0 AND taxa_entrega >= 0 AND desconto >= 0 AND total >= 0', [], 'pedidos_valores_check');
    table.check('total = subtotal + taxa_entrega - desconto', [], 'pedidos_total_check');
    table.check('(precisa_troco = false AND troco_para IS NULL AND troco_previsto IS NULL) OR (precisa_troco = true AND troco_para > total AND troco_previsto = troco_para - total)', [], 'pedidos_troco_check');
    table.check("tipo_entrega = 'RETIRADA' OR (endereco_logradouro IS NOT NULL AND (endereco_numero IS NOT NULL OR endereco_sem_numero = true) AND endereco_bairro IS NOT NULL AND endereco_cidade IS NOT NULL AND endereco_uf IS NOT NULL)", [], 'pedidos_endereco_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('pedidos'); }
