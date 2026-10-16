import { Global, Module } from '@nestjs/common';
import { KakaoAuthClient } from './kakao-auth.client.js';
import { KakaoLocalClient } from './kakao-local.client.js';

// 카카오 로그인 · 카카오 로컬(위치 검색, 식당 검색은 2단계-3)
@Global()
@Module({
  providers: [KakaoAuthClient, KakaoLocalClient],
  exports: [KakaoAuthClient, KakaoLocalClient],
})
export class KakaoModule {}
