import { describe, expect, it } from 'vitest';
import { sanitizeAuditPayload } from '../../src/utils/sanitize.js';

describe('segredos financeiros', () => {
  it('redige API keys, ciphertext e chave mestra em profundidade', () => {
    const safe = sanitizeAuditPayload({ api_key: 'fixture-1', nested: { apiKey: 'fixture-2', 'X-Api-Key': 'fixture-3', api_key_ciphertext: 'fixture-4', INFINITEPAY_ENCRYPTION_KEY: 'fixture-5' }, estado: 'PENDENTE' });
    expect(JSON.stringify(safe)).not.toContain('fixture-');
    expect(safe.estado).toBe('PENDENTE');
  });
});
