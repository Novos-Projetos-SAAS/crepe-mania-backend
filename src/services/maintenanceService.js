const DAY = 86400000;

export const MAINTENANCE_DEFAULTS = Object.freeze({
  batchSize: 500,
  sessionRetentionDays: 30,
  pushRetentionDays: 30,
  printRetentionDays: 90,
  subscriptionRetentionDays: 30,
});

export function maintenanceTargetNames() {
  return ['idempotencia_requisicoes', 'sessoes', 'entregas_push', 'push_subscriptions', 'impressoes'];
}

function targetQueries(db, now, options) {
  const cutoff = (days) => new Date(now.getTime() - days * DAY);
  return [
    {
      name: 'idempotencia_requisicoes',
      query: () => db('idempotencia_requisicoes').where('expira_em', '<', now),
    },
    {
      name: 'sessoes',
      query: () => db('sessoes').where((builder) => builder
        .where('expira_em', '<', cutoff(options.sessionRetentionDays))
        .orWhere('revogada_em', '<', cutoff(options.sessionRetentionDays))),
    },
    {
      name: 'entregas_push',
      query: () => db('entregas_push').whereIn('status', ['ENVIADO', 'DESCARTADO', 'FALHOU'])
        .where('atualizado_em', '<', cutoff(options.pushRetentionDays)),
    },
    {
      name: 'push_subscriptions',
      query: () => db('push_subscriptions').where({ ativo: false })
        .where('atualizado_em', '<', cutoff(options.subscriptionRetentionDays)),
    },
    {
      name: 'impressoes',
      query: () => db('impressoes').whereIn('status', ['CONCLUIDA', 'FALHOU'])
        .where('atualizado_em', '<', cutoff(options.printRetentionDays)),
    },
  ];
}

export async function runMaintenance(db, input = {}) {
  const options = { ...MAINTENANCE_DEFAULTS, ...input };
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 5000) throw new Error('batchSize deve estar entre 1 e 5000.');
  const now = options.now ?? new Date();
  const results = [];
  for (const target of targetQueries(db, now, options)) {
    if (!options.execute) {
      const [{ total }] = await target.query().clone().count('* as total');
      results.push({ recurso: target.name, candidatos: Number(total), removidos: 0, dry_run: true });
      continue;
    }
    let removed = 0;
    while (true) {
      const rows = await target.query().clone().select('id').orderBy('id').limit(options.batchSize);
      if (!rows.length) break;
      const ids = rows.map((row) => row.id);
      removed += await db(target.name).whereIn('id', ids).delete();
      if (rows.length < options.batchSize) break;
    }
    results.push({ recurso: target.name, candidatos: removed, removidos: removed, dry_run: false });
  }
  return results;
}
