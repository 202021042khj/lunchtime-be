import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { hashPassword } from '../src/common/auth/password.js';
import { totp } from '../src/common/auth/totp.js';
import { Clock } from '../src/common/clock.js';
import { MailService } from '../src/integrations/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// 시간을 옮겨 가며 만료 · 재전송 · 잠금 규칙을 확인한다
class FakeClock extends Clock {
  t = Date.parse('2026-10-16T03:00:00Z');
  now() {
    return new Date(this.t);
  }
  advance(ms: number) {
    this.t += ms;
  }
}

// 메일 대신 마지막 인증번호를 기억한다
class CaptureMail extends MailService {
  readonly codes = new Map<string, string>();
  sendVerificationCode(email: string, code: string) {
    this.codes.set(email, code);
    return Promise.resolve();
  }
}

const MIN = 60_000;
const ADMIN_SECRET = 'JBSWY3DPEHPK3PXP';

describe('인증 (DB e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clock = new FakeClock();
  const mail = new CaptureMail();
  let seq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.adminUser.create({
      data: {
        loginId: 'admin',
        passwordHash: await hashPassword('admin1234'),
        otpSecret: ADMIN_SECRET,
        name: '운영자',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const post = (path: string, body: object = {}, token?: string) => {
    const req = http().post(`/v1${path}`).send(body);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const get = (path: string, token?: string) => {
    const req = http().get(`/v1${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const newEmail = () => `user${++seq}@example.com`;

  // 인증번호 받기 → 확인 → verificationToken
  async function verify(email: string, purpose: 'signup' | 'reset') {
    clock.advance(2 * MIN); // 재전송 간격(60초) 밖에서 시작
    await post('/auth/email/code', { email, purpose }).expect(200);
    // 서버는 소문자로 바꾼 주소로 보낸다
    const code = mail.codes.get(email.toLowerCase())!;
    const res = await post('/auth/email/verify', {
      email,
      purpose,
      code,
    }).expect(200);
    return res.body.verificationToken as string;
  }

  async function signup(
    email = newEmail(),
    password = 'lunch1234',
    name = '지민',
  ) {
    const verificationToken = await verify(email, 'signup');
    const res = await post('/auth/email/signup', {
      email,
      password,
      name,
      verificationToken,
    }).expect(200);
    return { email, password, ...res.body };
  }

  describe('이메일 가입 · 로그인', () => {
    it('인증번호 → 확인 → 가입 → /me → 로그아웃 → 로그인', async () => {
      const email = 'Jimin@Example.com';
      const user = await signup(email);
      expect(user.isNewUser).toBe(true);
      expect(user.user).toMatchObject({
        name: '지민',
        provider: 'email',
        role: 'user',
        onboardingCompleted: false,
      });

      const me = await get('/me', user.accessToken).expect(200);
      expect(me.body).toMatchObject({
        id: user.user.id,
        provider: 'email',
        stats: { reviewCount: 0, favoriteCount: 0, recommendationCount: 0 },
      });
      // API.md: 시각은 KST(+09:00)
      expect(me.body.createdAt).toMatch(/\+09:00$/);

      await post('/auth/logout', { refreshToken: user.refreshToken }).expect(
        204,
      );
      await post('/auth/refresh', { refreshToken: user.refreshToken }).expect(
        401,
      );

      // 이메일은 소문자로 저장된다
      const login = await post('/auth/email/login', {
        email: 'jimin@example.com',
        password: 'lunch1234',
      }).expect(200);
      expect(login.body.isNewUser).toBe(false);
      expect(login.body.user.id).toBe(user.user.id);
    });

    it('이미 가입된 이메일로 가입 인증번호 → 409 EMAIL_TAKEN', async () => {
      const { email } = await signup();
      clock.advance(2 * MIN);
      const res = await post('/auth/email/code', {
        email,
        purpose: 'signup',
      }).expect(409);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('비밀번호 · 이름 규칙 → 400 VALIDATION_FAILED + fields', async () => {
      const email = newEmail();
      const verificationToken = await verify(email, 'signup');
      const short = await post('/auth/email/signup', {
        email,
        password: 'short',
        name: '지민',
        verificationToken,
      }).expect(400);
      expect(short.body.error.fields.password).toMatch(/8~64자/);
      const name = await post('/auth/email/signup', {
        email,
        password: 'lunch1234',
        name: '지',
        verificationToken,
      }).expect(400);
      expect(name.body.error.fields.name).toMatch(/2~12자/);
      const bad = await post('/auth/email/code', {
        email: 'nope',
        purpose: 'signup',
      }).expect(400);
      expect(bad.body.error.fields.email).toBe('이메일 형식이 맞지 않아요.');
    });

    it('틀린 비밀번호 5번 → 6번째는 맞아도 429, 15분 뒤 풀림', async () => {
      const { email, password } = await signup();
      for (let i = 0; i < 5; i++) {
        const res = await post('/auth/email/login', {
          email,
          password: 'wrong1234',
        }).expect(401);
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      }
      const locked = await post('/auth/email/login', {
        email,
        password,
      }).expect(429);
      expect(locked.body.error.code).toBe('RATE_LIMITED');
      clock.advance(16 * MIN);
      await post('/auth/email/login', { email, password }).expect(200);
    });
  });

  describe('인증번호 규칙', () => {
    it('60초 안에 다시 요청 → 429, 지나면 다시 받음', async () => {
      const email = newEmail();
      clock.advance(2 * MIN);
      await post('/auth/email/code', { email, purpose: 'signup' }).expect(200);
      const again = await post('/auth/email/code', {
        email,
        purpose: 'signup',
      }).expect(429);
      expect(again.body.error.code).toBe('RATE_LIMITED');
      clock.advance(61_000);
      await post('/auth/email/code', { email, purpose: 'signup' }).expect(200);
    });

    it('5번 틀리면 맞는 번호도 CODE_EXPIRED', async () => {
      const email = newEmail();
      clock.advance(2 * MIN);
      await post('/auth/email/code', { email, purpose: 'signup' }).expect(200);
      const code = mail.codes.get(email)!;
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        const res = await post('/auth/email/verify', {
          email,
          purpose: 'signup',
          code: wrong,
        });
        expect(res.body.error.code).toBe('INVALID_CODE');
      }
      const res = await post('/auth/email/verify', {
        email,
        purpose: 'signup',
        code,
      }).expect(400);
      expect(res.body.error.code).toBe('CODE_EXPIRED');
    });

    it('10분이 지나면 CODE_EXPIRED', async () => {
      const email = newEmail();
      clock.advance(2 * MIN);
      await post('/auth/email/code', { email, purpose: 'signup' }).expect(200);
      clock.advance(10 * MIN + 1000);
      const res = await post('/auth/email/verify', {
        email,
        purpose: 'signup',
        code: mail.codes.get(email),
      }).expect(400);
      expect(res.body.error.code).toBe('CODE_EXPIRED');
    });

    it('가입하지 않은 이메일의 재설정 요청 → 같은 응답, 메일은 안 보냄', async () => {
      const email = newEmail();
      clock.advance(2 * MIN);
      const res = await post('/auth/email/code', {
        email,
        purpose: 'reset',
      }).expect(200);
      expect(res.body).toEqual({ expiresInSec: 600, resendAfterSec: 60 });
      expect(mail.codes.has(email)).toBe(false);
    });
  });

  describe('비밀번호 재설정 · 바꾸기', () => {
    it('재설정 → 옛 refreshToken 폐기, 새 비밀번호로 로그인, verificationToken은 한 번만', async () => {
      const user = await signup();
      const verificationToken = await verify(user.email, 'reset');
      await post('/auth/email/password-reset', {
        email: user.email,
        password: 'newpass12',
        verificationToken,
      }).expect(204);
      await post('/auth/refresh', { refreshToken: user.refreshToken }).expect(
        401,
      );
      await post('/auth/email/login', {
        email: user.email,
        password: user.password,
      }).expect(401);
      await post('/auth/email/login', {
        email: user.email,
        password: 'newpass12',
      }).expect(200);

      const reuse = await post('/auth/email/password-reset', {
        email: user.email,
        password: 'other123',
        verificationToken,
      }).expect(400);
      expect(reuse.body.error.code).toBe('INVALID_CODE');
    });

    it('/me/password: 틀린 현재 · 같은 비밀번호 · 규칙 · 성공', async () => {
      const user = await signup();
      const change = (currentPassword: string, newPassword: string) =>
        post(
          '/me/password',
          { currentPassword, newPassword },
          user.accessToken,
        );

      expect(
        (await change('wrong1234', 'next1234').expect(401)).body.error.code,
      ).toBe('INVALID_CREDENTIALS');
      expect(
        (await change(user.password, user.password).expect(400)).body.error
          .fields,
      ).toHaveProperty('newPassword');
      await change(user.password, 'nodigits').expect(400);
      await change(user.password, 'next1234').expect(204);

      await post('/auth/email/login', {
        email: user.email,
        password: user.password,
      }).expect(401);
      await post('/auth/email/login', {
        email: user.email,
        password: 'next1234',
      }).expect(200);
      // 지금 기기의 로그인은 유지된다
      await post('/auth/refresh', { refreshToken: user.refreshToken }).expect(
        200,
      );
    });

    it('/me/password: 소셜 계정 → 400', async () => {
      const social = await post('/auth/login', {
        provider: 'kakao',
        providerToken: 'dev:pw',
      }).expect(200);
      await post(
        '/me/password',
        { currentPassword: 'x', newPassword: 'next1234' },
        social.body.accessToken,
      ).expect(400);
    });
  });

  describe('토큰', () => {
    it('refresh 회전, 폐기된 토큰을 다시 쓰면 모든 토큰 폐기', async () => {
      const user = await signup();
      const first = await post('/auth/refresh', {
        refreshToken: user.refreshToken,
      }).expect(200);
      expect(first.body.refreshToken).not.toBe(user.refreshToken);
      await get('/me', first.body.accessToken).expect(200);

      // 옛 토큰 재사용 → 탈취로 보고 새 토큰까지 폐기
      await post('/auth/refresh', { refreshToken: user.refreshToken }).expect(
        401,
      );
      await post('/auth/refresh', {
        refreshToken: first.body.refreshToken,
      }).expect(401);
    });

    it('없는 refreshToken → 401', async () => {
      const res = await post('/auth/refresh', { refreshToken: 'nope' }).expect(
        401,
      );
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('탈퇴', () => {
    it('탈퇴 → 남은 accessToken 401, 같은 이메일로 다시 가입', async () => {
      const user = await signup();
      await http()
        .delete('/v1/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(204);
      await get('/me', user.accessToken).expect(401);
      await post('/auth/refresh', { refreshToken: user.refreshToken }).expect(
        401,
      );
      await post('/auth/email/login', {
        email: user.email,
        password: user.password,
      }).expect(401);

      const row = await prisma.user.findUniqueOrThrow({
        where: { id: user.user.id },
      });
      expect(row).toMatchObject({
        status: 'withdrawn',
        email: null,
        passwordHash: null,
      });

      const again = await signup(user.email);
      expect(again.user.id).not.toBe(user.user.id);
    });
  });

  describe('소셜 (개발용 dev: 토큰)', () => {
    it('처음이면 가입, 다음부터 같은 계정', async () => {
      const first = await post('/auth/login', {
        provider: 'google',
        providerToken: 'dev:abc:하준',
      }).expect(200);
      expect(first.body).toMatchObject({
        isNewUser: true,
        user: { name: '하준', provider: 'google', onboardingCompleted: false },
      });
      const second = await post('/auth/login', {
        provider: 'google',
        providerToken: 'dev:abc',
      }).expect(200);
      expect(second.body.isNewUser).toBe(false);
      expect(second.body.user.id).toBe(first.body.user.id);
    });

    it('키 설정이 없는 회사의 실제 토큰 → 400 "설정이 필요해요"', async () => {
      const res = await post('/auth/login', {
        provider: 'apple',
        providerToken: 'real',
      }).expect(400);
      expect(res.body.error.message).toMatch(/Apple 로그인 설정이 필요해요/);
    });
  });

  describe('어드민', () => {
    const adminLogin = (otp: string, password = 'admin1234') =>
      post('/admin/auth/login', { loginId: 'admin', password, otp });

    it('인증 앱 OTP(TOTP)로 로그인 → /admin/me, 사용자 토큰은 401', async () => {
      const res = await adminLogin(
        totp(ADMIN_SECRET, clock.now().getTime()),
      ).expect(200);
      expect(res.body.admin).toMatchObject({
        loginId: 'admin',
        name: '운영자',
      });
      await get('/admin/me', res.body.accessToken).expect(200);

      const user = await signup();
      await get('/admin/me', user.accessToken).expect(401);
      // 어드민 토큰으로 사용자 API도 못 부른다
      await get('/me', res.body.accessToken).expect(401);
    });

    it('개발 환경 OTP 123456, refresh 회전, 로그아웃(body 없음)은 모든 토큰 폐기', async () => {
      const res = await adminLogin('123456').expect(200);
      const next = await post('/admin/auth/refresh', {
        refreshToken: res.body.refreshToken,
      }).expect(200);
      await post('/admin/auth/logout', {}, next.body.accessToken).expect(204);
      await post('/admin/auth/refresh', {
        refreshToken: next.body.refreshToken,
      }).expect(401);
    });

    it('틀린 OTP 5번 → 잠금 429, 15분 뒤 풀림 + 감사 로그', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await adminLogin('000000').expect(401);
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      }
      await adminLogin('123456').expect(429);
      clock.advance(16 * MIN);
      await adminLogin('123456').expect(200);

      const actions = await prisma.adminAuditLog.groupBy({
        by: ['action'],
        _count: true,
      });
      const count = Object.fromEntries(
        actions.map((a) => [a.action, a._count]),
      );
      expect(count['admin.login_failed']).toBeGreaterThanOrEqual(5);
      expect(count['admin.login_locked']).toBeGreaterThanOrEqual(1);
      expect(count['admin.login']).toBeGreaterThanOrEqual(3);
      expect(count['admin.logout']).toBeGreaterThanOrEqual(1);
    });
  });
});
