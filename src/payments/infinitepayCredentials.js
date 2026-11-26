import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from '../utils/AppError.js';

export function encryptionKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, 'base64').length !== 32 || Buffer.from(value, 'base64').toString('base64') !== value) throw new AppError('Criptografia InfinitePay nao configurada.', 503, 'INFINITEPAY_ENCRYPTION_REQUIRED');
  return Buffer.from(value, 'base64');
}

export function encryptApiKey(value, key, handle) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(`infinitepay:v1:${handle}`));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptApiKey(value, key, handle) {
  try {
    const [version, iv, tag, ciphertext, extra] = String(value).split(':');
    if (version !== 'v1' || !iv || !tag || !ciphertext || extra) throw new Error('envelope');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(key), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`infinitepay:v1:${handle}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new AppError('Credencial InfinitePay indisponivel.', 503, 'INFINITEPAY_CREDENTIAL_UNAVAILABLE');
  }
}
