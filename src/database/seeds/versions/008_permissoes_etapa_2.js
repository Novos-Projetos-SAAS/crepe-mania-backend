import { STAGE_2_PERMISSIONS } from '../../../config/constants.js';

export async function apply(trx) {
  await trx('permissoes').insert(STAGE_2_PERMISSIONS.map((nome) => ({
    nome,
    descricao: nome === 'notificacoes.receber'
      ? 'Permite receber pedidos na inbox, Socket.IO e Web Push'
      : 'Permite redefinir a senha de outro colaborador ativo',
  }))).onConflict('nome').ignore();
}
