import { createHmac, timingSafeEqual } from 'node:crypto';

// RFC 6238 TOTP (SHA-1, 30초, 6자리). 인증 앱(Google Authenticator 등)과 같은 방식
const STEP_SEC = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('base32 형식이 아닙니다.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// RFC 4226 HOTP
export function hotp(key: Buffer, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

export function totp(secretBase32: string, nowMs = Date.now()): string {
  return hotp(base32Decode(secretBase32), Math.floor(nowMs / 1000 / STEP_SEC));
}

// 시계 차이를 감안해 앞뒤 30초(1칸)까지 받는다
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs = Date.now(),
): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const key = base32Decode(secretBase32);
  const counter = Math.floor(nowMs / 1000 / STEP_SEC);
  for (const drift of [-1, 0, 1]) {
    const expected = Buffer.from(hotp(key, counter + drift));
    if (timingSafeEqual(expected, Buffer.from(code))) return true;
  }
  return false;
}
