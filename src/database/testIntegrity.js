import { matchesSeedChecksum } from './seeds/seedChecksum.js';

export const EXPECTED_MIGRATION_TOTAL = 46;
export const EXPECTED_SEED_TOTAL = 14;
export const MIGRATION_CHECKSUM_UNVERIFIABLE = 'CHECKSUM_MIGRATION_NAO_VERIFICAVEL';

const CREATED_TABLES_BY_MIGRATION = Object.freeze({
  1: ['niveis_acesso'],
  2: ['usuarios'],
  3: ['permissoes'],
  4: ['permissoes_usuarios'],
  5: ['sessoes'],
  6: ['logs'],
  7: ['configuracoes_loja'],
  8: ['horarios_funcionamento'],
  9: ['categorias_produtos'],
  10: ['produtos'],
  13: ['adicionais'],
  14: ['produto_adicionais'],
  15: ['metodos_pagamento'],
  16: ['pedidos'],
  17: ['itens_pedido'],
  18: ['itens_pedido_adicionais'],
  19: ['historico_status_pedidos'],
  20: ['idempotencia_requisicoes'],
  21: ['push_subscriptions'],
  22: ['notificacoes'],
  23: ['entregas_push'],
  24: ['impressoes'],
  25: ['controle_seeds'],
  26: ['convites_usuarios'],
  27: ['catalogo_relatorios'],
  40: ['dispositivos_impressao', 'pareamentos_impressao'],
  42: ['infinitepay_credenciais', 'infinitepay_configuracoes'],
  43: ['infinitepay_tentativas', 'infinitepay_transacoes', 'infinitepay_confirmacoes'],
  44: ['infinitepay_inbox', 'eventos_outbox'],
});

const SCHEMA_COLUMNS = Object.freeze([
  { migration: 41, table: 'configuracoes_loja', column: 'modo_operacao' },
  ...['codigo', 'filtros_config', 'colunas_config', 'limite_linhas', 'ativo'].map((column) => ({ migration: 27, table: 'catalogo_relatorios', column })),
  ...['installation_id', 'credencial_hash', 'status', 'turno_ativo'].map((column) => ({ migration: 40, table: 'dispositivos_impressao', column })),
  ...['codigo_hash', 'dispositivo_id', 'expira_em', 'usado_em'].map((column) => ({ migration: 40, table: 'pareamentos_impressao', column })),
  ...['dispositivo_id', 'destino', 'dedup_key', 'disponivel_em', 'envio_iniciado_em', 'enviado_em', 'resultado'].map((column) => ({ migration: 40, table: 'impressoes', column })),
  ...['metodo_impressao', 'imprimir_pedidos_painel'].map((column) => ({ migration: 40, table: 'configuracoes_loja', column })),
  ...['ativo', 'pix_habilitado', 'credito_habilitado', 'handle', 'credencial_id', 'backend_public_url', 'redirect_url', 'assured_installments', 'versao'].map((column) => ({ migration: 42, table: 'infinitepay_configuracoes', column })),
  ...['handle', 'api_key_ciphertext', 'key_version'].map((column) => ({ migration: 42, table: 'infinitepay_credenciais', column })),
  ...['fluxo_pagamento', 'liberado_operacionalmente_em', 'confirmacao_liberacao_id'].map((column) => ({ migration: 43, table: 'pedidos', column })),
  ...['pedido_id', 'order_nsu', 'estado', 'valor_centavos', 'metodos_permitidos', 'payload_json', 'payload_hash', 'credencial_id', 'handle_snapshot', 'checkout_url', 'valid_until', 'criacao_iniciada_em'].map((column) => ({ migration: 43, table: 'infinitepay_tentativas', column })),
  ...['pedido_id', 'tentativa_id', 'transaction_nsu', 'amount', 'paid_amount', 'capture_method', 'classificacao', 'provider_verified_at', 'evidence_json'].map((column) => ({ migration: 43, table: 'infinitepay_transacoes', column })),
  ...['transacao_id', 'pedido_id', 'tentativa_id', 'elegivel', 'verificado_em', 'consulta_json', 'evidencia_json', 'hash_evidencia'].map((column) => ({ migration: 43, table: 'infinitepay_confirmacoes', column })),
  ...['infinitepay_inbox', 'eventos_outbox'].flatMap((table) => ['estado', 'tentativas', 'disponivel_em', 'lease_ate', 'lease_token', 'ultimo_erro', 'criado_em', 'atualizado_em'].map((column) => ({ migration: 44, table, column }))),
  ...['tentativa_id', 'transaction_nsu', 'slug', 'origem', 'event_type', 'dedup_key', 'resultado_json'].map((column) => ({ migration: 44, table: 'infinitepay_inbox', column })),
  ...['pedido_id', 'tipo', 'event_id', 'payload'].map((column) => ({ migration: 44, table: 'eventos_outbox', column })),
]);

const SCHEMA_INDEXES = Object.freeze([
  { migration: 27, name: 'catalogo_relatorios_codigo_unique' },
  { migration: 40, name: 'impressoes_destino_fila_idx' },
  { migration: 40, name: 'impressoes_dedup_key_unique' },
  ...['pedidos_liberacao_operacional_idx', 'infinitepay_tentativas_pedido_id_unique', 'infinitepay_tentativas_order_nsu_unique', 'infinitepay_transacoes_transaction_nsu_unique', 'infinitepay_confirmacoes_transacao_id_unique'].map((name) => ({ migration: 43, name })),
  ...['infinitepay_inbox_dedup_key_unique', 'infinitepay_inbox_fila_idx', 'eventos_outbox_event_id_unique', 'eventos_outbox_fila_idx'].map((name) => ({ migration: 44, name })),
]);

export const FINAL_DOMAIN_TABLES = Object.freeze(
    Object.entries(CREATED_TABLES_BY_MIGRATION)
        .sort(([left], [right]) => Number(left) - Number(right))
        .flatMap(([, tables]) => tables),
);

export class TestIntegrityError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'TestIntegrityError';
        this.code = code;
        this.details = details;
    }
}

const migrationNumber = (name) => {
    const match = /^(\d{3})_[a-z0-9_]+\.js$/i.exec(String(name));
    return match ? Number(match[1]) : null;
};

const seedNumber = (name) => {
    const match = /^(\d{3})_[a-z0-9_]+\.js$/i.exec(String(name));
    return match ? Number(match[1]) : null;
};

function assertSequentialFiles(items, { total, kind, numberOf }) {
    if (!Array.isArray(items) || items.length !== total) {
        throw new TestIntegrityError(`Manifesto local deve conter exatamente ${total} ${kind}.`, `${kind.toUpperCase()}_LOCAL_COUNT_INVALID`, { expected: total, actual: items?.length ?? null });
    }
    const numbers = items.map((item) => numberOf(item));
    if (numbers.some((number) => number == null)) {
        throw new TestIntegrityError(`Nome local de ${kind} invalido.`, `${kind.toUpperCase()}_LOCAL_NAME_INVALID`);
    }
    if (new Set(numbers).size !== numbers.length) {
        throw new TestIntegrityError(`${kind} locais possuem numeracao duplicada.`, `${kind.toUpperCase()}_LOCAL_DUPLICATE`);
    }
    const expected = Array.from({ length: total }, (_, index) => index + 1);
    const sorted = [...numbers].sort((left, right) => left - right);
    if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
        throw new TestIntegrityError(`${kind} locais possuem lacuna ou numeracao fora do intervalo esperado.`, `${kind.toUpperCase()}_LOCAL_GAP`, { expected, actual: sorted });
    }
}

export function validateLocalMigrationNames(names, expectedTotal = EXPECTED_MIGRATION_TOTAL) {
    assertSequentialFiles(names, { total: expectedTotal, kind: 'migration', numberOf: migrationNumber });
    return [...names].sort((left, right) => migrationNumber(left) - migrationNumber(right));
}

export function validateLocalSeedDescriptors(descriptors, expectedTotal = EXPECTED_SEED_TOTAL) {
    const files = descriptors.map((descriptor) => descriptor?.file);
    assertSequentialFiles(files, { total: expectedTotal, kind: 'seed', numberOf: seedNumber });
    const sorted = [...descriptors].sort((left, right) => seedNumber(left.file) - seedNumber(right.file));
    if (sorted.some((descriptor) => !/^[0-9a-f]{64}$/i.test(descriptor?.checksum ?? ''))) {
        throw new TestIntegrityError('Manifesto local de seeds possui checksum ausente ou invalido.', 'SEED_LOCAL_CHECKSUM_INVALID');
    }
    return sorted;
}

function assertLock(lock, appliedCount) {
    if (appliedCount === 0 && lock == null) return;
    if (!lock || Number(lock.rows) !== 1 || Number(lock.locked ?? 0) !== 0) {
        throw new TestIntegrityError('Lock de migrations ausente, duplicado ou ativo.', 'MIGRATION_LOCK_UNSAFE', { rows: lock?.rows ?? null, locked: lock?.locked ?? null });
    }
}

export function inspectMigrationHistory(appliedRows, localNames, options = {}) {
    const local = validateLocalMigrationNames(localNames, options.expectedTotal ?? EXPECTED_MIGRATION_TOTAL);
    const rows = appliedRows ?? [];
    const names = rows.map((row) => row?.name);
    if (names.some((name) => typeof name !== 'string')) {
        throw new TestIntegrityError('Historico contem nome de migration invalido.', 'MIGRATION_HISTORY_NAME_INVALID');
    }
    if (new Set(names).size !== names.length) {
        throw new TestIntegrityError('Historico contem migration duplicada.', 'MIGRATION_HISTORY_DUPLICATE', { names });
    }
    const extra = names.filter((name) => !local.includes(name));
    if (extra.length) {
        throw new TestIntegrityError('Historico contem migration desconhecida.', 'MIGRATION_HISTORY_UNKNOWN', { extra });
    }
    const expectedPrefix = local.slice(0, names.length);
    if (JSON.stringify(names) !== JSON.stringify(expectedPrefix)) {
        throw new TestIntegrityError('Historico de migrations nao forma prefixo exato na ordem de aplicacao.', 'MIGRATION_HISTORY_NOT_PREFIX', { expectedPrefix, actual: names });
    }
    assertLock(options.lock, names.length);

    let checksumStatus = MIGRATION_CHECKSUM_UNVERIFIABLE;
    if (options.trustedChecksums) {
        for (const row of rows) {
            const trusted = options.trustedChecksums[row.name];
            if (!trusted || !row.checksum_sha256 || trusted !== row.checksum_sha256) {
                throw new TestIntegrityError('Checksum historico de migration divergente ou ausente.', 'MIGRATION_CHECKSUM_MISMATCH', { migration: row.name });
            }
        }
        checksumStatus = 'CHECKSUM_MIGRATION_VERIFICADO';
    }

    return {
        applied: names.length,
        total: local.length,
        complete: names.length === local.length,
        pending: local.slice(names.length),
        names,
        checksum_status: checksumStatus,
    };
}

export function inspectSeedHistory(appliedRows, descriptors, options = {}) {
  const local = validateLocalSeedDescriptors(descriptors, options.expectedTotal ?? EXPECTED_SEED_TOTAL);
  const rows = appliedRows ?? [];
  const names = rows.map((row) => row?.nome_arquivo);
  if (names.some((name) => typeof name !== 'string')) {
    throw new TestIntegrityError('Controle de seeds contem nome invalido.', 'SEED_HISTORY_NAME_INVALID');
  }
  if (new Set(names).size !== names.length) {
    throw new TestIntegrityError('Controle de seeds contem arquivo duplicado.', 'SEED_HISTORY_DUPLICATE', { names });
  }
  const localFiles = local.map((descriptor) => descriptor.file);
  const extra = names.filter((name) => !localFiles.includes(name));
  if (extra.length) {
    throw new TestIntegrityError('Controle de seeds contem arquivo desconhecido.', 'SEED_HISTORY_UNKNOWN', { extra });
  }
  const expectedPrefix = localFiles.slice(0, names.length);
  if (JSON.stringify(names) !== JSON.stringify(expectedPrefix)) {
    throw new TestIntegrityError('Seeds aplicados nao formam prefixo exato do manifesto.', 'SEED_HISTORY_NOT_PREFIX', { expectedPrefix, actual: names });
  }
  for (let index = 0; index < rows.length; index += 1) {
    if (!matchesSeedChecksum(local[index], rows[index].checksum_sha256)) {
      throw new TestIntegrityError('Checksum de seed aplicado diverge do manifesto versionado.', 'SEED_CHECKSUM_MISMATCH', { seed: names[index] });
    }
  }
  return {
    applied: names.length,
    total: local.length,
    complete: names.length === local.length,
    pending: localFiles.slice(names.length),
    names,
  };
}

export function expectedTablesForMigrationCount(migrationCount) {
    if (!Number.isInteger(migrationCount) || migrationCount < 0 || migrationCount > EXPECTED_MIGRATION_TOTAL) {
        throw new TestIntegrityError('Quantidade de migrations invalida para classificar schema.', 'MIGRATION_COUNT_INVALID', { migrationCount });
    }
    if (migrationCount === 0) return [];
    const tables = ['knex_migrations', 'knex_migrations_lock'];
    for (const [number, created] of Object.entries(CREATED_TABLES_BY_MIGRATION)) {
        if (Number(number) <= migrationCount) tables.push(...created);
    }
    return [...new Set(tables)].sort();
}

function minimumMigrationForSeeds(seedCount) {
  if (seedCount === 0) return 0;
  if (seedCount <= 8) return 25;
  if (seedCount === 9) return 26;
  if (seedCount >= 14) return 42;
  return 27;
}

export function classifyTestDatabase({ tableNames, migrations, seeds }) {
    const actual = [...new Set(tableNames ?? [])].sort();
    const expected = expectedTablesForMigrationCount(migrations.applied);
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const missing = expected.filter((table) => !actualSet.has(table));
    const unknown = actual.filter((table) => !expectedSet.has(table));
    const stageMismatch = seeds.applied > 0 && migrations.applied < minimumMigrationForSeeds(seeds.applied);
    if (missing.length || unknown.length || stageMismatch) {
        return { state: 'TEST_INSEGURO', missing, unknown, stage_mismatch: stageMismatch };
    }
    if (migrations.applied === 0 && seeds.applied === 0) return { state: 'TEST_VAZIO', missing: [], unknown: [], stage_mismatch: false };
    if (migrations.complete && seeds.complete) return { state: 'TEST_COMPLETO', missing: [], unknown: [], stage_mismatch: false };
    return { state: 'TEST_PREFIXO_ATUALIZAVEL', missing: [], unknown: [], stage_mismatch: false };
}

export function inspectSchemaFeatures({ columns = [], indexes = [] }, migrationCount) {
    const columnSet = new Set(columns.map((item) => `${item.table_name ?? item.table}:${item.column_name ?? item.column}`));
    const indexSet = new Set(indexes.map((item) => item.indexname ?? item.name));
    const missingColumns = SCHEMA_COLUMNS
        .filter((item) => item.migration <= migrationCount && !columnSet.has(`${item.table}:${item.column}`));
    const prematureColumns = SCHEMA_COLUMNS
        .filter((item) => item.migration > migrationCount && columnSet.has(`${item.table}:${item.column}`));
    const missingIndexes = SCHEMA_INDEXES
        .filter((item) => item.migration <= migrationCount && !indexSet.has(item.name));
    const prematureIndexes = SCHEMA_INDEXES
        .filter((item) => item.migration > migrationCount && indexSet.has(item.name));
    if (missingColumns.length || prematureColumns.length || missingIndexes.length || prematureIndexes.length) {
        throw new TestIntegrityError('Colunas ou indices nao correspondem ao estagio indicado pelo historico de migrations.', 'SCHEMA_FEATURE_MISMATCH', {
            missingColumns, prematureColumns, missingIndexes, prematureIndexes,
        });
    }
    return { valid: true };
}

export function parseAuthorizationList(value) {
    if (!value?.trim()) return [];
    return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function assertExactAuthorization(pending, authorized, kind) {
    if (JSON.stringify(pending) !== JSON.stringify(authorized)) {
        throw new TestIntegrityError(`Autorizacao de ${kind} deve corresponder exatamente aos arquivos pendentes e na mesma ordem.`, `${kind.toUpperCase()}_AUTHORIZATION_MISMATCH`, { pending, authorized });
    }
}

export function assertSnapshotUnchanged(before, after) {
    if (!before?.fingerprint || !after?.fingerprint || before.fingerprint !== after.fingerprint) {
        throw new TestIntegrityError('Snapshot somente leitura de development mudou durante a operacao; trate como interferencia externa e interrompa.', 'DEVELOPMENT_SNAPSHOT_CHANGED');
    }
    return true;
}
