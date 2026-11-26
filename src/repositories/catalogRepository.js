import { getDb } from '../database/connection.js';
import { AppError } from '../utils/AppError.js';

const entityMap = {
  categorias: { table: 'categorias_produtos', softDelete: true },
  produtos: { table: 'produtos', softDelete: true },
  adicionais: { table: 'adicionais', softDelete: true },
  'metodos-pagamento': { table: 'metodos_pagamento', softDelete: false },
};

export class CatalogRepository {
  constructor(db) { this.db = db; }
  get database() { return this.db ?? getDb(); }
  entity(name) {
    const config = entityMap[name];
    if (!config) throw new AppError('Entidade de catalogo invalida.', 400, 'INVALID_ENTITY');
    return config;
  }

  async list(name, { page = 1, limit = 10, ativo, busca, categoria_id, arquivado } = {}) {
    const { table, softDelete } = this.entity(name);
    const base = this.database({ entity: table });
    if (name === 'produtos') base.leftJoin({ category: 'categorias_produtos' }, 'category.id', 'entity.categoria_id');
    if (softDelete) {
      if (arquivado === true) base.whereNotNull('entity.deletado_em');
      else base.whereNull('entity.deletado_em');
    }
    if (ativo !== undefined) base.where('entity.ativo', ativo);
    if (busca) base.whereILike('entity.nome', `%${busca}%`);
    if (name === 'produtos' && categoria_id !== undefined) base.where('entity.categoria_id', categoria_id);
    const countQuery = base.clone().clearSelect().clearOrder().count('* as total').first();
    const itemsQuery = base.clone().select('entity.*');
    if (name === 'produtos') itemsQuery.select('category.nome as categoria_nome');
    itemsQuery.orderBy([{ column: 'entity.ordem_exibicao', order: 'asc' }, { column: 'entity.id', order: 'asc' }]).limit(limit).offset((page - 1) * limit);
    const [count, items] = await Promise.all([countQuery, itemsQuery]);
    return { items, total: Number(count.total) };
  }

  async find(name, id, trx = this.database, { includeDeleted = false } = {}) {
    const { table, softDelete } = this.entity(name);
    const query = trx(table).where({ id });
    if (softDelete && !includeDeleted) query.whereNull('deletado_em');
    return query.first();
  }

  async insert(name, data, trx = this.database) {
    const { table } = this.entity(name);
    const [row] = await trx(table).insert(data).returning('*');
    return row;
  }

  async update(name, id, data, trx = this.database) {
    const { table } = this.entity(name);
    const [row] = await trx(table).where({ id }).update({ ...data, atualizado_em: trx.fn.now() }).returning('*');
    return row;
  }

  async remove(name, id, trx = this.database) {
    const { table, softDelete } = this.entity(name);
    const data = softDelete ? { ativo: false, deletado_em: trx.fn.now(), atualizado_em: trx.fn.now() } : { ativo: false, atualizado_em: trx.fn.now() };
    if (name === 'produtos') data.disponivel_hoje = false;
    const [row] = await trx(table).where({ id }).update(data).returning('*');
    return row;
  }

  async setProductState(id, data, trx = this.database) {
    const [row] = await trx('produtos').where({ id }).whereNull('deletado_em')
      .update({ ...data, atualizado_em: trx.fn.now() }).returning('*');
    return row;
  }

  async restoreProduct(id, trx = this.database) {
    const [row] = await trx('produtos').where({ id }).whereNotNull('deletado_em')
      .update({ deletado_em: null, ativo: false, disponivel_hoje: false, atualizado_em: trx.fn.now() }).returning('*');
    return row;
  }

  async publicMenu(trx = this.database) {
    const categories = await trx('categorias_produtos').where({ ativo: true }).whereNull('deletado_em').orderBy(['ordem_exibicao', 'id']);
    const products = await trx('produtos as p').join('categorias_produtos as c', 'c.id', 'p.categoria_id')
      .where({ 'p.ativo': true, 'p.disponivel_hoje': true, 'c.ativo': true }).whereNull('p.deletado_em').whereNull('c.deletado_em').whereNotNull('p.preco_base')
      .select('p.*', 'c.nome as categoria_nome').orderBy([{ column: 'p.ordem_exibicao', order: 'asc' }, { column: 'p.id', order: 'asc' }]);
    const ids = products.map((p) => p.id);
    if (!ids.length) return { categories, products, additionals: [] };
    const additionals = await trx('produto_adicionais as pa').join('adicionais as a', 'a.id', 'pa.adicional_id').whereIn('pa.produto_id', ids).where({ 'pa.ativo': true, 'a.ativo': true, 'a.disponivel_hoje': true }).whereNull('a.deletado_em').select('pa.produto_id', 'a.id', 'a.nome', 'a.descricao', 'a.preco', 'pa.max_quantidade_por_item', 'a.ordem_exibicao');
    return { categories, products, additionals };
  }

  async catalogForPricing(productIds, paymentMethodId, trx = this.database) {
    const products = await trx('produtos as p').join('categorias_produtos as c', 'c.id', 'p.categoria_id')
      .whereIn('p.id', productIds).select('p.*', 'c.nome as categoria_nome', 'c.ativo as categoria_ativa', 'c.deletado_em as categoria_deletada_em');
    // Uma transaction do Knex usa um unico client pg; consultas simultaneas no
    // mesmo client serao rejeitadas no pg 9. Mantenha esta leitura sequencial.
    const additionals = await trx('produto_adicionais as pa').join('adicionais as a', 'a.id', 'pa.adicional_id').whereIn('pa.produto_id', productIds).select('pa.produto_id', 'pa.ativo as vinculo_ativo', 'pa.max_quantidade_por_item', 'a.*');
    const paymentMethod = await trx('metodos_pagamento').where({ id: paymentMethodId, ativo: true }).first();
    return { products, additionals, paymentMethod };
  }

  async productLinks(productId, trx = this.database) {
    const additionals = await trx('produto_adicionais as pa')
      .join('adicionais as a', 'a.id', 'pa.adicional_id')
      .where({ 'pa.produto_id': productId })
      .select('pa.adicional_id', 'pa.max_quantidade_por_item', 'pa.ativo', 'a.nome', 'a.preco', 'a.disponivel_hoje', 'a.deletado_em')
      .orderBy([{ column: 'a.ordem_exibicao', order: 'asc' }, { column: 'a.id', order: 'asc' }]);
    return { additionals };
  }

  async replaceAdditionals(productId, links, trx) {
    await trx('produto_adicionais').where({ produto_id: productId }).delete();
    if (links.length) await trx('produto_adicionais').insert(links.map((item) => ({ produto_id: productId, adicional_id: item.adicional_id, max_quantidade_por_item: item.max_quantidade_por_item, ativo: item.ativo })));
  }
}
