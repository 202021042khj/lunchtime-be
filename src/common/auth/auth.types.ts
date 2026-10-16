// 사용자 토큰과 어드민 토큰은 비밀값과 aud가 다르다. 한쪽 토큰으로 다른 쪽 API를 부를 수 없다
export type TokenAudience = 'user' | 'admin';

export interface AccessTokenPayload {
  sub: string;
  aud: TokenAudience;
}

export interface AuthUser {
  id: string;
}

export interface AuthAdmin {
  id: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    authUser?: AuthUser;
    authAdmin?: AuthAdmin;
  }
}
