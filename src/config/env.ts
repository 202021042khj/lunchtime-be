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
  // 카카오 로그인: 액세스 토큰이 우리 앱 것인지 확인 (콘솔 > 앱 키 > 앱 ID)
  KAKAO_APP_ID: z.string().default(''),
  // 콘솔에서 Client Secret을 켰을 때만
  KAKAO_CLIENT_SECRET: z.string().default(''),
  // 탈퇴 시 카카오 연결 끊기(unlink)용. 비우면 끊지 않는다
  KAKAO_ADMIN_KEY: z.string().default(''),
  // 구글 로그인: ID 토큰 aud로 받을 client ID (웹 · 앱, 쉼표로 여러 개). 첫 번째가 웹(코드 교환)
  GOOGLE_CLIENT_IDS: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  // 애플 로그인: Service ID(웹, 코드 교환) · Bundle ID(앱). 둘 다 ID 토큰 aud로 받는다
  APPLE_SERVICE_ID: z.string().default(''),
  APPLE_BUNDLE_ID: z.string().default(''),
  APPLE_TEAM_ID: z.string().default(''),
  APPLE_KEY_ID: z.string().default(''),
  // .p8 키 내용 (줄바꿈은 \n으로 써도 된다)
  APPLE_PRIVATE_KEY: z.string().default(''),
  KMA_SERVICE_KEY: z.string().default(''),
  // 개발 전용: 어드민 OTP 대신 받을 고정값(예: 123456). development가 아니면 무시한다
  ADMIN_OTP_DEV_CODE: z.string().default(''),
  // 개발 전용: 소셜 로그인 "dev:<아이디>" 가짜 토큰 허용 (카카오 · 구글 · 애플 연동 전까지)
  SOCIAL_DEV_LOGIN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
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
