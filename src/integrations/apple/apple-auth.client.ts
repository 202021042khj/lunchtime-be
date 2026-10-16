import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  errors as joseErrors,
  importPKCS8,
  jwtVerify,
  SignJWT,
  type JWTVerifyGetKey,
} from 'jose';
import { AppException } from '../../common/errors/app.exception.js';
import type { Env } from '../../config/env.js';

const APPLE = 'https://appleid.apple.com';
const TIMEOUT_MS = 5000;

export interface AppleProfile {
  // 애플 계정 고유 ID (sub)
  id: string;
  // 애플은 이메일만 ID 토큰에 넣는다 (가리기를 고르면 privaterelay 주소). 이름은 첫 로그인 때 앱이 따로 받는다
  email: string | null;
}

const relogin = () =>
  new AppException('INVALID_CREDENTIALS', 'Apple 로그인을 다시 해 주세요.');
const upstream = () =>
  new AppException(
    'UPSTREAM_UNAVAILABLE',
    'Apple 응답이 없어요. 잠시 후 다시 시도해 주세요.',
  );

// Sign in with Apple. 웹은 Service ID, 앱은 Bundle ID가 ID 토큰의 aud다
@Injectable()
export class AppleAuthClient {
  private readonly logger = new Logger(AppleAuthClient.name);
  // 애플 공개키. 테스트에서 바꿔 끼운다
  protected jwks: JWTVerifyGetKey = createRemoteJWKSet(
    new URL(`${APPLE}/auth/keys`),
  );
  // 테스트에서 시각을 고정하려고 바꿔 끼운다 (초)
  protected nowSec = () => Math.floor(Date.now() / 1000);

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get serviceId() {
    return this.config.get('APPLE_SERVICE_ID', { infer: true });
  }

  private get audiences() {
    return [
      this.serviceId,
      this.config.get('APPLE_BUNDLE_ID', { infer: true }),
    ].filter(Boolean);
  }

  // 코드 교환 · 토큰 폐기까지 하려면 키 정보가 모두 있어야 한다
  get configured() {
    return (
      Boolean(this.serviceId) &&
      Boolean(this.config.get('APPLE_TEAM_ID', { infer: true })) &&
      Boolean(this.config.get('APPLE_KEY_ID', { infer: true })) &&
      Boolean(this.config.get('APPLE_PRIVATE_KEY', { infer: true }))
    );
  }

  // 애플은 client_secret 대신 .p8 키로 서명한 JWT를 받는다 (최대 6개월, 여기서는 5분짜리를 매번 만든다)
  async clientSecret(): Promise<string> {
    const pem = this.config
      .get('APPLE_PRIVATE_KEY', { infer: true })
      .replace(/\\n/g, '\n');
    const key = await importPKCS8(pem, 'ES256');
    const now = this.nowSec();
    return new SignJWT({})
      .setProtectedHeader({
        alg: 'ES256',
        kid: this.config.get('APPLE_KEY_ID', { infer: true }),
      })
      .setIssuer(this.config.get('APPLE_TEAM_ID', { infer: true }))
      .setSubject(this.serviceId)
      .setAudience(APPLE)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(key);
  }

  private async post(
    path: string,
    form: Record<string, string>,
  ): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${APPLE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`애플 요청 실패 ${path}: ${(error as Error).message}`);
      throw upstream();
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.warn(`애플 ${res.status} ${path}: ${body.slice(0, 200)}`);
      throw res.status < 500 ? relogin() : upstream();
    }
    return res;
  }

  // 인가 코드 → ID 토큰 + refresh token (탈퇴할 때 폐기하려고 저장한다)
  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ idToken: string; refreshToken: string | null }> {
    const res = await this.post('/auth/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.serviceId,
      client_secret: await this.clientSecret(),
    });
    const json = (await res.json()) as {
      id_token?: string;
      refresh_token?: string;
    };
    if (!json.id_token) throw relogin();
    return { idToken: json.id_token, refreshToken: json.refresh_token ?? null };
  }

  async verifyIdToken(idToken: string): Promise<AppleProfile> {
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        issuer: APPLE,
        audience: this.audiences,
        currentDate: new Date(this.nowSec() * 1000),
      });
      // 애플은 email_verified를 문자열 "true"로 줄 때가 있다
      const verified =
        payload.email_verified === true || payload.email_verified === 'true';
      return {
        id: String(payload.sub),
        email:
          typeof payload.email === 'string' && verified ? payload.email : null,
      };
    } catch (error) {
      if (error instanceof joseErrors.JWKSTimeout || error instanceof TypeError)
        throw upstream();
      throw relogin();
    }
  }

  // 탈퇴: 앱스토어 규칙(5.1.1(v))에 따라 애플 토큰을 폐기한다
  async revoke(refreshToken: string): Promise<void> {
    await this.post('/auth/revoke', {
      client_id: this.serviceId,
      client_secret: await this.clientSecret(),
      token: refreshToken,
      token_type_hint: 'refresh_token',
    });
  }
}
