import { PRODUTOS } from './011_cardapio_crepe_mania.js';

// Estes itens aguardam confirmação comercial ou fotografia legítima da embalagem.
const PENDENTES = new Set([
  'bebidas\u0000Guaraná 2 Litros',
  'bebidas\u0000Coca-Cola 2 Litros',
  'bebidas\u0000Coca-Cola 600ml',
  'bebidas\u0000Coca-Cola Lata',
  'crepes-no-copo-e-barcas\u0000Barca P',
  'crepes-no-copo-e-barcas\u0000Barca M',
  'crepes-no-copo-e-barcas\u0000Barca G',
]);

const key = (categoria, nome) => `${categoria}\u0000${nome}`;
const slug = (name) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const IMAGE_PRODUCTS = PRODUTOS.filter(({ categoria, nome }) => !PENDENTES.has(key(categoria, nome)))
  .map(({ categoria, nome }) => ({ categoria, nome, path: `/images/produtos/${categoria}/${slug(nome)}.webp` }));

export function catalogImageBaseUrl(env = process.env) {
  const value = env.CATALOG_IMAGE_BASE_URL?.trim() || 'https://crepe-mania.vercel.app';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('CATALOG_IMAGE_BASE_URL deve ser uma origem HTTPS sem caminho, query ou fragmento.');
  }
  return url.origin;
}

export async function apply(trx, { env = process.env } = {}) {
  const baseUrl = catalogImageBaseUrl(env);
  const categories = await trx('categorias_produtos').select('id', 'slug');
  const categoryBySlug = new Map(categories.map((row) => [row.slug, row.id]));
  const products = await trx('produtos').select('id', 'categoria_id', 'nome', 'imagem_url');
  const productByKey = new Map();
  for (const product of products) {
    const compoundKey = key(product.categoria_id, product.nome);
    const matches = productByKey.get(compoundKey) || [];
    matches.push(product);
    productByKey.set(compoundKey, matches);
  }

  const missing = [];
  for (const image of IMAGE_PRODUCTS) {
    const categoryId = categoryBySlug.get(image.categoria);
    const matches = categoryId == null ? [] : productByKey.get(key(categoryId, image.nome)) || [];
    if (matches.length !== 1) {
      missing.push(`${image.categoria} / ${image.nome} (${matches.length} correspondências)`);
      continue;
    }
    const product = matches[0];
    if (product.imagem_url?.trim()) continue;
    const imagem_url = new URL(image.path, baseUrl).href;
    await trx('produtos').where({ id: product.id })
      .whereRaw("NULLIF(BTRIM(imagem_url), '') IS NULL")
      .update({ imagem_url });
  }
  if (missing.length) console.warn(`[seed 015] Produtos não encontrados ou duplicados: ${missing.join('; ')}`);
  return { mapeados: IMAGE_PRODUCTS.length, naoEncontrados: missing };
}
