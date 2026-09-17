import { describe, expect, it } from 'vitest';
import { isValidName, isValidRatio } from '@/lib/validation';

describe('isValidRatio', () => {
  it('smoke: 0~1 사이 값은 유효하다', () => {
    expect(isValidRatio(0.5)).toBe(true);
  });

  it('smoke: 1을 초과하면 무효하다', () => {
    expect(isValidRatio(1.1)).toBe(false);
  });
});

describe('isValidName', () => {
  it('smoke: 공백만 있는 이름은 무효하다', () => {
    expect(isValidName('   ')).toBe(false);
  });
});
