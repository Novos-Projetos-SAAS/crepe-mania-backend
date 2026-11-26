
export async function up(knex) {
  await knex.schema.alterTable('configuracoes_loja', (table) => {
    table
      .string('modo_operacao', 24)
      .notNullable()
      .defaultTo('FECHADO_MANUAL');
  });

  await knex.raw(`
    ALTER TABLE configuracoes_loja
    ADD CONSTRAINT configuracoes_loja_modo_operacao_check
    CHECK (
      modo_operacao IN (
        'AUTOMATICO',
        'ABERTO_MANUAL',
        'FECHADO_MANUAL'
      )
    )
  `);

  // Preserva o comportamento anterior:
  // true  -> permitir pedidos somente no horário
  // false -> manter a loja fechada
  await knex.raw(`
    UPDATE configuracoes_loja
    SET modo_operacao = CASE
      WHEN aceitar_pedidos = TRUE THEN 'AUTOMATICO'
      ELSE 'FECHADO_MANUAL'
    END
  `);
}

export async function down(knex) {
  await knex.schema.alterTable('configuracoes_loja', (table) => {
    table.dropColumn('modo_operacao');
  });
}
