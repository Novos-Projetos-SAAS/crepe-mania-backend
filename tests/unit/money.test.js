import { describe, expect, it } from 'vitest';
import { addCents, centsToDecimal, decimalToCents, multiplyCents } from '../../src/utils/money.js';

describe('dinheiro em centavos', () => {
  it('converte sem usar ponto flutuante', () => {
    expect(decimalToCents('28.50')).toBe(2850);
    expect(decimalToCents('0.01')).toBe(1);
    expect(centsToDecimal(2850)).toBe('28.50');
    expect(addCents(2000, 200, 600)).toBe(2800);
    expect(multiplyCents(2800, 2)).toBe(5600);
  });
  it('rejeita precisao e valores invalidos', () => {
    expect(() => decimalToCents('1.001')).toThrow();
    expect(() => decimalToCents('-1.00')).toThrow();
    expect(() => addCents(999999999999, 1)).toThrow(/limite/i);
    expect(() => multiplyCents(999999999999, 2)).toThrow(/limite/i);
  });
});
