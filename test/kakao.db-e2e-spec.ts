import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AppException } from '../src/common/errors/app.exception.js';
import {
  KakaoAuthClient,
  type KakaoProfile,
} from '../src/integrations/kakao/kakao-auth.client.js';

// 카카오 API 대신: 코드 "code-<회원번호>" → 토큰 "at-<회원번호>", 토큰 "other-app" → 다른 앱 ID
class FakeKakao {
  down = false;
  unlinked: string[] = [];
  readonly nicknames = new Map<string, string>();

  private check() {
    if (this.down) throw new AppException('UPSTREAM_UNAVAILABLE');
  }

  exchangeCode(code: string, redirectUri: string) {
    this.check();
    if (!code.startsWith('code-') || !redirectUri.startsWith('http')) {
      return Promise.reject(new AppException('INVALID_CREDENTIALS'));
    }
    return Promise.resolve(`at-${code.slice(5)}`);
  }

  tokenInfo(accessToken: string) {
    this.check();
    if (accessToken === 'other-app')
      return Promise.resolve({ id: 1, app_id: 123 });
    if (!accessToken.startsWith('at-'))
      return Promise.reject(new AppException('INVALID_CREDENTIALS'));
    return Promise.resolve({ id: Number(accessToken.slice(3)), app_id: 999 });
  }

  me(accessToken: string): Promise<KakaoProfile> {
    this.check();
    const id = accessToken.slice(3);
    return Promise.resolve({
      id,
      nickname: this.nicknames.get(id) ?? null,
      email: null,
    });
  }

  unlink(kakaoUserId: string) {
    this.unlinked.push(kakaoUserId);
    return Promise.resolve(true);
  }
}

describe('카카오 로그인 (DB e2e)', () => {
  let app: INestApplication<App>;
  const kakao = new FakeKakao();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KakaoAuthClient)
      .useValue(kakao)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (body: object) =>
    request(app.getHttpServer()).post('/v1/auth/login').send(body);
  const REDIRECT = 'http://localhost:3000/login/kakao/callback';

  it('웹: 인가 코드로 가입 → 닉네임 사용, 다시 로그인하면 같은 계정', async () => {
    kakao.nicknames.set('1001', '카카오지민');
    const first = await login({
      provider: 'kakao',
      code: 'code-1001',
      redirectUri: REDIRECT,
    }).expect(200);
    expect(first.body).toMatchObject({
      isNewUser: true,
      user: {
        name: '카카오지민',
        provider: 'kakao',
        onboardingCompleted: false,
      },
    });
    const again = await login({
      provider: 'kakao',
      code: 'code-1001',
      redirectUri: REDIRECT,
    }).expect(200);
    expect(again.body.isNewUser).toBe(false);
    expect(again.body.user.id).toBe(first.body.user.id);
  });

  it('앱: 카카오 액세스 토큰으로도 같은 계정', async () => {
    const byCode = await login({
      provider: 'kakao',
      code: 'code-1002',
      redirectUri: REDIRECT,
    }).expect(200);
    const byToken = await login({
      provider: 'kakao',
      providerToken: 'at-1002',
    }).expect(200);
    expect(byToken.body.user.id).toBe(byCode.body.user.id);
  });

  it('닉네임을 못 받으면 임시 이름', async () => {
    const res = await login({
      provider: 'kakao',
      providerToken: 'at-1003',
    }).expect(200);
    expect(res.body.user.name).toMatch(/^점심친구\d{4}$/);
  });

  it('다른 앱에서 발급된 토큰 → 401', async () => {
    const res = await login({
      provider: 'kakao',
      providerToken: 'other-app',
    }).expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('틀린 인가 코드 → 401', async () => {
    const res = await login({
      provider: 'kakao',
      code: 'bad',
      redirectUri: REDIRECT,
    }).expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('카카오 장애 → 502', async () => {
    kakao.down = true;
    const res = await login({
      provider: 'kakao',
      providerToken: 'at-1004',
    }).expect(502);
    expect(res.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    kakao.down = false;
  });

  it('code만 있고 redirectUri가 없거나, 아무것도 없으면 400', async () => {
    await login({ provider: 'kakao', code: 'code-1' }).expect(400);
    const res = await login({ provider: 'kakao' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('탈퇴하면 카카오 연결을 끊는다', async () => {
    const res = await login({
      provider: 'kakao',
      providerToken: 'at-1005',
    }).expect(200);
    await request(app.getHttpServer())
      .delete('/v1/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(204);
    expect(kakao.unlinked).toContain('1005');

    // 같은 카카오 계정으로 다시 가입하면 새 계정
    const again = await login({
      provider: 'kakao',
      providerToken: 'at-1005',
    }).expect(200);
    expect(again.body.isNewUser).toBe(true);
    expect(again.body.user.id).not.toBe(res.body.user.id);
  });

  it('구글 키 설정이 없으면 400 (카카오와 별개)', async () => {
    await login({ provider: 'google', providerToken: 'real' }).expect(400);
  });
});
