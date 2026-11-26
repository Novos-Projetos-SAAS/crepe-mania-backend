import { afterAll, describe, it, expect } from 'vitest';
import knex from 'knex';

const enabled = process.env.RUN_DB_INTEGRATION === 'true' && Boolean(process.env.DATABASE_TEST_URL) && process.env.DATABASE_TEST_URL !== process.env.DATABASE_URL && process.env.NODE_ENV !== 'production';
const db = enabled ? knex({ client: 'pg', connection: process.env.DATABASE_TEST_URL, pool: { min: 0, max: 2 } }) : null;
afterAll(async () => { await db?.destroy(); });

describe.skipIf(!enabled)('Crepe Mania: inspecao de banco de testes isolado', () => {
  it('deve ter recebido 46 migrations e 15 seeds numeradas', async () => {
    const appliedMigrations = await db('knex_migrations').orderBy('id');
    const appliedSeeds = await db('controle_seeds').orderBy('id');
    expect(appliedMigrations).toHaveLength(46);
    expect(appliedSeeds).toHaveLength(15);
  });
  it('nao deve ter tabelas de paes e deve conter cardapio inicial inativo', async () => {
    const tables = await db('information_schema.tables').where({ table_schema: 'public' }).pluck('table_name');
    expect(tables).not.toContain('tipos_pao');
    expect(tables).not.toContain('produto_tipos_pao');
    const rows = await db('produtos').count('* as total').first();
    expect(Number(rows.total)).toBeGreaterThanOrEqual(75);
    const publishedWithoutPrice = await db('produtos').where({ ativo: true }).whereNull('preco_base').count('* as total').first();
    expect(Number(publishedWithoutPrice.total)).toBe(0);
  });
});
