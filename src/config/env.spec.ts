import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(32),
  ADMIN_JWT_SECRET: 'b'.repeat(32),
};

describe('validateEnv', () => {
  it('기본값을 채운다', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGIN).toBe('http://localhost:3000');
    expect(env.KAKAO_REST_KEY).toBe('');
  });

  it('PORT 문자열을 숫자로 바꾼다', () => {
    expect(validateEnv({ ...base, PORT: '5000' }).PORT).toBe(5000);
  });

  it('필수 값이 없거나 짧으면 항목 이름을 알려 준다', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: undefined })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('사용자 · 어드민 비밀값이 같으면 거부한다', () => {
    expect(() =>
      validateEnv({ ...base, ADMIN_JWT_SECRET: base.JWT_SECRET }),
    ).toThrow(/서로 달라야/);
  });
});
