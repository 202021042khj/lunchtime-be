import { z } from 'zod';

// 서버가 켜질 때 한 번 검사한다. 틀리면 무엇이 틀렸는지 보여 주고 시작하지 않는다
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  REDIS_URL: z.string().startsWith('redis://'),
  JWT_SECRET: z.string().min(32),
  ADMIN_JWT_SECRET: z.string().min(32),
  KAKAO_REST_KEY: z.string().default(''),
  KMA_SERVICE_KEY: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(
      `환경 변수가 올바르지 않습니다 (.env 확인):\n${lines.join('\n')}`,
    );
  }
  if (result.data.JWT_SECRET === result.data.ADMIN_JWT_SECRET) {
    throw new Error('JWT_SECRET과 ADMIN_JWT_SECRET은 서로 달라야 합니다.');
  }
  return result.data;
}
