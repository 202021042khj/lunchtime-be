import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthCoreModule } from './common/auth/auth-core.module.js';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { CacheModule } from './integrations/cache/cache.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    CacheModule,
    AuthCoreModule,
    // 기능 모듈은 2단계-1부터 modules/ 아래에 추가한다 (docs/CONVENTIONS.md)
  ],
  controllers: [HealthController],
})
export class AppModule {}
