import argon2 from 'argon2';

// API.md: 8~64자, 영문과 숫자 모두. 문구는 프론트 lib/validation.ts와 같다
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;
export const NAME_MIN = 2;
export const NAME_MAX = 12;

export function checkPassword(password: string): string | null {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자로 만들어 주세요.`;
  }
  return /[A-Za-z]/.test(password) && /\d/.test(password)
    ? null
    : '영문과 숫자를 모두 넣어 주세요.';
}

export function checkName(name: string): string | null {
  const length = name.trim().length;
  return length >= NAME_MIN && length <= NAME_MAX
    ? null
    : `이름은 ${NAME_MIN}~${NAME_MAX}자로 입력해 주세요.`;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const hashPassword = (password: string) => argon2.hash(password);

export async function verifyPassword(
  hash: string | null,
  password: string,
): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
