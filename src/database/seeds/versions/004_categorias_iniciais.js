export async function apply(trx) {
  const categories = [
    ['Crepes salgados', 'crepes-salgados'], ['Crepes doces', 'crepes-doces'],
    ['Pastéis salgados', 'pasteis-salgados'], ['Pastéis doces', 'pasteis-doces'],
    ['Pizzas salgadas', 'pizzas-salgadas'], ['Pizzas doces', 'pizzas-doces'],
    ['Bebidas', 'bebidas'], ['Sucos naturais', 'sucos-naturais'],
    ['Açaí', 'acai'], ['Caldo de cana', 'caldo-de-cana'],
    ['Crepes no copo e barcas', 'crepes-no-copo-e-barcas'],
  ];
  await trx('categorias_produtos').insert(categories.map(([nome, slug], index) => ({ nome, slug, ordem_exibicao: index + 1, ativo: true }))).onConflict('slug').ignore();
}
