import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsInt, IsString, Max, Min } from 'class-validator';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import type { AuthUser } from '../src/common/auth/auth.types.js';
import {
  AdminRoute,
  CurrentUser,
  Public,
} from '../src/common/auth/decorators.js';
import { TokenService } from '../src/common/auth/token.service.js';
import { AppException } from '../src/common/errors/app.exception.js';
import { RedisService } from '../src/integrations/cache/redis.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

class ProbeInput {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  content: string;
}

// 공통 규칙(가드 · 에러 형식 · 검증)만 확인하는 시험용 경로
@Controller('probe')
class ProbeController {
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return { userId: user.id };
  }

  @Public()
  @Get('public')
  open(@CurrentUser() user?: AuthUser) {
    return { userId: user?.id ?? null };
  }

  @Public()
  @Post('validate')
  validate(@Body() body: ProbeInput) {
    return body;
  }

  @Public()
  @Get('limit')
  limit() {
    throw new AppException('REVIEW_DAILY_LIMIT');
  }

  @Public()
  @Get('crash')
  crash() {
    throw new Error('boom');
  }
}

@AdminRoute()
@Controller('admin/probe')
class AdminProbeController {
  @Get()
  get() {
    return { ok: true };
  }
}

describe('lunchtime-be 공통 (e2e)', () => {
  let app: INestApplication<App>;
  let tokens: TokenService;
  const db = { up: true };
  const cache = { up: true };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController, AdminProbeController],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: () =>
          db.up ? Promise.resolve([1]) : Promise.reject(new Error('down')),
        $disconnect: () => Promise.resolve(),
      })
      .overrideProvider(RedisService)
      .useValue({ ping: () => Promise.resolve(cache.up) })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    tokens = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('GET /health → 200, DB · Redis up', async () => {
    db.up = cache.up = true;
    const res = await http().get('/health').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { db: 'up', redis: 'up' },
    });
  });

  it('GET /health → DB가 꺼져 있으면 503 + 무엇이 down인지', async () => {
    db.up = false;
    const res = await http().get('/health').expect(503);
    expect(res.body).toEqual({
      status: 'degraded',
      checks: { db: 'down', redis: 'up' },
    });
    db.up = true;
  });

  it('없는 경로 → 404 { error: { code: NOT_FOUND } }', async () => {
    const res = await http().get('/v1/nope').expect(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) },
    });
  });

  it('API는 /v1 아래에 있다', async () => {
    await http().get('/probe/public').expect(404);
    await http().get('/v1/probe/public').expect(200);
  });

  it('로그인 필수: 토큰 없음 · 엉터리 토큰 → 401 UNAUTHORIZED', async () => {
    const none = await http().get('/v1/probe/me').expect(401);
    expect(none.body.error.code).toBe('UNAUTHORIZED');
    await http()
      .get('/v1/probe/me')
      .set('Authorization', 'Bearer nope')
      .expect(401);
  });

  it('로그인 필수: 사용자 토큰 → 통과, 어드민 토큰 → 401', async () => {
    const user = await tokens.signAccess('user', 'u_1');
    const res = await http()
      .get('/v1/probe/me')
      .set('Authorization', `Bearer ${user}`)
      .expect(200);
    expect(res.body).toEqual({ userId: 'u_1' });
    const admin = await tokens.signAccess('admin', 'a_1');
    await http()
      .get('/v1/probe/me')
      .set('Authorization', `Bearer ${admin}`)
      .expect(401);
  });

  it('어드민 경로: 어드민 토큰만 통과, 사용자 토큰 → 401', async () => {
    const admin = await tokens.signAccess('admin', 'a_1');
    await http()
      .get('/v1/admin/probe')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    const user = await tokens.signAccess('user', 'u_1');
    const res = await http()
      .get('/v1/admin/probe')
      .set('Authorization', `Bearer ${user}`)
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('공개 경로: 토큰이 없거나 틀려도 통과, 맞으면 사용자로 인식', async () => {
    expect((await http().get('/v1/probe/public').expect(200)).body).toEqual({
      userId: null,
    });
    await http()
      .get('/v1/probe/public')
      .set('Authorization', 'Bearer expired')
      .expect(200);
    const user = await tokens.signAccess('user', 'u_9');
    const res = await http()
      .get('/v1/probe/public')
      .set('Authorization', `Bearer ${user}`)
      .expect(200);
    expect(res.body).toEqual({ userId: 'u_9' });
  });

  it('검증 실패 → 400 VALIDATION_FAILED + fields', async () => {
    const res = await http()
      .post('/v1/probe/validate')
      .send({ rating: 9, content: 1, extra: true })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body.error.fields).sort()).toEqual([
      'content',
      'extra',
      'rating',
    ]);
  });

  it('AppException → API.md 코드 · 상태 그대로', async () => {
    const res = await http().get('/v1/probe/limit').expect(409);
    expect(res.body.error.code).toBe('REVIEW_DAILY_LIMIT');
  });

  it('예상 못 한 오류 → 500 INTERNAL_ERROR (내부 메시지는 숨김)', async () => {
    const res = await http().get('/v1/probe/crash').expect(500);
    expect(res.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toContain('boom');
  });

  it('GET /docs-json → OpenAPI 문서', async () => {
    const res = await http().get('/docs-json').expect(200);
    expect(res.body.paths['/health']).toBeDefined();
  });
});
