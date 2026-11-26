import { describe, expect, it } from 'vitest';
import {
    MIGRATION_CHECKSUM_UNVERIFIABLE,
    assertExactAuthorization,
    assertSnapshotUnchanged,
    classifyTestDatabase,
    expectedTablesForMigrationCount,
    inspectMigrationHistory,
    inspectSchemaFeatures,
    inspectSeedHistory,
    validateLocalMigrationNames,
} from '../../src/database/testIntegrity.js';

const migrationNames = Array.from({ length: 46 }, (_, index) => `${String(index + 1).padStart(3, '0')}_migration_${index + 1}.js`);
const migrationRows = (count) => migrationNames.slice(0, count).map((name, index) => ({ id: index + 1, name }));
const descriptors = Array.from({ length: 15 }, (_, index) => ({
  file: `${String(index + 1).padStart(3, '0')}_seed_${index + 1}.js`,
  checksum: String(index + 1).padStart(64, '0'),
}));
const seedRows = (count) => descriptors.slice(0, count).map((descriptor, index) => ({
    id: index + 1,
    nome_arquivo: descriptor.file,
    checksum_sha256: descriptor.checksum,
}));
const lock = { rows: '1', locked: '0' };

describe('integridade offline de TEST', () => {
  it.each([0, 25, 26, 27, 39, 40, 41, 42, 43, 44, 45, 46])('aceita %i migrations quando formam prefixo exato', (count) => {
    const result = inspectMigrationHistory(migrationRows(count), migrationNames, { lock: count ? lock : null });
    expect(result.applied).toBe(count);
    expect(result.pending).toEqual(migrationNames.slice(count));
    expect(result.checksum_status).toBe(MIGRATION_CHECKSUM_UNVERIFIABLE);
  });

    it('ordena migrations numericamente e bloqueia lacuna, duplicata, ordem e arquivo extra', () => {
        expect(validateLocalMigrationNames([...migrationNames].reverse())).toEqual(migrationNames);
        const gap = migrationRows(4).filter((row) => !row.name.startsWith('003_'));
        expect(() => inspectMigrationHistory(gap, migrationNames, { lock })).toThrow(expect.objectContaining({ code: 'MIGRATION_HISTORY_NOT_PREFIX' }));
        expect(() => inspectMigrationHistory([...migrationRows(2), migrationRows(2)[1]], migrationNames, { lock })).toThrow(expect.objectContaining({ code: 'MIGRATION_HISTORY_DUPLICATE' }));
        expect(() => inspectMigrationHistory([migrationRows(2)[1], migrationRows(2)[0]], migrationNames, { lock })).toThrow(expect.objectContaining({ code: 'MIGRATION_HISTORY_NOT_PREFIX' }));
        expect(() => inspectMigrationHistory([...migrationRows(2), { name: '999_desconhecida.js' }], migrationNames, { lock })).toThrow(expect.objectContaining({ code: 'MIGRATION_HISTORY_UNKNOWN' }));
    });

    it('bloqueia lock ativo e distingue checksum verificavel do nao verificavel', () => {
        expect(() => inspectMigrationHistory(migrationRows(1), migrationNames, { lock: { rows: 1, locked: 1 } })).toThrow(expect.objectContaining({ code: 'MIGRATION_LOCK_UNSAFE' }));
        const rows = [{ ...migrationRows(1)[0], checksum_sha256: 'hash-confiavel' }];
        expect(inspectMigrationHistory(rows, migrationNames, { lock, trustedChecksums: { [rows[0].name]: 'hash-confiavel' } }).checksum_status).toBe('CHECKSUM_MIGRATION_VERIFICADO');
        expect(() => inspectMigrationHistory(rows, migrationNames, { lock, trustedChecksums: { [rows[0].name]: 'outro' } })).toThrow(expect.objectContaining({ code: 'MIGRATION_CHECKSUM_MISMATCH' }));
    });

  it.each([8, 9, 10, 11, 12, 13, 14, 15])('aceita %i seeds somente como prefixo com checksum', (count) => {
    const result = inspectSeedHistory(seedRows(count), descriptors);
    expect(result.applied).toBe(count);
    expect(result.pending).toEqual(descriptors.slice(count).map((item) => item.file));
  });

    it('bloqueia seed alterado, desconhecido, duplicado e fora de ordem', () => {
        expect(() => inspectSeedHistory([{ ...seedRows(1)[0], checksum_sha256: 'f'.repeat(64) }], descriptors)).toThrow(expect.objectContaining({ code: 'SEED_CHECKSUM_MISMATCH' }));
        expect(() => inspectSeedHistory([...seedRows(1), { nome_arquivo: '999_seed.js', checksum_sha256: 'a'.repeat(64) }], descriptors)).toThrow(expect.objectContaining({ code: 'SEED_HISTORY_UNKNOWN' }));
        expect(() => inspectSeedHistory([...seedRows(1), seedRows(1)[0]], descriptors)).toThrow(expect.objectContaining({ code: 'SEED_HISTORY_DUPLICATE' }));
        expect(() => inspectSeedHistory([seedRows(2)[1], seedRows(2)[0]], descriptors)).toThrow(expect.objectContaining({ code: 'SEED_HISTORY_NOT_PREFIX' }));
    });

  it.each([
    [0, 0, 'TEST_VAZIO'],
    [25, 8, 'TEST_PREFIXO_ATUALIZAVEL'],
    [26, 9, 'TEST_PREFIXO_ATUALIZAVEL'],
    [27, 10, 'TEST_PREFIXO_ATUALIZAVEL'],
    [39, 10, 'TEST_PREFIXO_ATUALIZAVEL'],
    [40, 10, 'TEST_PREFIXO_ATUALIZAVEL'],
    [27, 11, 'TEST_PREFIXO_ATUALIZAVEL'],
    [27, 12, 'TEST_PREFIXO_ATUALIZAVEL'],
    [27, 13, 'TEST_PREFIXO_ATUALIZAVEL'],
    [41, 11, 'TEST_PREFIXO_ATUALIZAVEL'],
    [41, 12, 'TEST_PREFIXO_ATUALIZAVEL'],
    [43, 12, 'TEST_PREFIXO_ATUALIZAVEL'],
    [42, 14, 'TEST_PREFIXO_ATUALIZAVEL'],
    [45, 14, 'TEST_PREFIXO_ATUALIZAVEL'],
    [46, 14, 'TEST_PREFIXO_ATUALIZAVEL'],
    [46, 15, 'TEST_COMPLETO'],
  ])('classifica schema com %i migrations e %i seeds como %s', (migrationCount, seedCount, state) => {
    const migrations = inspectMigrationHistory(migrationRows(migrationCount), migrationNames, { lock: migrationCount ? lock : null });
    const seeds = inspectSeedHistory(seedRows(seedCount), descriptors);
    expect(classifyTestDatabase({ tableNames: expectedTablesForMigrationCount(migrationCount), migrations, seeds }).state).toBe(state);
  });

  it('bloqueia tabela desconhecida, tabela ausente e seed adiantado ao schema', () => {
    const migrations = inspectMigrationHistory(migrationRows(26), migrationNames, { lock });
    const seeds = inspectSeedHistory(seedRows(9), descriptors);
    expect(classifyTestDatabase({ tableNames: [...expectedTablesForMigrationCount(26), 'intrusa'], migrations, seeds })).toMatchObject({ state: 'TEST_INSEGURO', unknown: ['intrusa'] });
    expect(classifyTestDatabase({ tableNames: expectedTablesForMigrationCount(26).filter((name) => name !== 'convites_usuarios'), migrations, seeds })).toMatchObject({ state: 'TEST_INSEGURO', missing: ['convites_usuarios'] });
    const oldMigrations = inspectMigrationHistory(migrationRows(25), migrationNames, { lock });
    expect(classifyTestDatabase({ tableNames: expectedTablesForMigrationCount(25), migrations: oldMigrations, seeds })).toMatchObject({ state: 'TEST_INSEGURO', stage_mismatch: true });
    const beforeConfig = inspectMigrationHistory(migrationRows(41), migrationNames, { lock });
    const ahead = inspectSeedHistory(seedRows(14), descriptors);
    expect(classifyTestDatabase({ tableNames: expectedTablesForMigrationCount(41), migrations: beforeConfig, seeds: ahead })).toMatchObject({ state: 'TEST_INSEGURO', stage_mismatch: true });
  });

  it('exige tabelas financeiras somente na etapa de criação correspondente', () => {
    expect(expectedTablesForMigrationCount(40)).not.toContain('infinitepay_configuracoes');
    expect(expectedTablesForMigrationCount(41)).not.toContain('infinitepay_configuracoes');
    expect(expectedTablesForMigrationCount(42)).toEqual(expect.arrayContaining(['infinitepay_credenciais', 'infinitepay_configuracoes']));
    expect(expectedTablesForMigrationCount(42)).not.toContain('infinitepay_tentativas');
    expect(expectedTablesForMigrationCount(43)).toEqual(expect.arrayContaining(['infinitepay_tentativas', 'infinitepay_transacoes', 'infinitepay_confirmacoes']));
    expect(expectedTablesForMigrationCount(43)).not.toContain('infinitepay_inbox');
    expect(expectedTablesForMigrationCount(44)).toEqual(expect.arrayContaining(['infinitepay_inbox', 'eventos_outbox']));
    const migrations = inspectMigrationHistory(migrationRows(46), migrationNames, { lock });
    const seeds = inspectSeedHistory(seedRows(14), descriptors);
    expect(classifyTestDatabase({ tableNames: expectedTablesForMigrationCount(46).filter((name) => name !== 'infinitepay_confirmacoes'), migrations, seeds })).toMatchObject({ state: 'TEST_INSEGURO', missing: ['infinitepay_confirmacoes'] });
  });

  it('valida colunas e indices das etapas 027 a 044 e bloqueia alteracao prematura', () => {
    const stage27 = {
      columns: ['codigo', 'filtros_config', 'colunas_config', 'limite_linhas', 'ativo'].map((column_name) => ({ table_name: 'catalogo_relatorios', column_name })),
      indexes: [{ indexname: 'catalogo_relatorios_codigo_unique' }],
    };
    expect(inspectSchemaFeatures(stage27, 39)).toEqual({ valid: true });
    const stage40 = {
      columns: [
        ...stage27.columns,
        ...['installation_id', 'credencial_hash', 'status', 'turno_ativo'].map((column_name) => ({ table_name: 'dispositivos_impressao', column_name })),
        ...['codigo_hash', 'dispositivo_id', 'expira_em', 'usado_em'].map((column_name) => ({ table_name: 'pareamentos_impressao', column_name })),
        ...['dispositivo_id', 'destino', 'dedup_key', 'disponivel_em', 'envio_iniciado_em', 'enviado_em', 'resultado'].map((column_name) => ({ table_name: 'impressoes', column_name })),
        ...['metodo_impressao', 'imprimir_pedidos_painel'].map((column_name) => ({ table_name: 'configuracoes_loja', column_name })),
      ],
      indexes: [...stage27.indexes, { indexname: 'impressoes_destino_fila_idx' }, { indexname: 'impressoes_dedup_key_unique' }],
    };
    expect(inspectSchemaFeatures(stage40, 40)).toEqual({ valid: true });
    expect(() => inspectSchemaFeatures(stage40, 39)).toThrow(expect.objectContaining({ code: 'SCHEMA_FEATURE_MISMATCH' }));
    expect(() => inspectSchemaFeatures({ ...stage40, columns: stage40.columns.filter((item) => item.column_name !== 'dedup_key') }, 40)).toThrow(expect.objectContaining({ code: 'SCHEMA_FEATURE_MISMATCH' }));
    const stage41 = { ...stage40, columns: [...stage40.columns, { table_name: 'configuracoes_loja', column_name: 'modo_operacao' }] };
    expect(inspectSchemaFeatures(stage41, 41)).toEqual({ valid: true });
    expect(() => inspectSchemaFeatures(stage40, 41)).toThrow(expect.objectContaining({ code: 'SCHEMA_FEATURE_MISMATCH' }));
    expect(() => inspectSchemaFeatures(stage41, 40)).toThrow(expect.objectContaining({ code: 'SCHEMA_FEATURE_MISMATCH' }));
    const stage44 = {
      columns: [
        ...stage41.columns,
        ...['ativo', 'pix_habilitado', 'credito_habilitado', 'handle', 'credencial_id', 'backend_public_url', 'redirect_url', 'assured_installments', 'versao'].map((column_name) => ({ table_name: 'infinitepay_configuracoes', column_name })),
        ...['handle', 'api_key_ciphertext', 'key_version'].map((column_name) => ({ table_name: 'infinitepay_credenciais', column_name })),
        ...['fluxo_pagamento', 'liberado_operacionalmente_em', 'confirmacao_liberacao_id'].map((column_name) => ({ table_name: 'pedidos', column_name })),
        ...['pedido_id', 'order_nsu', 'estado', 'valor_centavos', 'metodos_permitidos', 'payload_json', 'payload_hash', 'credencial_id', 'handle_snapshot', 'checkout_url', 'valid_until', 'criacao_iniciada_em'].map((column_name) => ({ table_name: 'infinitepay_tentativas', column_name })),
        ...['pedido_id', 'tentativa_id', 'transaction_nsu', 'amount', 'paid_amount', 'capture_method', 'classificacao', 'provider_verified_at', 'evidence_json'].map((column_name) => ({ table_name: 'infinitepay_transacoes', column_name })),
        ...['transacao_id', 'pedido_id', 'tentativa_id', 'elegivel', 'verificado_em', 'consulta_json', 'evidencia_json', 'hash_evidencia'].map((column_name) => ({ table_name: 'infinitepay_confirmacoes', column_name })),
        ...['infinitepay_inbox', 'eventos_outbox'].flatMap((table_name) => ['estado', 'tentativas', 'disponivel_em', 'lease_ate', 'lease_token', 'ultimo_erro', 'criado_em', 'atualizado_em'].map((column_name) => ({ table_name, column_name }))),
        ...['tentativa_id', 'transaction_nsu', 'slug', 'origem', 'event_type', 'dedup_key', 'resultado_json'].map((column_name) => ({ table_name: 'infinitepay_inbox', column_name })),
        ...['pedido_id', 'tipo', 'event_id', 'payload'].map((column_name) => ({ table_name: 'eventos_outbox', column_name })),
      ],
      indexes: [...stage40.indexes, ...[
        'pedidos_liberacao_operacional_idx', 'infinitepay_tentativas_pedido_id_unique', 'infinitepay_tentativas_order_nsu_unique',
        'infinitepay_transacoes_transaction_nsu_unique', 'infinitepay_confirmacoes_transacao_id_unique',
        'infinitepay_inbox_dedup_key_unique', 'infinitepay_inbox_fila_idx', 'eventos_outbox_event_id_unique', 'eventos_outbox_fila_idx',
      ].map((indexname) => ({ indexname }))],
    };
    expect(inspectSchemaFeatures(stage44, 46)).toEqual({ valid: true });
    expect(() => inspectSchemaFeatures(stage44, 40)).toThrow(expect.objectContaining({ code: 'SCHEMA_FEATURE_MISMATCH' }));
    expect(() => inspectSchemaFeatures(stage40, 46)).toThrow(expect.objectContaining({ code: 'SCHEMA_FEATURE_MISMATCH' }));
    expect(() => inspectSchemaFeatures({ ...stage44, columns: stage44.columns.filter((item) => item.column_name !== 'hash_evidencia') }, 46)).toThrow(expect.objectContaining({ code: 'SCHEMA_FEATURE_MISMATCH' }));
    expect(() => inspectSchemaFeatures({ ...stage44, indexes: stage44.indexes.filter((item) => item.indexname !== 'infinitepay_transacoes_transaction_nsu_unique') }, 46)).toThrow(expect.objectContaining({ code: 'SCHEMA_FEATURE_MISMATCH' }));
  });

    it('exige autorizacao exata antes de qualquer escrita e detecta snapshot DEV alterado', () => {
        expect(assertExactAuthorization(['040_migration_40.js'], ['040_migration_40.js'], 'migration')).toBeUndefined();
        expect(() => assertExactAuthorization(['039.js', '040.js'], ['040.js'], 'migration')).toThrow(expect.objectContaining({ code: 'MIGRATION_AUTHORIZATION_MISMATCH' }));
        expect(assertSnapshotUnchanged({ fingerprint: 'abc' }, { fingerprint: 'abc' })).toBe(true);
        expect(() => assertSnapshotUnchanged({ fingerprint: 'abc' }, { fingerprint: 'def' })).toThrow(expect.objectContaining({ code: 'DEVELOPMENT_SNAPSHOT_CHANGED' }));
    });
});
