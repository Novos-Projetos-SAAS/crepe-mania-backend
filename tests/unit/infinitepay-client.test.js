import { describe, expect, it, vi } from 'vitest';

describe('segredo e transporte InfinitePay', () => {
  it('cifra API key com contexto e detecta adulteracao/conta errada', async () => {
    const { encryptApiKey, decryptApiKey } = await import('../../src/payments/infinitepayCredentials.js');
    const key = Buffer.alloc(32, 7).toString('base64');
    const encrypted = encryptApiKey('inchk_fixture', key, 'crepe-mania');
    expect(encrypted).not.toContain('inchk_fixture');
    expect(decryptApiKey(encrypted, key, 'crepe-mania')).toBe('inchk_fixture');
    expect(() => decryptApiKey(encrypted, key, 'other')).toThrow();
    expect(() => decryptApiKey(encrypted, Buffer.alloc(32, 8).toString('base64'), 'crepe-mania')).toThrow();
    expect(() => encryptApiKey('inchk_fixture', 'invalid', 'crepe-mania')).toThrow();
  });
  it('usa somente origem oficial, nao segue redirects e nao repete timeout', async () => {
    const { InfinitepayClient } = await import('../../src/payments/infinitepayClient.js');
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://buy.infinitepay.io/crepe-mania/a' }) });
    const client = new InfinitepayClient(fetch);
    await expect(client.createLink('inchk_fixture', { order_nsu: 'x' })).resolves.toEqual({ url: 'https://buy.infinitepay.io/crepe-mania/a' });
    expect(fetch).toHaveBeenCalledWith('https://api.checkout.infinitepay.io/links', expect.objectContaining({ redirect: 'error', method: 'POST', headers: expect.objectContaining({ 'X-Api-Key': 'inchk_fixture' }) }));
    fetch.mockRejectedValueOnce(new Error('fixture secret must not escape'));
    await expect(client.createLink('inchk_fixture', {})).rejects.toMatchObject({ code: 'INFINITEPAY_UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('recusa URL adulterada mesmo com dominio parecido', async () => {
    const { providerUrl } = await import('../../src/payments/infinitepayClient.js');
    expect(providerUrl('https://buy.infinitepay.io/crepe-mania/a')).toBe('https://buy.infinitepay.io/crepe-mania/a');
    for (const url of ['http://buy.infinitepay.io/x', 'https://buy.infinitepay.io.evil.test/x', 'https://a:b@buy.infinitepay.io/x', 'https://buy.infinitepay.io:444/x', 'javascript:alert(1)']) expect(providerUrl(url)).toBeNull();
  });
});
