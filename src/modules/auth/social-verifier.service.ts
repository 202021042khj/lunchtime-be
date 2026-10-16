import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/errors/app.exception.js';
import { isDevelopment } from '../../config/dev-only.js';
import type { Env } from '../../config/env.js';
import { AppleAuthClient } from '../../integrations/apple/apple-auth.client.js';
import { GoogleAuthClient } from '../../integrations/google/google-auth.client.js';
import { KakaoAuthClient } from '../../integrations/kakao/kakao-auth.client.js';

export type SocialProvider = 'kakao' | 'apple' | 'google';

// 앱(웹뷰)은 각 회사 SDK에서 받은 토큰을, 웹은 리다이렉트로 받은 인가 코드를 보낸다.
// 토큰: 카카오는 access token, 구글 · 애플은 id token
export type SocialCredential =
  { providerToken: string } | { code: string; redirectUri: string };

export interface SocialProfile {
  // 각 회사가 주는 사용자 고유 ID
  providerId: string;
  email: string | null;
  name: string | null;
  // 탈퇴할 때 폐기해야 하는 회사 쪽 refresh token (지금은 애플만, 코드 교환으로 받았을 때)
  refreshToken: string | null;
}

const LABEL: Record<SocialProvider, string> = {
  kakao: '카카오',
  apple: 'Apple',
  google: 'Google',
};

const notConfigured = (provider: SocialProvider) =>
  new AppException(
    'VALIDATION_FAILED',
    `${LABEL[provider]} 로그인 설정이 필요해요.`,
  );

@Injectable()
export class SocialVerifierService {
  private readonly devLogin: boolean;
  private readonly kakaoAppId: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly kakao: KakaoAuthClient,
    private readonly google: GoogleAuthClient,
    private readonly apple: AppleAuthClient,
  ) {
    this.devLogin =
      isDevelopment(config) && config.get('SOCIAL_DEV_LOGIN', { infer: true });
    this.kakaoAppId = config.get('KAKAO_APP_ID', { infer: true });
  }

  verify(
    provider: SocialProvider,
    credential: SocialCredential,
  ): Promise<SocialProfile> {
    // 개발 전용 가짜 토큰: "dev:<아이디>" 또는 "dev:<아이디>:<이름>"
    if (
      this.devLogin &&
      'providerToken' in credential &&
      credential.providerToken.startsWith('dev:')
    ) {
      const [, id, name] = credential.providerToken.split(':');
      if (!id) {
        throw new AppException(
          'VALIDATION_FAILED',
          'dev:<아이디> 형식으로 보내 주세요.',
        );
      }
      return Promise.resolve({
        providerId: `dev-${id}`,
        email: null,
        name: name || null,
        refreshToken: null,
      });
    }
    if (provider === 'kakao') return this.verifyKakao(credential);
    if (provider === 'google') return this.verifyGoogle(credential);
    return this.verifyApple(credential);
  }

  private async verifyKakao(
    credential: SocialCredential,
  ): Promise<SocialProfile> {
    if (!this.kakaoAppId) throw notConfigured('kakao');
    const accessToken =
      'code' in credential
        ? await this.kakao.exchangeCode(credential.code, credential.redirectUri)
        : credential.providerToken;
    // 다른 앱에서 발급된 토큰으로 우리 계정에 들어오는 것을 막는다
    const info = await this.kakao.tokenInfo(accessToken);
    if (String(info.app_id) !== this.kakaoAppId) {
      throw new AppException(
        'INVALID_CREDENTIALS',
        '카카오 로그인을 다시 해 주세요.',
      );
    }
    const profile = await this.kakao.me(accessToken);
    return {
      providerId: profile.id,
      email: profile.email,
      name: profile.nickname,
      refreshToken: null,
    };
  }

  // ID 토큰의 aud가 우리 client ID인지 확인하므로 다른 앱의 토큰은 거절된다
  private async verifyGoogle(
    credential: SocialCredential,
  ): Promise<SocialProfile> {
    if (!this.google.configured) throw notConfigured('google');
    const idToken =
      'code' in credential
        ? await this.google.exchangeCode(
            credential.code,
            credential.redirectUri,
          )
        : credential.providerToken;
    const profile = await this.google.verifyIdToken(idToken);
    return {
      providerId: profile.id,
      email: profile.email,
      name: profile.name,
      refreshToken: null,
    };
  }

  private async verifyApple(
    credential: SocialCredential,
  ): Promise<SocialProfile> {
    if (!this.apple.configured) throw notConfigured('apple');
    let idToken: string;
    let refreshToken: string | null = null;
    if ('code' in credential) {
      ({ idToken, refreshToken } = await this.apple.exchangeCode(
        credential.code,
        credential.redirectUri,
      ));
    } else {
      // 앱이 ID 토큰만 보내면 탈퇴 때 폐기할 토큰이 없다. 앱도 인가 코드를 보내는 쪽을 권장 (API.md)
      idToken = credential.providerToken;
    }
    const profile = await this.apple.verifyIdToken(idToken);
    return {
      providerId: profile.id,
      email: profile.email,
      name: null,
      refreshToken,
    };
  }

  // 탈퇴 시 소셜 연결 끊기: 카카오 unlink(어드민 키가 있을 때), 애플 토큰 폐기(저장한 토큰이 있을 때).
  // 실패는 호출하는 쪽이 로그로 남긴다
  async unlink(
    provider: string,
    providerId: string,
    socialRefreshToken: string | null,
  ): Promise<boolean> {
    if (providerId.startsWith('dev-')) return false;
    if (provider === 'kakao') return this.kakao.unlink(providerId);
    if (provider === 'apple' && socialRefreshToken && this.apple.configured) {
      await this.apple.revoke(socialRefreshToken);
      return true;
    }
    return false;
  }
}
