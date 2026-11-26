import { describe, expect, it, vi } from 'vitest';

const key = Buffer.alloc(32, 7).toString('base64');
function fixture() {
  let row = { id: 1, ativo: false, pix_habilitado: false, credito_habilitado: false, versao: 1 };
  const credentials = [];
  const repo = {
    audit: { registrar: vi.fn(async () => {}) },
    database: { transaction: (callback) => callback({}) },
    ensureConfiguration: vi.fn(async () => {}),
    configuration: vi.fn(async () => ({ ...row })),
    insertCredential: vi.fn(async (data) => { const saved = { ...data, id: credentials.length + 1 }; credentials.push(saved); return saved; }),
    credential: vi.fn(async (id) => credentials.find((item) => item.id === id)),
    updateConfiguration: vi.fn(async (data) => { row = { ...row, ...data }; return row; }),
  };
  return { repo, credentials };
}
const settings = { ativo: true, credito_habilitado: true, pix_habilitado: true, handle: 'crepe-mania', api_key: 'inchk_fixture', backend_public_url: 'https://api.example.test', redirect_url: 'https://front.example.test/pedido/confirmado', versao: 1 };

describe('configuracao financeira', () => {
  it('comeca desligada e cifra/omite segredo, preservando a versao antiga na rotacao', async () => {
    const { InfinitepayConfigService } = await import('../../src/services/infinitepayConfigService.js');
    const { repo, credentials } = fixture();
    const service = new InfinitepayConfigService({ repo, audit: repo.audit, key: () => key, origins: () => ['https://front.example.test'] });
    expect(await service.read()).toMatchObject({ ativo: false });
    const saved = await service.update(settings, { user: { id: 1 } });
    expect(saved).toMatchObject({ ativo: true, has_api_key: true, versao: 2 });
    expect(JSON.stringify(saved)).not.toContain('inchk_fixture');
    expect(saved).not.toHaveProperty('api_key_ciphertext');
    expect(repo.audit.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'INFINITEPAY.CONFIGURAR', usuarioId: 1 }));
    await service.update({ api_key: 'inchk_replacement', versao: 2 }, { user: { id: 1 } });
    expect(credentials).toHaveLength(2);
    expect(credentials[0].api_key_ciphertext).not.toContain('inchk_fixture');
    await expect(service.update({ versao: 1 }, { user: { id: 1 } })).rejects.toMatchObject({ code: 'INFINITEPAY_CONFIG_VERSION_CONFLICT' });
  });
  it('recusa chave ausente, URLs hostis e PIX sem cartao antes de salvar', async () => {
    const { InfinitepayConfigService } = await import('../../src/services/infinitepayConfigService.js');
    const { repo } = fixture();
    const service = new InfinitepayConfigService({ repo, audit: repo.audit, key: () => undefined, origins: () => ['https://front.example.test'] });
    await expect(service.update(settings, { user: { id: 1 } })).rejects.toThrow();
    expect(repo.updateConfiguration).not.toHaveBeenCalled();
    const validKey = new InfinitepayConfigService({ repo, audit: repo.audit, key: () => key, origins: () => ['https://front.example.test'] });
    await expect(validKey.update({ ...settings, credito_habilitado: false }, { user: { id: 1 } })).rejects.toThrow();
    await expect(validKey.update({ ...settings, redirect_url: 'https://attacker.test' }, { user: { id: 1 } })).rejects.toThrow();
    await expect(validKey.update({ ...settings, backend_public_url: 'http://api.example.test' }, { user: { id: 1 } })).rejects.toThrow();
  });
});
