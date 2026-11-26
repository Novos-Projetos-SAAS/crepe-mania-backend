import { afterAll, describe, expect, it } from 'vitest';
import knex from 'knex';
import { seedFiles } from '../../src/database/seeds/seedManifest.js';

const compiler = knex({ client: 'pg' });
const migrations = import.meta.glob('../../src/database/migrations/*.js');

afterAll(() => compiler.destroy());

async function compile(number) {
  const entry = Object.entries(migrations).find(([name]) => name.split('/').at(-1).startsWith(`${number}_`));
  expect(entry, `migration ${number} deve existir`).toBeDefined();
  const statements = [];
  const fake = Object.assign(() => {
    throw new Error('A migration deve usar DDL explícito, sem executar queries.');
  }, {
    fn: compiler.fn,
    schema: Object.fromEntries(['createTable', 'alterTable'].map((method) => [method, (name, callback) => {
      statements.push(...compiler.schema[method](name, callback).toSQL());
      return Promise.resolve();
    }])),
    raw(sql, bindings) { statements.push(compiler.raw(sql, bindings).toSQL()); return Promise.resolve(); },
  });
  const module = await entry[1]();
  await module.up(fake);
  return { sql: statements.map((item) => item.sql).join('\n'), module };
}

describe('expansão financeira InfinitePay, compilação sem conexão', () => {
  it('configuração singleton começa desabilitada e retém credenciais por FK', async () => {
    const { sql } = await compile('042');
    expect(sql).toContain('"infinitepay_credenciais"');
    expect(sql).toContain('"api_key_ciphertext" text not null');
    expect(sql).toContain('"key_version" integer not null default \'1\'');
    expect(sql).toContain('"infinitepay_configuracoes"');
    for (const flag of ['ativo', 'pix_habilitado', 'credito_habilitado']) expect(sql).toContain(`"${flag}" boolean not null default '0'`);
    expect(sql).toMatch(/CHECK \(id = 1\)/i);
    expect(sql).toContain('NOT pix_habilitado OR credito_habilitado');
    expect(sql).toContain('handle IS NOT NULL');
    expect(sql).toContain('backend_public_url IS NOT NULL');
    expect(sql).toContain('redirect_url IS NOT NULL');
    expect(sql).toContain('references "infinitepay_credenciais"');
    expect(sql).not.toMatch(/CREATE EXTENSION|gen_random_uuid|uuid_generate/i);
  });

  it('ledger usa UUID fornecido pela aplicação, tentativas únicas e transação global única', async () => {
    const { sql } = await compile('043');
    for (const table of ['infinitepay_tentativas', 'infinitepay_transacoes', 'infinitepay_confirmacoes']) expect(sql).toContain(`create table "${table}"`);
    expect(sql).toContain('"id" uuid');
    expect(sql).toContain('"infinitepay_tentativas_pedido_id_unique" unique ("pedido_id")');
    expect(sql).toContain('"infinitepay_transacoes_transaction_nsu_unique" unique ("transaction_nsu")');
    expect(sql).toContain('"provider_verified_at" timestamptz not null');
    expect(sql).toContain('valor_centavos >= 100');
    expect(sql).toContain("fluxo_pagamento = 'TRADICIONAL'");
    expect(sql).toContain('liberado_operacionalmente_em = criado_em');
    expect(sql).toContain('references "infinitepay_confirmacoes"');
    expect(sql).not.toMatch(/CREATE EXTENSION|gen_random_uuid|uuid_generate/i);
  });

  it('inbox e outbox persistem deduplicação e lease em timestamptz', async () => {
    const { sql } = await compile('044');
    for (const table of ['infinitepay_inbox', 'eventos_outbox']) {
      expect(sql).toContain(`create table "${table}"`);
      expect(sql).toContain(`"${table}_fila_idx"`);
    }
    for (const field of ['disponivel_em', 'lease_ate', 'criado_em', 'atualizado_em']) expect(sql).toContain(`"${field}" timestamptz`);
    expect(sql).toContain('"lease_token" uuid');
    expect(sql).toContain('"dedup_key" varchar(64) not null');
    expect(sql).toContain('"event_id" varchar(160) not null');
    expect(sql).toContain("'PENDENTE','PROCESSANDO','CONCLUIDO','FALHOU'");
  });

  it('guarda prova oficial, snapshots, itens e filas operacionais no banco', async () => {
    const { sql } = await compile('045');
    for (const table of ['pedidos', 'infinitepay_credenciais', 'infinitepay_tentativas', 'infinitepay_transacoes', 'infinitepay_confirmacoes', 'itens_pedido', 'itens_pedido_adicionais', 'impressoes', 'notificacoes', 'eventos_outbox']) expect(sql).toMatch(new RegExp(`CREATE TRIGGER [\\s\\S]+? ON public\\.${table}\\b`));
    expect(sql).toContain('c.id = p_confirmacao_id');
    expect(sql).toContain('c.pedido_id = p_pedido_id');
    expect(sql).toContain('t.pedido_id = p_pedido_id');
    expect(sql).toContain('a.pedido_id = p_pedido_id');
    expect(sql).toContain("t.classificacao = 'ELEGIVEL'");
    expect(sql).toContain('t.provider_verified_at IS NOT NULL');
    expect(sql).toContain('t.amount = p_total * 100');
    expect(sql).toContain('t.paid_amount >= t.amount');
    expect(sql).toContain('jsonb_exists(a.metodos_permitidos, lower(t.capture_method))');
    expect(sql).toContain('ORDER BY id FOR UPDATE');
    expect(sql).toContain("IF NEW.pedido_id IS NULL THEN RETURN NEW; END IF");
    expect(sql).toContain('OLD.confirmacao_liberacao_id IS DISTINCT FROM NEW.confirmacao_liberacao_id');
    expect(sql).toContain('OLD.valid_until IS DISTINCT FROM NEW.valid_until');
    expect(sql).toContain('EXISTS (SELECT 1 FROM public.infinitepay_tentativas');
    expect(sql).toContain("NEW.estado IN ('CONCLUIDO','FALHOU')");
    expect(sql).toContain('INFINITEPAY_FILA_IDENTIDADE_IMUTAVEL');
  });

  it('rollback da expansão não remove o histórico financeiro', async () => {
    for (const number of ['042', '043', '044', '045', '046']) {
      const { module } = await compile(number);
      await expect(module.down({})).rejects.toThrow(/reversão.*flags|rollback.*bloqueado/i);
    }
  });

  it('seeds novos são append-only no manifesto e não incluem secrets ou habilitação', async () => {
    expect(seedFiles.slice(12, 14)).toEqual(['013_permissoes_infinitepay.js', '014_configuracao_infinitepay_desabilitada.js']);
    const seeds = import.meta.glob('../../src/database/seeds/versions/01[34]_*.js');
    const inserts = [];
    const trx = (table) => ({ insert: (values) => {
      inserts.push({ table, values });
      return { onConflict: (key) => ({ ignore: () => Promise.resolve(key) }) };
    } });
    for (const load of Object.values(seeds)) await (await load()).apply(trx);
    expect(inserts.find((row) => row.table === 'permissoes').values.map((row) => row.nome)).toEqual(['infinitepay.visualizar', 'infinitepay.configurar', 'pagamentos.listar', 'pagamentos.conciliar']);
    expect(inserts.find((row) => row.table === 'infinitepay_configuracoes').values).toEqual({ id: 1, ativo: false, pix_habilitado: false, credito_habilitado: false, assured_installments: 0, versao: 1 });
  });
});
