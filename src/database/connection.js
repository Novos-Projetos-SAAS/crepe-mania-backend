import knex from 'knex';
import knexConfigs from '../../knexfile.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

let instance;

export function getDb() {
  if (!instance) {
    const url = env.NODE_ENV === 'test' ? env.DATABASE_TEST_URL : env.DATABASE_URL;
    if (!url) throw new AppError('Banco de dados ainda nao configurado.', 503, 'DATABASE_NOT_CONFIGURED');
    instance = knex(knexConfigs[env.NODE_ENV]);
  }
  return instance;
}

export async function closeDb() {
  if (instance) await instance.destroy();
  instance = undefined;
}
