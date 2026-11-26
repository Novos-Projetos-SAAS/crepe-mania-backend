export async function apply(trx) {
  await trx('metodos_pagamento').insert([
    { codigo: 'PIX', nome: 'Pix', ativo: true, ordem_exibicao: 1 },
    { codigo: 'DINHEIRO', nome: 'Dinheiro', ativo: true, ordem_exibicao: 2 },
    { codigo: 'CREDITO', nome: 'Cartao de credito', ativo: true, ordem_exibicao: 3 },
    { codigo: 'DEBITO', nome: 'Cartao de debito', ativo: true, ordem_exibicao: 4 },
  ]).onConflict('codigo').ignore();
}
