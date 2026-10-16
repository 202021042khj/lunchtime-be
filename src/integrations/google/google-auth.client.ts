import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import { AppException } from '../../common/errors/app.exception.js';
import type { Env } from '../../config/env.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const TIMEOUT_MS = 5000;

export interface GoogleProfile {
  // 구글 계정 고유 ID (sub)
  id: string;
  name: string | null;
  // 구글이 확인한 이메일만
  email: string | null;
}

const relogin = () =>
  new AppException('INVALID_CREDENTIALS', 'Google 로그인을 다시 해 주세요.');
const upstream = () =>
  new AppException(
    'UPSTREAM_UNAVAILABLE',
    'Google 응답이 없어요. 잠시 후 다시 시도해 주세요.',
  );

// 구글 로그인 (OpenID Connect). 웹은 인가 코드 → ID 토큰, 앱은 ID 토큰을 바로 받는다
@Injectable()
export class GoogleAuthClient {
  private readonly logger = new Logger(GoogleAuthClient.name);
  private readonly clientIds: string[];
  // 구글 공개키 (jose가 캐시하고 키가 바뀌면 다시 받는다). 테스트에서 바꿔 끼운다
  protected jwks: JWTVerifyGetKey = createRemoteJWKSet(new URL(JWKS_URL));

  constructor(private readonly config: ConfigService<Env, true>) {
    this.clientIds = config
      .get('GOOGLE_CLIENT_IDS', { infer: true })
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }

  get configured() {
    return this.clientIds.length > 0;
  }

  // 웹: 인가 코드 → ID 토큰 (첫 번째 client ID = 웹 클라이언트)
  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: this.clientIds[0],
          client_secret: this.config.get('GOOGLE_CLIENT_SECRET', {
            infer: true,
          }),
          redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`구글 토큰 요청 실패: ${(error as Error).message}`);
      throw upstream();
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.warn(
        `구글 ${res.status} ${TOKEN_URL}: ${body.slice(0, 200)}`,
      );
      throw res.status < 500 ? relogin() : upstream();
    }
    const json = (await res.json()) as { id_token?: string };
    if (!json.id_token) throw relogin();
    return json.id_token;
  }

  // 서명(구글 공개키) · 발급자 · 대상(우리 client ID) · 만료를 확인한다
  async verifyIdToken(idToken: string): Promise<GoogleProfile> {
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        issuer: ISSUERS,
        audience: this.clientIds,
      });
      const email =
        typeof payload.email === 'string' && payload.email_verified === true
          ? payload.email
          : null;
      return {
        id: String(payload.sub),
        name: typeof payload.name === 'string' ? payload.name : null,
        email,
      };
    } catch (error) {
      // 공개키를 못 받아 온 경우는 구글 장애, 나머지(서명 · 만료 · aud)는 다시 로그인
      if (error instanceof joseErrors.JWKSTimeout || error instanceof TypeError)
        throw upstream();
      throw relogin();
    }
  }
}
