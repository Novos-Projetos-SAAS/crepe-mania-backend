import argon2 from 'argon2';

// Parametros minimos OWASP para Argon2id. memoryCost em KiB: 19456 KiB = 19 MiB.
// Reavaliar custos com testes de carga no servidor real antes do deploy.
export const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

const INVALID_PASSWORD = Object.freeze({ valid: false, needsUpgrade: false });

/** Somente Argon2id e aceito; esta instalacao nao possui senhas legadas. */
export async function hashPassword(plaintext) {
  if (typeof plaintext !== 'string') throw new TypeError('Senha invalida.');
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

/** Atualiza parametros Argon2id no proximo login quando a politica for reforcada. */
export async function verifyPassword(plaintext, storedHash) {
  if (typeof plaintext !== 'string' || typeof storedHash !== 'string' || !storedHash.startsWith('$argon2id$')) {
    return INVALID_PASSWORD;
  }
  try {
    const valid = await argon2.verify(storedHash, plaintext);
    return { valid, needsUpgrade: valid && argon2.needsRehash(storedHash, ARGON2_OPTIONS) };
  } catch {
    return INVALID_PASSWORD;
  }
}
