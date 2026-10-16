import { createHash, randomBytes, randomInt } from 'node:crypto';

// refreshToken · verificationToken: 랜덤 값은 클라이언트에만 주고 DB에는 sha256만 저장한다
export const newOpaqueToken = () => randomBytes(32).toString('base64url');

export const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export const newNumericCode = (digits = 6) =>
  randomInt(0, 10 ** digits)
    .toString()
    .padStart(digits, '0');
