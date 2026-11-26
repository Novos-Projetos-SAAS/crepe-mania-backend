import { createHash } from 'node:crypto';
import pg from 'pg';
import { AppError } from '../utils/AppError.js';

function parsePostgresUrl(value, variableName) {
  if (!value) throw new AppError(`${variableName} obrigatoria para testes de integracao.`, 503, 'TEST_DATABASE_NOT_CONFIGURED');
  let parsed;
  try { parsed = new URL(value); } catch { throw new AppError(`${variableName} invalida.`, 500, 'UNSAFE_TEST_DATABASE'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) {
    throw new AppError(`${variableName} deve ser uma URL PostgreSQL completa.`, 500, 'UNSAFE_TEST_DATABASE');
  }
  return parsed;
}

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function databaseIdentityKey(identity) {
  if (!identity?.databaseName || !identity?.tlsProtocol) {
    throw new AppError('Identidade PostgreSQL incompleta ou TLS nao comprovado; falha fechada.', 500, 'DATABASE_IDENTITY_INCOMPLETE');
  }
  const hasProject = Boolean(identity.projectId);
  const hasBranch = Boolean(identity.branchId);
  if (hasProject !== hasBranch) {
    throw new AppError('Identidade Neon parcial ou ambigua; falha fechada.', 500, 'DATABASE_IDENTITY_INCOMPLETE');
  }
  if (hasProject && hasBranch) return `neon:${identity.projectId}:${identity.branchId}:database:${identity.databaseName}`;
  if (identity.systemIdentifier) return `system:${identity.systemIdentifier}:database:${identity.databaseName}`;
  throw new AppError('Destino PostgreSQL sem identidade estavel suficiente; hostname ou endpoint nao provam isolamento.', 500, 'DATABASE_IDENTITY_INCOMPLETE');
}

export async function readDatabaseIdentity(databaseUrl, { clientFactory } = {}) {
  parsePostgresUrl(databaseUrl, 'URL de banco');
  const client = clientFactory
    ? clientFactory(databaseUrl)
    : new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 10000,
      query_timeout: 10000,
      application_name: 'crepe_mania_test_guard',
    });
  try {
    await client.connect();
    const stream = client.connection?.stream;
    if (!stream?.encrypted || stream.authorized !== true) {
      throw new AppError('Conexao PostgreSQL de teste deve usar TLS autorizado.', 500, 'UNSAFE_TEST_DATABASE');
    }
    await client.query('SET default_transaction_read_only = on');
    const { rows: [row] } = await client.query(`
      SELECT
        current_database() AS database_name,
        (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid,
        current_setting('neon.project_id', true) AS project_id,
        current_setting('neon.branch_id', true) AS branch_id,
        current_setting('neon.endpoint_id', true) AS endpoint_id
    `);
    let systemIdentifier = null;
    try {
      const result = await client.query('SELECT system_identifier::text AS value FROM pg_control_system()');
      systemIdentifier = result.rows[0]?.value ?? null;
    } catch {
      // Neon normalmente permite esta leitura; os IDs Neon/host são o fallback.
    }
    return {
      databaseName: row.database_name,
      databaseOid: row.database_oid,
      projectId: row.project_id,
      branchId: row.branch_id,
      endpointId: row.endpoint_id,
      systemIdentifier,
      tlsProtocol: typeof stream.getProtocol === 'function' ? stream.getProtocol() : null,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

export async function assertSafeTestDatabase(testUrl, developmentUrl, options = {}) {
  const enabled = options.enabled ?? process.env.RUN_DB_INTEGRATION === 'true';
  const nodeEnv = options.nodeEnv ?? process.env.INTEGRATION_SOURCE_NODE_ENV ?? process.env.NODE_ENV ?? 'development';
  if (!enabled) throw new AppError('Testes de integracao exigem RUN_DB_INTEGRATION=true.', 403, 'INTEGRATION_NOT_ENABLED');
  if (String(nodeEnv).toLowerCase() === 'production') throw new AppError('Testes de integracao sao proibidos em ambiente de producao.', 500, 'PRODUCTION_DATABASE_BLOCKED');

  parsePostgresUrl(testUrl, 'DATABASE_TEST_URL');
  parsePostgresUrl(developmentUrl, 'DATABASE_URL');
  if (testUrl === developmentUrl) throw new AppError('Banco de testes e desenvolvimento nao podem ser o mesmo.', 500, 'UNSAFE_TEST_DATABASE');

  const identityReader = options.identityReader ?? readDatabaseIdentity;
  const [testIdentity, developmentIdentity] = await Promise.all([
    identityReader(testUrl, options),
    identityReader(developmentUrl, options),
  ]);
  const testKey = databaseIdentityKey(testIdentity);
  const developmentKey = databaseIdentityKey(developmentIdentity);
  if (testKey === developmentKey) {
    throw new AppError('DATABASE_TEST_URL e DATABASE_URL resolvem para o mesmo banco PostgreSQL.', 500, 'UNSAFE_TEST_DATABASE');
  }

  return {
    safe: true,
    test: {
      identity_fingerprint: fingerprint(testKey),
      tls_protocol: testIdentity.tlsProtocol,
    },
    development: {
      identity_fingerprint: fingerprint(developmentKey),
      tls_protocol: developmentIdentity.tlsProtocol,
    },
  };
}
