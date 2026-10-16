import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';
import { AppException } from '../errors/app.exception.js';
import type { AccessTokenPayload, TokenAudience } from './auth.types.js';

const ISSUER = 'lunchtime';
// API.md: 사용자 accessToken 1시간, 어드민은 짧게 30분
const ACCESS_TTL_SEC: Record<TokenAudience, number> = {
  user: 60 * 60,
  admin: 30 * 60,
};

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private secret(aud: TokenAudience) {
    return aud === 'admin'
      ? this.config.get('ADMIN_JWT_SECRET', { infer: true })
      : this.config.get('JWT_SECRET', { infer: true });
  }

  signAccess(aud: TokenAudience, subjectId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: subjectId },
      {
        secret: this.secret(aud),
        audience: aud,
        issuer: ISSUER,
        expiresIn: ACCESS_TTL_SEC[aud],
      },
    );
  }

  // 서명 · 만료 · aud가 하나라도 틀리면 401 UNAUTHORIZED
  async verifyAccess(
    aud: TokenAudience,
    token: string,
  ): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.secret(aud),
        audience: aud,
        issuer: ISSUER,
      });
    } catch {
      throw new AppException('UNAUTHORIZED');
    }
  }
}
