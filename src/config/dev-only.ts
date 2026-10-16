import type { ConfigService } from '@nestjs/config';
import type { Env } from './env.js';

// 개발 편의 기능(OTP 고정값, 가짜 소셜 로그인)은 NODE_ENV=development일 때만 켠다
export const isDevelopment = (config: ConfigService<Env, true>) =>
  config.get('NODE_ENV', { infer: true }) === 'development';
