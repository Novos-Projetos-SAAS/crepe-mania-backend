import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { priceOrder } from '../../src/services/orderPricingService.js';
import { createOrderSchema, productSchema } from '../../src/validators/schemas.js';
import { PRODUTOS } from '../../src/database/seeds/versions/011_cardapio_crepe_mania.js';
import { seedFiles } from '../../src/database/seeds/seedManifest.js';

const product = { id: '1', nome: 'Crepe de Frango', tipo: 'CREPE', categoria_nome: 'Crepes salgados', preco_base: '18.00', ativo: true, disponivel_hoje: true, categoria_ativa: true, categoria_deletada_em: null, deletado_em: null };
const baseOrder = { cliente: { nome: 'Pessoa Teste', telefone: '18999999999' }, tipo_entrega: 'RETIRADA', metodo_pagamento_id: '1', itens: [{ produto_id: '1', quantidade: 2, adicionais: [{ adicional_id: '2', quantidade: 1 }] }], precisa_troco: false };
const catalog = { products: [product], additionals: [{ id: '2', produto_id: '1', nome: 'Queijo extra', preco: '3.00', ativo: true, disponivel_hoje: true, vinculo_ativo: true, max_quantidade_por_item: 3 }], paymentMethod: { id: '1', codigo: 'PIX', nome: 'Pix' } };

describe('Crepe Mania: fluxo de produto sem pão', () => {
  it('calcula crepe e adicional com quantidade e valores monetarios em centavos', () => {
    const result = priceOrder(baseOrder, catalog, { taxa_entrega: '5.00' });
    expect(result.subtotal).toBe('42.00');
    expect(result.total).toBe('42.00');
    expect(result.items[0].adicionais[0].subtotal).toBe('6.00');
    expect(Object.keys(result.items[0])).not.toContain('tipo_pao_id');
  });
  it('aceita pastel e acai no contrato generico de produtos', () => {
    for (const tipo of ['CREPE', 'PASTEL', 'PIZZA', 'BEBIDA', 'SUCO', 'ACAI', 'OUTRO']) {
      const parsed = productSchema.safeParse({ categoria_id: '1', nome: 'Produto de teste', tipo, preco_base: '12.00' });
      expect(parsed.success).toBe(true);
    }
  });
  it('nao aceita tipo_pao_id no payload de pedido', () => {
    expect(createOrderSchema.safeParse(baseOrder).success).toBe(true);
    const old = structuredClone(baseOrder);
    old.itens[0].tipo_pao_id = '2';
    expect(createOrderSchema.safeParse(old).success).toBe(false);
  });
  it('cadastra categorias de produtos do cliente, sem precos inventados', () => {
    expect(PRODUTOS).toHaveLength(75);
    for (const tipo of ['CREPE', 'PASTEL', 'PIZZA', 'BEBIDA', 'SUCO', 'ACAI']) expect(PRODUTOS.some((p) => p.tipo === tipo)).toBe(true);
  });
  it('mantem migrations 001-046 e seeds 001-015 em sequencia numerica', async () => {
    const files = (await readdir(new URL('../../src/database/migrations/', import.meta.url))).filter((f) => /^\d{3}_.*\.js$/.test(f)).sort();
    expect(files.map((f) => Number(f.slice(0, 3)))).toEqual(Array.from({ length: 46 }, (_, i) => i + 1));
    expect(seedFiles.map((f) => Number(f.slice(0, 3)))).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    const tableMigration = await readFile(new URL('../../src/database/migrations/017_itens_pedido.js', import.meta.url), 'utf8');
    expect(tableMigration).not.toMatch(/tipo_pao|acrescimo_pao/);
  });
});
