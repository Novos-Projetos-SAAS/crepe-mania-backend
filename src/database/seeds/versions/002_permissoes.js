import { PERMISSIONS } from '../../../config/constants.js';

export async function apply(trx) {
  await trx('permissoes').insert(PERMISSIONS.map((nome) => ({
    nome,
    descricao: `Permite ${nome.replace('.', ': ')}`,
  }))).onConflict('nome').ignore();
}
