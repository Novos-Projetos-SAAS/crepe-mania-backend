import { AppError } from '../utils/AppError.js';

export function providerUrl(value, kind = 'checkout') {
  try {
    const url = new URL(value);
    const hosts = kind === 'checkout' ? ['buy.infinitepay.io', 'checkout.infinitepay.io'] : ['recibo.infinitepay.io', 'comprovante.infinitepay.io'];
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

export class InfinitepayClient {
  constructor(fetch = globalThis.fetch) { this.fetch = fetch; }

  async request(path, apiKey, payload) {
    try {
      const response = await this.fetch(`https://api.checkout.infinitepay.io/${path}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey }, body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('provider');
      return await response.json();
    } catch {
      throw new AppError('InfinitePay temporariamente indisponivel.', 503, 'INFINITEPAY_UNAVAILABLE');
    }
  }

  async createLink(apiKey, payload) {
    const result = await this.request('links', apiKey, payload);
    const url = providerUrl(result?.url);
    if (!url) throw new AppError('URL de checkout invalida.', 502, 'INFINITEPAY_INVALID_RESPONSE');
    return { url };
  }

  checkPayment(apiKey, payload) { return this.request('payment_check', apiKey, payload); }
}
