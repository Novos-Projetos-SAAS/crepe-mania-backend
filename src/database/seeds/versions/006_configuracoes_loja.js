export async function apply(trx) {
  await trx('configuracoes_loja').insert({
    id: 1,
    nome_fantasia: 'Crepe Mania',
    taxa_entrega: '0.00',
    aceitar_pedidos: false,
    imprimir_automaticamente: false,
    tamanho_papel: '58mm',
    timezone: 'America/Sao_Paulo',
  }).onConflict('id').ignore();
}
