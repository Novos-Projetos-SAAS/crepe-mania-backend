import { pathToFileURL } from 'node:url';
import { getDb, closeDb } from '../connection.js';
import { loadSeedDescriptors, classifySeed } from './seedManifest.js';

export async function getSeedStatus(db = getDb()) {
  const [descriptors, applied] = await Promise.all([
    loadSeedDescriptors(),
    db('controle_seeds').select('nome_arquivo', 'checksum_sha256', 'executado_em').orderBy('nome_arquivo'),
  ]);
  return descriptors.map((descriptor) => ({
    arquivo: descriptor.file,
    status: classifySeed(descriptor, applied),
    executado_em: applied.find((item) => item.nome_arquivo === descriptor.file)?.executado_em ?? null,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  getSeedStatus()
    .then((status) => process.stdout.write(`${JSON.stringify(status, null, 2)}\n`))
    .finally(closeDb)
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
