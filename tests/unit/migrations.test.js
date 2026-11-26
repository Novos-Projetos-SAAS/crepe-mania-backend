import { afterAll, describe, expect, it } from 'vitest';
import knex from 'knex';
import { seedFiles } from '../../src/database/seeds/seedManifest.js';

const compiler = knex({ client: 'pg' });
const migrationFiles = Array.from({ length: 46 }, (_, index) => `${String(index + 1).padStart(3, '0')}_`);
const reservedMigrations = new Set(['011_etapa_reservada.js', '012_etapa_reservada.js', '031_relatorio_reservado.js', '035_relatorio_reservado.js']);

afterAll(async () => compiler.destroy());

describe('migrations PostgreSQL', () => {
  it('compila as 46 migrations para SQL sem executar DDL', async () => {
    const files = Object.keys(import.meta.glob('../../src/database/migrations/*.js')).sort();
    expect(files).toHaveLength(46);
    expect(files.map((file) => file.split('/').at(-1).slice(0, 4))).toEqual(migrationFiles);

    for (const file of files) {
      const statements = [];
      const fakeKnex = Object.assign(
        () => ({ whereNull() { return this; }, update(values) { statements.push({ sql: 'update-compilation-sentinel', bindings: [values] }); return Promise.resolve(); } }),
        {
          fn: compiler.fn,
          schema: {
          createTable(name, callback) {
            const sql = compiler.schema.createTable(name, callback).toSQL();
            statements.push(...sql);
            return Promise.resolve();
          },
          alterTable(name, callback) {
            const sql = compiler.schema.alterTable(name, callback).toSQL();
            statements.push(...sql);
            return Promise.resolve();
          },
        },
        raw(sql, bindings) {
          statements.push(compiler.raw(sql, bindings).toSQL());
          return Promise.resolve();
        },
      });
      const migration = await import(file);
      await expect(migration.up(fakeKnex)).resolves.toBeUndefined();
      if (reservedMigrations.has(file.split('/').at(-1))) expect(statements, file).toHaveLength(0);
      else expect(statements.length, file).toBeGreaterThan(0);
    }
  });

  it('mantem quinze seeds versionados sem executar nenhum', () => {
    expect(seedFiles).toHaveLength(15);
  });
});
