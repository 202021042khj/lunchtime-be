import { Global, Module } from '@nestjs/common';
import { KakaoAuthClient } from './kakao-auth.client.js';

// 카카오 로그인. 카카오 로컬(식당 검색)은 2단계-3에서 여기에 더한다
@Global()
@Module({
  providers: [KakaoAuthClient],
  exports: [KakaoAuthClient],
})
export class KakaoModule {}
