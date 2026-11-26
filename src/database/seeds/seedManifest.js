import { readFile } from 'node:fs/promises';
import { matchesSeedChecksum, seedChecksums } from './seedChecksum.js';

export const seedFiles = [
  '001_niveis_acesso.js',
  '002_permissoes.js',
  '003_metodos_pagamento.js',
  '004_categorias_iniciais.js',
  '005_etapa_reservada.js',
  '006_configuracoes_loja.js',
  '007_admin_inicial.js',
  '008_permissoes_etapa_2.js',
  '009_permissoes_convites.js',
  '010_catalogo_relatorios.js',
  '011_cardapio_crepe_mania.js',
  '012_imagens_pendentes.js',
  '013_permissoes_infinitepay.js',
  '014_configuracao_infinitepay_desabilitada.js',
];

export async function loadSeedDescriptors(baseUrl = new URL('./versions/', import.meta.url)) {
  return Promise.all(seedFiles.map(async (file) => {
    const url = new URL(file, baseUrl);
    const source = await readFile(url);
    return { file, url, ...seedChecksums(source) };
  }));
}

export function classifySeed(descriptor, applied) {
  const row = applied.find((item) => item.nome_arquivo === descriptor.file);
  if (!row) return 'PENDENTE';
  return matchesSeedChecksum(descriptor, row.checksum_sha256) ? 'APLICADO' : 'ALTERADO';
}
