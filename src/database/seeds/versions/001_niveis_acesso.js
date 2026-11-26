export async function apply(trx) {
  await trx('niveis_acesso').insert([
    { nome: 'admin', descricao: 'Acesso administrativo total', ativo: true },
    { nome: 'atendente', descricao: 'Permissoes definidas individualmente', ativo: true },
    { nome: 'entregador', descricao: 'Permissoes definidas individualmente', ativo: true },
  ]).onConflict('nome').ignore();
}
