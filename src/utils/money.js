import { AppError } from './AppError.js';

const MONEY_PATTERN = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/;
export const MAX_MONEY_CENTS = 999999999999;

function assertCentsWithinDatabase(value, field = 'valor') {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY_CENTS) {
    throw new AppError(`${field} fora do limite monetario permitido.`, 422, 'MONEY_OVERFLOW');
  }
  return value;
}

export function decimalToCents(value, field = 'valor') {
  if (value === null || value === undefined || value === '') return null;
  const normalized = typeof value === 'number' ? value.toFixed(2) : String(value).trim();
  if (!MONEY_PATTERN.test(normalized)) {
    throw new AppError(`${field} deve ser um decimal nao negativo com ate duas casas.`, 422, 'INVALID_MONEY');
  }
  const [whole, decimal = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  return assertCentsWithinDatabase(cents, field);
}

export function centsToDecimal(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_MONEY_CENTS) throw new AppError('Valor monetario interno invalido.', 500, 'INVALID_INTERNAL_MONEY');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function addCents(...values) {
  return values.reduce((total, value) => {
    if (!Number.isSafeInteger(value)) throw new AppError('Calculo monetario excedeu o limite.', 422, 'MONEY_OVERFLOW');
    const next = total + value;
    return assertCentsWithinDatabase(next, 'calculo monetario');
  }, 0);
}

export function multiplyCents(value, quantity) {
  const result = value * quantity;
  return assertCentsWithinDatabase(result, 'calculo monetario');
}
