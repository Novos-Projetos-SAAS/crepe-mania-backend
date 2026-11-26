import { pathToFileURL } from 'node:url';
import { closeDb, getDb } from '../src/database/connection.js';
import { logger } from '../src/config/logger.js';
import { runMaintenance } from '../src/services/maintenanceService.js';

export function parseMaintenanceArgs(args) {
  const values = Object.fromEntries(args.filter((arg) => arg.startsWith('--') && arg.includes('=')).map((arg) => arg.slice(2).split(/=(.*)/s)));
  const number = (name) => values[name] == null ? undefined : Number(values[name]);
  return {
    execute: args.includes('--execute'),
    batchSize: number('batch'),
    sessionRetentionDays: number('sessions-days'),
    pushRetentionDays: number('push-days'),
    printRetentionDays: number('prints-days'),
    subscriptionRetentionDays: number('subscriptions-days'),
  };
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseMaintenanceArgs(args);
  const options = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined));
  const results = await runMaintenance(getDb(), options);
  logger.info({ dry_run: !options.execute, resultados: results }, 'Manutencao concluida');
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().finally(closeDb).catch((error) => {
    logger.error({ err: error }, 'Falha na manutencao');
    process.exitCode = 1;
  });
}
