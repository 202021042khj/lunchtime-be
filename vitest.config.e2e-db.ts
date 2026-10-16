import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/db-env.js';

// 실제 Postgres(docker-compose)를 쓰는 e2e

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.db-e2e-spec.ts'],
    globalSetup: ['./test/db-global-setup.ts'],
    // 한 DB를 같이 쓰므로 파일을 차례로 돌린다
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      // 개발 전용 기능(OTP 고정값, dev: 소셜 토큰)도 시험하려고 development로 둔다
      NODE_ENV: 'development',
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-user-secret-0123456789abcdef0123',
      ADMIN_JWT_SECRET: 'test-admin-secret-0123456789abcdef012',
      ADMIN_OTP_DEV_CODE: '123456',
      SOCIAL_DEV_LOGIN: 'true',
      // 카카오 API는 테스트에서 가짜 클라이언트로 바꾼다
      KAKAO_APP_ID: '999',
    },
  },
});
