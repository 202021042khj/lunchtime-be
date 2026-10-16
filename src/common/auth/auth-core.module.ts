import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard.js';
import { TokenService } from './token.service.js';

// 토큰 발급 · 검증과 전역 가드. 로그인 API 자체는 modules/auth · modules/admin/auth (2단계-1)
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [TokenService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [TokenService],
})
export class AuthCoreModule {}
