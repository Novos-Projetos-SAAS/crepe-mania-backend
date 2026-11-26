import { CatalogRepository } from '../repositories/catalogRepository.js';
import { auditService } from './auditService.js';
import { AppError } from '../utils/AppError.js';
import { infinitepayConfigService } from './infinitepayConfigService.js';
import { deriveOnlinePolicy } from '../payments/orderPaymentPolicy.js';

function nestMenu({ categories, products, additionals }) {
  return categories.map((category) => ({
    ...category,
    produtos: products.filter((product) => String(product.categoria_id) === String(category.id))
      .map((product) => ({
      ...product,
      adicionais: additionals.filter((item) => String(item.produto_id) === String(product.id)),
      })),
  })).filter((category) => category.produtos.length > 0);
}

export class CatalogService {
  constructor(repository = new CatalogRepository()) { this.repository = repository; }
  list(name, query) { return this.repository.list(name, query); }

  async publicPaymentMethods() {
    const result = await this.list('metodos-pagamento', { page: 1, limit: 100, ativo: true });
    const config = await infinitepayConfigService.read();
    return result.items.map(({ id, codigo, nome }) => ({ id, codigo, nome, online_habilitado: Boolean(deriveOnlinePolicy(config, 'WEB', codigo)) }));
  }

  async publicMenu() { return nestMenu(await this.repository.publicMenu()); }
  async publicProduct(id) {
    const menu = await this.publicMenu();
    const product = menu.flatMap((category) => category.produtos).find((item) => String(item.id) === String(id));
    if (!product) throw new AppError('Produto nao encontrado ou indisponivel.', 404, 'PRODUCT_NOT_FOUND');
    return product;
  }

  async get(name, id) {
    const row = await this.repository.find(name, id);
    if (!row) throw new AppError('Registro nao encontrado.', 404, 'NOT_FOUND');
    return row;
  }

  async getProductLinks(productId) {
    const product = await this.repository.find('produtos', productId);
    if (!product) throw new AppError('Produto nao encontrado.', 404, 'PRODUCT_NOT_FOUND');
    const { additionals } = await this.repository.productLinks(productId);
    return { produto_id: String(product.id), adicionais: additionals };
  }

  async validateProductActivation(product, trx) {
    if (!product.ativo) return;
    if (product.preco_base == null) throw new AppError('Informe o preço base antes de ativar o produto.', 422, 'PRODUCT_PRICE_REQUIRED', [{ path: 'preco_base', message: 'Informe o preço base antes de ativar o produto.' }]);
    const category = await trx('categorias_produtos').where({ id: product.categoria_id, ativo: true }).whereNull('deletado_em').first();
    if (!category) throw new AppError('Selecione uma categoria ativa antes de ativar o produto.', 422, 'ACTIVE_CATEGORY_REQUIRED', [{ path: 'categoria_id', message: 'Selecione uma categoria ativa.' }]);
  }

  async create(name, data, context) {
    const db = this.repository.database;
    return db.transaction(async (trx) => {
      const row = await this.repository.insert(name, data, trx);
      if (name === 'produtos') await this.validateProductActivation(row, trx);
      await auditService.registrar({ trx, usuarioId: context.user.id, acao: `${name.toUpperCase()}.CRIAR`, descricao: `Cadastro criado em ${name}`, recursoTipo: name, recursoId: row.id, ...context, payload: { id: row.id } });
      return row;
    });
  }

  async update(name, id, data, context) {
    const db = this.repository.database;
    return db.transaction(async (trx) => {
      const before = await this.repository.find(name, id, trx);
      if (!before) throw new AppError('Registro nao encontrado.', 404, 'NOT_FOUND');
      const row = await this.repository.update(name, id, data, trx);
      if (name === 'produtos') await this.validateProductActivation(row, trx);
      await auditService.registrar({ trx, usuarioId: context.user.id, acao: `${name.toUpperCase()}.EDITAR`, descricao: `Cadastro alterado em ${name}`, recursoTipo: name, recursoId: id, ...context, payload: { antes: before, depois: row } });
      return row;
    });
  }

  async remove(name, id, context) {
    const db = this.repository.database;
    return db.transaction(async (trx) => {
      const before = await this.repository.find(name, id, trx);
      if (!before) throw new AppError('Registro nao encontrado.', 404, 'NOT_FOUND');
      const row = await this.repository.remove(name, id, trx);
      const archived = name === 'produtos';
      await auditService.registrar({ trx, usuarioId: context.user.id, acao: `${name.toUpperCase()}.${archived ? 'ARQUIVAR' : 'DESATIVAR'}`, descricao: archived ? 'Produto arquivado' : `Cadastro desativado em ${name}`, recursoTipo: name, recursoId: id, ...context, payload: { antes: before, depois: row } });
      return row;
    });
  }

  async deactivateProduct(id, context) {
    const db = this.repository.database;
    return db.transaction(async (trx) => {
      const before = await this.repository.find('produtos', id, trx);
      if (!before) throw new AppError('Produto nao encontrado.', 404, 'PRODUCT_NOT_FOUND');
      const row = await this.repository.setProductState(id, { ativo: false, disponivel_hoje: false }, trx);
      await auditService.registrar({ trx, usuarioId: context.user.id, acao: 'PRODUTOS.DESATIVAR', descricao: 'Produto desativado sem arquivamento', recursoTipo: 'produtos', recursoId: id, ...context, payload: { antes: before, depois: row } });
      return row;
    });
  }

  async reactivateProduct(id, context) {
    const db = this.repository.database;
    return db.transaction(async (trx) => {
      const before = await this.repository.find('produtos', id, trx);
      if (!before) throw new AppError('Produto nao encontrado.', 404, 'PRODUCT_NOT_FOUND');
      const next = { ...before, ativo: true, disponivel_hoje: false };
      await this.validateProductActivation(next, trx);
      const row = await this.repository.setProductState(id, { ativo: true, disponivel_hoje: false }, trx);
      await auditService.registrar({ trx, usuarioId: context.user.id, acao: 'PRODUTOS.REATIVAR', descricao: 'Produto reativado e mantido indisponivel no dia', recursoTipo: 'produtos', recursoId: id, ...context, payload: { antes: before, depois: row } });
      return row;
    });
  }

  async restoreProduct(id, context) {
    const db = this.repository.database;
    return db.transaction(async (trx) => {
      const before = await this.repository.find('produtos', id, trx, { includeDeleted: true });
      if (!before) throw new AppError('Produto nao encontrado.', 404, 'PRODUCT_NOT_FOUND');
      if (before.deletado_em == null) throw new AppError('O produto nao esta arquivado.', 409, 'PRODUCT_NOT_ARCHIVED');
      const row = await this.repository.restoreProduct(id, trx);
      await auditService.registrar({ trx, usuarioId: context.user.id, acao: 'PRODUTOS.RESTAURAR', descricao: 'Produto restaurado como inativo e indisponivel', recursoTipo: 'produtos', recursoId: id, ...context, payload: { antes: before, depois: row } });
      return row;
    });
  }

  async replaceLinks(type, productId, links, context) {
    const db = this.repository.database;
    return db.transaction(async (trx) => {
      const product = await this.repository.find('produtos', productId, trx);
      if (!product) throw new AppError('Produto nao encontrado.', 404, 'PRODUCT_NOT_FOUND');
      const ids = links.map((item) => item.adicional_id);
      if (new Set(ids.map(String)).size !== ids.length) throw new AppError('IDs duplicados nao sao permitidos.', 422, 'DUPLICATE_LINK');
      await this.repository.replaceAdditionals(productId, links, trx);
      await this.validateProductActivation(product, trx);
      await auditService.registrar({ trx, usuarioId: context.user.id, acao: 'PRODUTO.ADICIONAIS', descricao: 'Opcoes do produto atualizadas', recursoTipo: 'produto', recursoId: productId, ...context, payload: { ids } });
      return { produto_id: productId, quantidade_vinculos: links.length };
    });
  }
}

export const catalogService = new CatalogService();
