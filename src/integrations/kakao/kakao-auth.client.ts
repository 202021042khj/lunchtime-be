import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { AppException } from '../../common/errors/app.exception.js';

const KAUTH = 'https://kauth.kakao.com';
const KAPI = 'https://kapi.kakao.com';
const TIMEOUT_MS = 5000;

export interface KakaoTokenInfo {
  // 카카오 회원번호
  id: number;
  app_id: number;
}

export interface KakaoProfile {
  id: string;
  nickname: string | null;
  // 카카오가 확인한 이메일만 (동의하지 않았거나 미인증이면 null)
  email: string | null;
}

interface KakaoMeResponse {
  id: number;
  kakao_account?: {
    profile?: { nickname?: string };
    email?: string;
    is_email_valid?: boolean;
    is_email_verified?: boolean;
  };
}

// 카카오 로그인 REST API. 비즈니스 규칙(앱 ID 확인, 가입)은 SocialVerifierService가 맡는다
@Injectable()
export class KakaoAuthClient {
  private readonly logger = new Logger(KakaoAuthClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  // 카카오가 4xx를 주면 토큰 · 코드가 틀린 것 → 401, 그 밖의 실패는 카카오 장애 → 502
  private async call<T>(url: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`카카오 요청 실패 ${url}: ${(error as Error).message}`);
      throw new AppException(
        'UPSTREAM_UNAVAILABLE',
        '카카오 응답이 없어요. 잠시 후 다시 시도해 주세요.',
      );
    }
    if (res.ok) return (await res.json()) as T;
    const body = await res.text().catch(() => '');
    if (res.status >= 400 && res.status < 500) {
      this.logger.warn(`카카오 ${res.status} ${url}: ${body.slice(0, 200)}`);
      throw new AppException(
        'INVALID_CREDENTIALS',
        '카카오 로그인을 다시 해 주세요.',
      );
    }
    this.logger.warn(`카카오 ${res.status} ${url}: ${body.slice(0, 200)}`);
    throw new AppException(
      'UPSTREAM_UNAVAILABLE',
      '카카오 응답이 없어요. 잠시 후 다시 시도해 주세요.',
    );
  }

  // 웹: 인가 코드 → 액세스 토큰
  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.get('KAKAO_REST_KEY', { infer: true }),
      redirect_uri: redirectUri,
      code,
    });
    const secret = this.config.get('KAKAO_CLIENT_SECRET', { infer: true });
    if (secret) form.set('client_secret', secret);
    const res = await this.call<{ access_token: string }>(
      `${KAUTH}/oauth/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        },
        body: form,
      },
    );
    return res.access_token;
  }

  tokenInfo(accessToken: string): Promise<KakaoTokenInfo> {
    return this.call<KakaoTokenInfo>(`${KAPI}/v1/user/access_token_info`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  async me(accessToken: string): Promise<KakaoProfile> {
    const res = await this.call<KakaoMeResponse>(`${KAPI}/v2/user/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const account = res.kakao_account ?? {};
    const email =
      account.email && account.is_email_valid && account.is_email_verified
        ? account.email
        : null;
    return {
      id: String(res.id),
      nickname: account.profile?.nickname ?? null,
      email,
    };
  }

  // 탈퇴 시 연결 끊기. 어드민 키가 없으면 하지 않는다 (false)
  async unlink(kakaoUserId: string): Promise<boolean> {
    const adminKey = this.config.get('KAKAO_ADMIN_KEY', { infer: true });
    if (!adminKey) return false;
    await this.call(`${KAPI}/v1/user/unlink`, {
      method: 'POST',
      headers: {
        Authorization: `KakaoAK ${adminKey}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: new URLSearchParams({
        target_id_type: 'user_id',
        target_id: kakaoUserId,
      }),
    });
    return true;
  }
}
