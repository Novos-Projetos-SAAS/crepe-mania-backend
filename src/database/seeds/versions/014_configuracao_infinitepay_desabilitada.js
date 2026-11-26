export async function apply(trx) {
  await trx('infinitepay_configuracoes').insert({
    id: 1,
    ativo: false,
    pix_habilitado: false,
    credito_habilitado: false,
    assured_installments: 0,
    versao: 1,
  }).onConflict('id').ignore();
}
