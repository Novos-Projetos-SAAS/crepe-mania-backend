export function timestamps(table, knex) {
  table.timestamp('criado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  table.timestamp('atualizado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now());
}

export function money(table, name, { nullable = false, defaultValue } = {}) {
  let column = table.decimal(name, 12, 2);
  if (!nullable) column = column.notNullable();
  if (defaultValue !== undefined) column.defaultTo(defaultValue);
  return column;
}
