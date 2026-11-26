import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const trackingCode = () => randomBytes(16).toString('hex');
export const stableHash = (value) => sha256(stableStringify(value));

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function signValue(value, secret) {
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
}

export function verifySignedValue(signed, secret) {
  const index = signed.lastIndexOf('.');
  if (index < 1) return false;
  const value = signed.slice(0, index);
  const expected = signValue(value, secret);
  return safeEqual(signed, expected) ? value : false;
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function decodeAes256Key(base64Key) {
  if (typeof base64Key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(base64Key)) throw new Error('Chave de criptografia Push invalida.');
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32 || key.toString('base64') !== base64Key) throw new Error('Chave de criptografia Push invalida.');
  return key;
}

export function encryptPushSecret(value, base64Key) {
  const key = decodeAes256Key(base64Key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptPushSecret(value, base64Key) {
  const key = decodeAes256Key(base64Key);
  const [version, iv, tag, encrypted] = String(value).split(':');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Segredo criptografado invalido.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}
