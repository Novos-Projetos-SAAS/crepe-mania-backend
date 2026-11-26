import { afterEach, expect, it, vi } from 'vitest';
import { CatalogService } from '../../src/services/catalogService.js';
import { infinitepayConfigService } from '../../src/services/infinitepayConfigService.js';

afterEach(() => vi.restoreAllMocks());

it('publica capacidade por modalidade sem expor configuracao privada', async () => {
  vi.spyOn(infinitepayConfigService, 'read').mockResolvedValue({ ativo: true, pix_habilitado: false, credito_habilitado: true, handle: 'secret-account' });
  const service = new CatalogService({ list: async () => ({ items: [{ id: '1', codigo: 'PIX', nome: 'Pix' }, { id: '2', codigo: 'CREDITO', nome: 'Credito' }] }) });
  const methods = await service.publicPaymentMethods();
  expect(methods[0]).toMatchObject({ online_habilitado: false });
  expect(methods[1]).toMatchObject({ online_habilitado: true });
  expect(JSON.stringify(methods)).not.toContain('secret-account');
});
