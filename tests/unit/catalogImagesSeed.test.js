import { describe, expect, it, vi } from 'vitest';
import { PRODUTOS } from '../../src/database/seeds/versions/011_cardapio_crepe_mania.js';
import { IMAGE_PRODUCTS, apply, catalogImageBaseUrl } from '../../src/database/seeds/versions/015_imagens_produtos_crepe_mania.js';

function createCatalogDb({ omit, custom } = {}) {
  const slugs = [...new Set(PRODUTOS.map((item) => item.categoria))];
  const categories = slugs.map((slug, index) => ({ id: index + 1, slug }));
  const products = PRODUTOS.filter((item) => item.nome !== omit?.nome || item.categoria !== omit?.categoria)
    .map((item, index) => ({ id: index + 1, categoria_id: categories.find((row) => row.slug === item.categoria).id,
      nome: item.nome, imagem_url: item.nome === custom?.nome && item.categoria === custom?.categoria ? custom.url : null }));
  const updates = [];
  const trx = (table) => {
    if (table === 'categorias_produtos') return { select: async () => categories };
    if (table !== 'produtos') throw new Error(`Tabela inesperada: ${table}`);
    return {
      select: async () => products,
      where({ id }) {
        return {
          whereRaw(clause) {
            expect(clause).toBe("NULLIF(BTRIM(imagem_url), '') IS NULL");
            return {
              async update(patch) {
                expect(Object.keys(patch)).toEqual(['imagem_url']);
                const row = products.find((item) => item.id === id);
                if (row.imagem_url?.trim()) return 0;
                row.imagem_url = patch.imagem_url;
                updates.push({ id, patch });
                return 1;
              },
            };
          },
        };
      },
    };
  };
  return { trx, categories, products, updates };
}

describe('seed 015 de imagens do catálogo', () => {
  it('mapeia sem colisão os 68 produtos com imagem aprovada', () => {
    expect(IMAGE_PRODUCTS).toHaveLength(68);
    const keys = IMAGE_PRODUCTS.map(({ categoria, nome }) => `${categoria}/${nome}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of IMAGE_PRODUCTS) {
      expect(PRODUTOS).toContainEqual(expect.objectContaining({ categoria: item.categoria, nome: item.nome }));
      expect(item.path).toMatch(/^\/images\/produtos\/[a-z-]+\/[a-z0-9-]+\.webp$/);
    }
    expect(IMAGE_PRODUCTS.find((item) => item.categoria === 'crepes-salgados' && item.nome === 'Calabresa')?.path)
      .not.toBe(IMAGE_PRODUCTS.find((item) => item.categoria === 'pizzas-salgadas' && item.nome === 'Calabresa')?.path);
  });

  it('usa somente origem HTTPS do frontend', () => {
    expect(catalogImageBaseUrl({})).toBe('https://crepe-mania.vercel.app');
    expect(catalogImageBaseUrl({ CATALOG_IMAGE_BASE_URL: 'https://loja.example.com/' })).toBe('https://loja.example.com');
    expect(() => catalogImageBaseUrl({ CATALOG_IMAGE_BASE_URL: 'http://loja.example.com' })).toThrow();
    expect(() => catalogImageBaseUrl({ CATALOG_IMAGE_BASE_URL: 'https://loja.example.com/subpath' })).toThrow();
  });

  it('atualiza apenas URLs vazias, respeita categoria, preserva URL manual e é idempotente', async () => {
    const custom = { categoria: 'pizzas-salgadas', nome: 'Calabresa', url: 'https://fotos.example.com/minha-pizza.webp' };
    const db = createCatalogDb({ custom });
    const first = await apply(db.trx, { env: { CATALOG_IMAGE_BASE_URL: 'https://crepe-mania.vercel.app' } });
    expect(first.mapeados).toBe(68);
    expect(first.naoEncontrados).toEqual([]);
    expect(db.updates).toHaveLength(67);
    const pizza = db.products.find((row) => row.id === db.updates.find((row) => row.patch.imagem_url.includes('/pizzas-salgadas/frango-com-catupiry'))?.id);
    expect(pizza?.nome).toBe('Frango com Catupiry');
    expect(db.products.find((row) => row.imagem_url === custom.url)).toBeTruthy();
    expect(db.products.find((row) => row.nome === 'Calabresa' && row.categoria_id === db.categories.find((category) => category.slug === 'crepes-salgados').id)?.imagem_url)
      .toBe('https://crepe-mania.vercel.app/images/produtos/crepes-salgados/calabresa.webp');
    await apply(db.trx, { env: {} });
    expect(db.updates).toHaveLength(67);
  });

  it('registra produtos não encontrados sem criar registros', async () => {
    const missing = { categoria: 'pasteis-salgados', nome: 'Carne' };
    const db = createCatalogDb({ omit: missing });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await apply(db.trx, { env: {} });
      expect(result.naoEncontrados).toEqual(['pasteis-salgados / Carne (0 correspondências)']);
      expect(warn).toHaveBeenCalledOnce();
      expect(db.products).toHaveLength(74);
    } finally {
      warn.mockRestore();
    }
  });
});
