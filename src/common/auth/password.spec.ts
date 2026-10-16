import {
  checkName,
  checkPassword,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from './password.js';

describe('password', () => {
  it('8~64자, 영문과 숫자 모두', () => {
    expect(checkPassword('lunch1234')).toBeNull();
    expect(checkPassword('short1')).toMatch(/8~64자/);
    expect(checkPassword('a1'.repeat(33))).toMatch(/8~64자/);
    expect(checkPassword('onlyletters')).toMatch(/영문과 숫자/);
    expect(checkPassword('12345678')).toMatch(/영문과 숫자/);
  });

  it('이름 2~12자 (앞뒤 공백 제외)', () => {
    expect(checkName('지민')).toBeNull();
    expect(checkName(' 지 ')).toMatch(/2~12자/);
    expect(checkName('가'.repeat(13))).toMatch(/2~12자/);
  });

  it('이메일은 공백을 빼고 소문자로', () => {
    expect(normalizeEmail('  Name@Example.COM ')).toBe('name@example.com');
  });

  it('해시 · 검증', async () => {
    const hash = await hashPassword('lunch1234');
    expect(await verifyPassword(hash, 'lunch1234')).toBe(true);
    expect(await verifyPassword(hash, 'lunch12345')).toBe(false);
    expect(await verifyPassword(null, 'lunch1234')).toBe(false);
  });
});
