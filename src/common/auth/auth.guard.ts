import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException } from '../errors/app.exception.js';
import { IS_ADMIN_ROUTE, IS_PUBLIC } from './decorators.js';
import { TokenService } from './token.service.js';

// 전역 가드. 표시가 없으면 로그인 필수(사용자 토큰), @AdminRoute면 어드민 토큰, @Public이면 통과
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ?? false;
    const isAdmin =
      this.reflector.getAllAndOverride<boolean>(IS_ADMIN_ROUTE, targets) ??
      false;
    const req = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(req);

    if (isPublic) {
      // 공개 API: 맞는 사용자 토큰이면 로그인 사용자로, 아니면(만료 포함) 비로그인으로 처리
      if (token && !isAdmin) {
        const payload = await this.tokens
          .verifyAccess('user', token)
          .catch(() => null);
        if (payload) req.authUser = { id: payload.sub };
      }
      return true;
    }

    if (!token) throw new AppException('UNAUTHORIZED');
    if (isAdmin) {
      const payload = await this.tokens.verifyAccess('admin', token);
      req.authAdmin = { id: payload.sub };
    } else {
      const payload = await this.tokens.verifyAccess('user', token);
      req.authUser = { id: payload.sub };
    }
    return true;
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme === 'Bearer' && value ? value : null;
}
