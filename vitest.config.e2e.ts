import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // .env 없이도 돌도록 테스트용 값을 넣는다 (DB · Redis는 테스트에서 가짜로 바꾼다)
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-user-secret-0123456789abcdef0123',
      ADMIN_JWT_SECRET: 'test-admin-secret-0123456789abcdef012',
    },
  },
});
