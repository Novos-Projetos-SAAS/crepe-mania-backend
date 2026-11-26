export async function up(knex) {
  await knex.schema.createTable('controle_seeds', (table) => {
    table.bigIncrements('id');
    table.string('nome_arquivo', 255).notNullable().unique();
    table.string('checksum_sha256', 64).notNullable();
    table.timestamp('executado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.integer('duracao_ms');
    table.check('duracao_ms IS NULL OR duracao_ms >= 0', [], 'controle_seeds_duracao_check');
  });
}

export async function down(knex) { await knex.schema.dropTable('controle_seeds'); }
