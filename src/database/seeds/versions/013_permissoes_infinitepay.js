export async function apply(trx) {
  await trx('permissoes').insert([
    { nome: 'infinitepay.visualizar', descricao: 'Permite consultar configuração InfinitePay sem credenciais' },
    { nome: 'infinitepay.configurar', descricao: 'Permite configurar modalidades e substituir credenciais InfinitePay' },
    { nome: 'pagamentos.listar', descricao: 'Permite consultar tentativas e pagamentos online' },
    { nome: 'pagamentos.conciliar', descricao: 'Permite solicitar verificação oficial de pagamentos online' },
  ]).onConflict('nome').ignore();
}
