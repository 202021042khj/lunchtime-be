import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AppException } from '../src/common/errors/app.exception.js';
import { AppleAuthClient } from '../src/integrations/apple/apple-auth.client.js';
import { GoogleAuthClient } from '../src/integrations/google/google-auth.client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// 구글 · 애플 대신: 코드 "code-<id>" → ID 토큰 "idt-<id>", 그 밖의 토큰은 거절
const idOf = (idToken: string) => {
  if (!idToken.startsWith('idt-'))
    throw new AppException('INVALID_CREDENTIALS');
  return idToken.slice(4);
};

class FakeGoogle {
  configured = true;
  exchangeCode(code: string) {
    return Promise.resolve(`idt-${code.slice(5)}`);
  }
  verifyIdToken(idToken: string) {
    const id = idOf(idToken);
    return Promise.resolve({ id, name: `구글${id}`, email: `${id}@gmail.com` });
  }
}

class FakeApple {
  configured = true;
  revoked: string[] = [];
  exchangeCode(code: string) {
    const id = code.slice(5);
    return Promise.resolve({ idToken: `idt-${id}`, refreshToken: `rt-${id}` });
  }
  verifyIdToken(idToken: string) {
    return Promise.resolve({ id: idOf(idToken), email: null });
  }
  revoke(refreshToken: string) {
    this.revoked.push(refreshToken);
    return Promise.resolve();
  }
}

describe('구글 · 애플 로그인 (DB e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const apple = new FakeApple();
  const REDIRECT = 'http://localhost:3000/login/google/callback';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GoogleAuthClient)
      .useValue(new FakeGoogle())
      .overrideProvider(AppleAuthClient)
      .useValue(apple)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (body: object) =>
    request(app.getHttpServer()).post('/v1/auth/login').send(body);

  it('구글: 인가 코드로 가입(이름 · 이메일) → ID 토큰으로도 같은 계정', async () => {
    const byCode = await login({
      provider: 'google',
      code: 'code-g1',
      redirectUri: REDIRECT,
    }).expect(200);
    expect(byCode.body).toMatchObject({
      isNewUser: true,
      user: { name: '구글g1', provider: 'google' },
    });
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: byCode.body.user.id },
    });
    expect(row.email).toBe('g1@gmail.com');

    const byToken = await login({
      provider: 'google',
      providerToken: 'idt-g1',
    }).expect(200);
    expect(byToken.body.isNewUser).toBe(false);
    expect(byToken.body.user.id).toBe(byCode.body.user.id);
  });

  it('구글: 거절된 토큰 → 401', async () => {
    const res = await login({
      provider: 'google',
      providerToken: 'forged',
    }).expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('애플: 코드로 가입하면 앱이 보낸 이름 사용 + 애플 refresh token 저장', async () => {
    const res = await login({
      provider: 'apple',
      code: 'code-a1',
      redirectUri: 'https://lunchtime.example/login/apple/callback',
      name: '애플지민',
    }).expect(200);
    expect(res.body.user).toMatchObject({
      name: '애플지민',
      provider: 'apple',
    });
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: res.body.user.id },
    });
    expect(row.socialRefreshToken).toBe('rt-a1');
  });

  it('애플: 다시 로그인할 때 이름은 바뀌지 않는다 (가입할 때만 사용)', async () => {
    const res = await login({
      provider: 'apple',
      providerToken: 'idt-a1',
      name: '다른이름',
    }).expect(200);
    expect(res.body.isNewUser).toBe(false);
    expect(res.body.user.name).toBe('애플지민');
  });

  it('애플: 탈퇴하면 저장한 토큰을 폐기하고 DB에서도 지운다', async () => {
    const res = await login({
      provider: 'apple',
      code: 'code-a2',
      redirectUri: 'https://lunchtime.example/login/apple/callback',
    }).expect(200);
    expect(res.body.user.name).toMatch(/^점심친구\d{4}$/);
    await request(app.getHttpServer())
      .delete('/v1/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(204);
    expect(apple.revoked).toContain('rt-a2');
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: res.body.user.id },
    });
    expect(row.socialRefreshToken).toBeNull();
  });

  it('애플: ID 토큰만으로 가입하면 폐기할 토큰이 없다 (탈퇴는 그대로 진행)', async () => {
    const res = await login({
      provider: 'apple',
      providerToken: 'idt-a3',
    }).expect(200);
    const before = apple.revoked.length;
    await request(app.getHttpServer())
      .delete('/v1/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(204);
    expect(apple.revoked).toHaveLength(before);
  });
});
