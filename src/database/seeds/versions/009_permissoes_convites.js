import { STAGE_7_PERMISSIONS } from '../../../config/constants.js';

export async function apply(trx) {
  const descriptions = {
    'convites.listar': 'Permite listar convites de colaboradores sem acessar tokens',
    'convites.gerenciar': 'Permite criar, revogar e reemitir convites de colaboradores',
  };
  await trx('permissoes').insert(STAGE_7_PERMISSIONS.map((nome) => ({
    nome,
    descricao: descriptions[nome],
  }))).onConflict('nome').ignore();
}
