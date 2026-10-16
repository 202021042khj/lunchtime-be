import { Global, Module } from '@nestjs/common';
import { AppleAuthClient } from './apple/apple-auth.client.js';
import { GoogleAuthClient } from './google/google-auth.client.js';

// 구글 · 애플 로그인 클라이언트 (카카오는 integrations/kakao)
@Global()
@Module({
  providers: [GoogleAuthClient, AppleAuthClient],
  exports: [GoogleAuthClient, AppleAuthClient],
})
export class SocialAuthModule {}
