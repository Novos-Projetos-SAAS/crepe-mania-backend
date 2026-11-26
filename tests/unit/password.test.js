import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import argon2 from 'argon2';
import { ARGON2_OPTIONS, hashPassword, verifyPassword } from '../../src/utils/password.js';
import { AuthService } from '../../src/services/authService.js';
import { loadSeedDescriptors } from '../../src/database/seeds/seedManifest.js';
const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const PASSWORD = 'Senha-Forte-Para-Teste-123';

describe('senhas somente Argon2id', () => {
  it('gera hashes Argon2id distintos e autentica somente a senha correta', async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(a).not.toBe(b);
    expect(ARGON2_OPTIONS.memoryCost).toBe(19456);
    expect(await verifyPassword(PASSWORD, a)).toEqual({ valid: true, needsUpgrade: false });
    expect((await verifyPassword('Senha-Incorreta', a)).valid).toBe(false);
  });

  it('recusa hash bcrypt e entradas malformadas', async () => {
    expect(packageJson.dependencies?.bcrypt).toBeUndefined();
    expect(packageJson.devDependencies?.bcrypt).toBeUndefined();
    expect(await verifyPassword(PASSWORD, '$2b$12$hashlegado')).toEqual({ valid: false, needsUpgrade: false });
    expect((await verifyPassword(PASSWORD, 'hash-invalido')).valid).toBe(false);
    expect((await verifyPassword(PASSWORD, '$argon2id$invalido')).valid).toBe(false);
    expect((await verifyPassword(PASSWORD, null)).valid).toBe(false);
  });

  it('reconhece Argon2id que precisa de rehash por parametros antigos', async () => {
    const previous = await argon2.hash(PASSWORD, { ...ARGON2_OPTIONS, memoryCost: 8192 });
    expect(await verifyPassword(PASSWORD, previous)).toEqual({ valid: true, needsUpgrade: true });
  });

  it('refaz hash Argon2id com parametros atuais apos login correto', async () => {
    const previous = await argon2.hash(PASSWORD, { ...ARGON2_OPTIONS, memoryCost: 8192 });
    const repository = {
      findUserByEmail: vi.fn().mockResolvedValue({ id: 42, ativo: true, senha_hash: previous }),
      upgradePasswordHash: vi.fn().mockResolvedValue(1),
      createSession: vi.fn().mockResolvedValue(1),
      findActiveUserWithPermissions: vi.fn().mockResolvedValue({ id: 42, nome: 'Admin', permissoes: [] }),
    };
    const auth = new AuthService(repository);
    auth.accessToken = vi.fn().mockReturnValue('access-test');
    const result = await auth.login('admin@exemplo.com', PASSWORD);
    expect(result.user.id).toBe(42);
    expect(repository.upgradePasswordHash).toHaveBeenCalledOnce();
    const [userId, oldHash, newHash] = repository.upgradePasswordHash.mock.calls[0];
    expect(userId).toBe(42);
    expect(oldHash).toBe(previous);
    expect(newHash).toMatch(/^\$argon2id\$/);
    expect((await verifyPassword(PASSWORD, newHash)).needsUpgrade).toBe(false);
  });

  it('seed inicial usa Argon2id diretamente, sem adaptar bcrypt', async () => {
    const descriptors = await loadSeedDescriptors();
    const initial = descriptors.find((item) => item.file === '007_admin_inicial.js');
    expect(initial).toBeDefined();
    const seed = await import(initial.url.href);
    const fakeTrx = vi.fn((table) => {
      if (table === 'usuarios') return {
        whereRaw: () => ({ first: async () => undefined }),
        where: () => ({ whereNull: () => ({ first: async () => undefined }) }),
        insert: vi.fn(async (data) => { expect(data.senha_hash).toMatch(/^\$argon2id\$/); }),
      };
      if (table === 'niveis_acesso') return { where: () => ({ first: async () => ({ id: 1 }) }) };
      throw new Error('Tabela inesperada');
    });
    await seed.apply(fakeTrx, {
      env: { ADMIN_NAME: 'Admin', ADMIN_EMAIL: 'admin@exemplo.com', ADMIN_PASSWORD: PASSWORD },
      hashPassword,
    });
  });
});
