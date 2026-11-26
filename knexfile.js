import 'dotenv/config';

const ssl = () => {
  if (process.env.DB_SSL_MODE === 'disable') return false;
  if (process.env.DB_SSL_CA) return { rejectUnauthorized: true, ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') };
  return process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined;
};

const makeConfig = (connection) => ({
  client: 'pg',
  connection: connection ? { connectionString: connection, ssl: ssl() } : undefined,
  pool: { min: Number(process.env.DB_POOL_MIN ?? 0), max: Number(process.env.DB_POOL_MAX ?? 10) },
  migrations: { directory: './src/database/migrations', extension: 'js', tableName: 'knex_migrations' },
});

export default {
  development: makeConfig(process.env.DATABASE_URL),
  test: makeConfig(process.env.DATABASE_TEST_URL),
  production: makeConfig(process.env.DATABASE_URL),
};
