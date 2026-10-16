import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthAdmin, AuthUser } from './auth.types.js';

export const IS_PUBLIC = 'auth:public';
export const IS_ADMIN_ROUTE = 'auth:admin';

// 로그인 없이 부를 수 있는 API (API.md "공개"). 사용자 토큰이 있으면 CurrentUser를 채운다
export const Public = () => SetMetadata(IS_PUBLIC, true);

// /admin/* 컨트롤러에 붙인다. 어드민 토큰만 받는다
export const AdminRoute = () => SetMetadata(IS_ADMIN_ROUTE, true);

// 로그인 필수 API에서는 항상 있고, @Public API에서는 비로그인이면 undefined
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<Request>().authUser,
);

export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthAdmin | undefined =>
    ctx.switchToHttp().getRequest<Request>().authAdmin,
);
