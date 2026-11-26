import { describe, expect, it, vi } from 'vitest';
import { paginationSchema, productListQuerySchema, reportGenerateSchema, userListQuerySchema } from '../../src/validators/schemas.js';
import { applyUserListFilters } from '../../src/repositories/userRepository.js';

describe('paginacao administrativa', () => {
  it('usa dez registros por pagina por padrao', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, limit: 10 });
    expect(reportGenerateSchema.parse({ filtros: {} })).toMatchObject({ page: 1, limit: 10 });
  });

  it('preserva o filtro booleano falso de usuarios', () => {
    expect(userListQuerySchema.parse({ ativo: 'false', busca: 'ana', page: '2' })).toMatchObject({ ativo: false, busca: 'ana', page: 2, limit: 10 });
    const query = {
      where: vi.fn(function where(field, _value) { if (typeof field === 'function') field(this); return this; }),
      whereILike: vi.fn(function whereILike() { return this; }),
      orWhereILike: vi.fn(function orWhereILike() { return this; }),
    };
    applyUserListFilters(query, { ativo: false, busca: 'ana' });
    expect(query.where).toHaveBeenCalledWith('u.ativo', false);
    expect(query.whereILike).toHaveBeenCalledWith('u.nome', '%ana%');
    expect(query.orWhereILike).toHaveBeenCalledWith('u.email', '%ana%');
  });

  it('combina filtros de produto sem confundir inativo com arquivado', () => {
    expect(productListQuerySchema.parse({ ativo: 'false', arquivado: 'false', categoria_id: '7', busca: 'x bacon', page: '2' })).toMatchObject({ ativo: false, arquivado: false, categoria_id: '7', busca: 'x bacon', page: 2, limit: 10 });
    expect(productListQuerySchema.parse({ arquivado: 'true' })).toMatchObject({ arquivado: true, page: 1, limit: 10 });
  });
});
