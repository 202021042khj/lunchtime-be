import { hotp, totp, verifyTotp } from './totp.js';

// RFC 6238 부록 B 테스트 벡터 (SHA-1, 키 "12345678901234567890", 8자리)
const RFC_KEY = Buffer.from('12345678901234567890');
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];
// "12345678901234567890"의 base32
const RFC_KEY_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP', () => {
  it.each(RFC_VECTORS)('RFC 6238 벡터: %i초 → %s', (sec, expected) => {
    expect(hotp(RFC_KEY, Math.floor(sec / 30), 8)).toBe(expected);
  });

  it('base32 비밀값으로 6자리를 만든다 (RFC 값의 끝 6자리)', () => {
    expect(totp(RFC_KEY_BASE32, 59_000)).toBe('287082');
  });

  it('앞뒤 30초까지 받고, 그 밖은 거부한다', () => {
    const now = 1_111_111_111_000;
    const code = totp(RFC_KEY_BASE32, now);
    expect(verifyTotp(RFC_KEY_BASE32, code, now)).toBe(true);
    expect(verifyTotp(RFC_KEY_BASE32, code, now + 30_000)).toBe(true);
    expect(verifyTotp(RFC_KEY_BASE32, code, now - 30_000)).toBe(true);
    expect(verifyTotp(RFC_KEY_BASE32, code, now + 90_000)).toBe(false);
  });

  it('6자리 숫자가 아니면 거부한다', () => {
    expect(verifyTotp(RFC_KEY_BASE32, '12345', 0)).toBe(false);
    expect(verifyTotp(RFC_KEY_BASE32, 'abcdef', 0)).toBe(false);
  });
});
