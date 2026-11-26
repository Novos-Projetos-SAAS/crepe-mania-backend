import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { classifySeed } from '../../src/database/seeds/seedManifest.js';
import { inspectSeedHistory } from '../../src/database/testIntegrity.js';
import { seedChecksums } from '../../src/database/seeds/seedChecksum.js';
import { applySeedDescriptor } from '../../src/database/seeds/runSeeds.js';

const hash = text => createHash('sha256').update(text).digest('hex');

describe('checksum de seed independente do checkout', () => {
  it('nao reexecuta seed nem atualiza checksum historico equivalente', async () => {
    const lf = 'export async function apply() {}\n';
    const descriptor = { file: '001_seed.js', url: new URL('file:///not-imported.js'), ...seedChecksums(Buffer.from(lf)) };
    const row = Object.freeze({ nome_arquivo: descriptor.file, checksum_sha256: hash(lf.replace(/\n/g, '\r\n')) });
    const importer = vi.fn();
    const insert = vi.fn(() => { throw new Error('Unexpected write'); });
    const update = vi.fn(() => { throw new Error('Unexpected checksum update'); });
    const trx = Object.assign(() => ({ where: () => ({ first: async () => row }), insert, update }), { raw: vi.fn() });
    const db = { transaction: async (callback) => callback(trx) };
    await expect(applySeedDescriptor(db, descriptor, { importer })).resolves.toEqual({ file: descriptor.file, status: 'IGNORADO' });
    expect(importer).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('runner e verificador aceitam historico CRLF sem alterar o registro', () => {
    const lf = 'export async function apply() {\n  return 1;\n}\n';
    const descriptor = { file: '001_seed.js', ...seedChecksums(Buffer.from(lf)) };
    const row = Object.freeze({ nome_arquivo: descriptor.file, checksum_sha256: hash(lf.replace(/\n/g, '\r\n')) });
    expect(classifySeed(descriptor, [row])).toBe('APLICADO');
    expect(inspectSeedHistory([row], [descriptor], { expectedTotal: 1 }).complete).toBe(true);
    const changed = { ...descriptor, ...seedChecksums(Buffer.from(lf.replace('return 1', 'return 2'))) };
    expect(classifySeed(changed, [row])).toBe('ALTERADO');
    expect(() => inspectSeedHistory([row], [changed], { expectedTotal: 1 }))
      .toThrow(expect.objectContaining({ code: 'SEED_CHECKSUM_MISMATCH' }));
    expect(row.checksum_sha256).toBe(hash(lf.replace(/\n/g, '\r\n')));
  });

  it('reconhece somente equivalencia LF/CRLF e grava checksum canonico', async () => {
    const { seedChecksums, matchesSeedChecksum } = await import('../../src/database/seeds/seedChecksum.js');
    const lf = 'export async function apply() {\n  return 1;\n}\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    const descriptor = seedChecksums(Buffer.from(crlf));
    expect(descriptor.checksum).toBe(hash(lf));
    expect(matchesSeedChecksum(descriptor, hash(lf))).toBe(true);
    expect(matchesSeedChecksum(descriptor, hash(crlf))).toBe(true);
    expect(matchesSeedChecksum(descriptor, hash(lf.replace('return 1', 'return 2')))).toBe(false);
    expect(seedChecksums(Buffer.from(lf)).checksum).toBe(descriptor.checksum);
  });
});
