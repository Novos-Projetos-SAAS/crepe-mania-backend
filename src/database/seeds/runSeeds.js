import { pathToFileURL } from 'node:url';
import { hashPassword } from '../../utils/password.js';
import { getDb, closeDb } from '../connection.js';
import { loadSeedDescriptors, classifySeed } from './seedManifest.js';

export async function applySeedDescriptor(db, descriptor, { importer = (url) => import(url.href), hashPasswordImpl = hashPassword } = {}) {
  return db.transaction(async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(?)', [834729104]);
      const applied = await trx('controle_seeds').where({ nome_arquivo: descriptor.file }).first();
      const state = classifySeed(descriptor, applied ? [applied] : []);
      if (state === 'ALTERADO') throw new Error(`Integridade violada: o seed aplicado ${descriptor.file} foi alterado. Crie uma nova versao.`);
      if (state === 'APLICADO') {
        return { file: descriptor.file, status: 'IGNORADO' };
      }
      const startedAt = Date.now();
      const module = await importer(descriptor.url);
      // Seeds recebem o algoritmo atual. As versoes aplicadas ficam imutaveis a partir da primeira execucao.
      await module.apply(trx, { env: process.env, hashPassword: hashPasswordImpl });
      await trx('controle_seeds').insert({
        nome_arquivo: descriptor.file,
        checksum_sha256: descriptor.checksum,
        duracao_ms: Date.now() - startedAt,
      });
      return { file: descriptor.file, status: 'APLICADO' };
  });
}

export async function runVersionedSeeds({ db = getDb(), importer = (url) => import(url.href) } = {}) {
  const descriptors = await loadSeedDescriptors();
  const result = [];
  for (const descriptor of descriptors) {
    result.push(await applySeedDescriptor(db, descriptor, { importer }));
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runVersionedSeeds()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .finally(closeDb)
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
