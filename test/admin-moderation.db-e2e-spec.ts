import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { hashPassword } from '../src/common/auth/password.js';
import {
  KakaoLocalClient,
  type KakaoPlaceDoc,
} from '../src/integrations/kakao/kakao-local.client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// 다른 테스트 파일과 Redis 캐시가 겹치지 않게 32.x 좌표를 쓴다
const run = Date.now() % 1000;
const O = { lat: 32.0 + run / 1000, lng: 126.0 };
const id = (n: number) => `md${run}_${n}`;
const doc = (n: number): KakaoPlaceDoc => ({
  id: id(n),
  place_name: `신고 식당 ${n}`,
  category_name: '음식점 > 한식',
  address_name: '제주 서귀포시',
  road_address_name: '',
  phone: '',
  x: String(O.lng),
  y: String(O.lat + (n * 100) / 111_000),
  place_url: '',
});

class FakeKakaoLocal {
  searchRestaurants() {
    return Promise.resolve([doc(1), doc(2)]);
  }
}

describe('어드민 유저 관리 · 리뷰 신고 (DB e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminToken = '';
  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  let reviewA = '';
  let reviewB = '';

  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminToken}`);
  const asUser = (req: request.Test, who: string) =>
    req.set('Authorization', `Bearer ${tokens[who]}`);
  const NAME = `모더${run}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KakaoLocalClient)
      .useValue(new FakeKakaoLocal())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.adminUser.upsert({
      where: { loginId: 'moderator' },
      create: {
        loginId: 'moderator',
        passwordHash: await hashPassword('admin1234'),
        otpSecret: 'JBSWY3DPEHPK3PXP',
        name: '신고담당',
      },
      update: {},
    });
    adminToken = (
      await http()
        .post('/v1/admin/auth/login')
        .send({ loginId: 'moderator', password: 'admin1234', otp: '123456' })
        .expect(200)
    ).body.accessToken;

    // 작성자 · 신고자 2명 (이름에 run을 넣어 검색으로 찾는다)
    for (const who of ['author', 'r1', 'r2']) {
      const res = await http()
        .post('/v1/auth/login')
        .send({
          provider: 'kakao',
          providerToken: `dev:md-${who}-${run}:${who === 'author' ? NAME : '신고자'}`,
        })
        .expect(200);
      tokens[who] = res.body.accessToken;
      userIds[who] = (
        await asUser(http().get('/v1/me'), who).expect(200)
      ).body.id;
    }
    await http()
      .get('/v1/restaurants')
      .query({ lat: O.lat, lng: O.lng })
      .expect(200);
    const write = async (placeId: string, rating: number) =>
      (
        await asUser(
          http().post(`/v1/restaurants/${placeId}/reviews`),
          'author',
        )
          .send({ rating, content: `신고될 리뷰 ${rating}` })
          .expect(201)
      ).body.review.id as string;
    reviewA = await write(id(1), 1);
    reviewB = await write(id(2), 5);
    const report = (who: string, reviewId: string, body: object) =>
      asUser(http().post(`/v1/reviews/${reviewId}/reports`), who)
        .send(body)
        .expect(204);
    await report('r1', reviewA, { reason: 'abuse', memo: '욕이 있어요' });
    await report('r2', reviewA, { reason: 'abuse', memo: '불쾌해요' });
    await report('r1', reviewB, { reason: 'ad' });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('권한', () => {
    it('사용자 토큰 · 토큰 없음 → 401', async () => {
      await asUser(http().get('/v1/admin/users'), 'r1').expect(401);
      await http().get('/v1/admin/reports').expect(401);
    });
  });

  describe('유저 관리', () => {
    it('목록: 이름 검색 · 리뷰 · 받은 신고 수 · 이메일 가림', async () => {
      const res = await asAdmin(http().get('/v1/admin/users'))
        .query({ q: NAME })
        .expect(200);
      expect(res.body).toMatchObject({ total: 1, page: 1, size: 20 });
      expect(res.body.items[0]).toMatchObject({
        id: userIds.author,
        name: NAME,
        maskedEmail: '',
        provider: 'kakao',
        reviewCount: 2,
        favoriteCount: 0,
        reportCount: 3,
        status: 'active',
        suspendedUntil: null,
      });
      expect(res.body.items[0].createdAt).toMatch(/\+09:00$/);
      await asAdmin(http().get('/v1/admin/users'))
        .query({ status: 'banned' })
        .expect(400);
    });

    it('정지: 사유 필수 → 7일 정지 → 사용자 리뷰 403(사유) → 해제', async () => {
      const before = (
        await asAdmin(http().get('/v1/admin/users/summary')).expect(200)
      ).body;
      await asAdmin(http().post(`/v1/admin/users/${userIds.r2}/suspend`))
        .send({ days: 7, reason: '  ' })
        .expect(400);
      const res = await asAdmin(
        http().post(`/v1/admin/users/${userIds.r2}/suspend`),
      )
        .send({ days: 7, reason: '도배' })
        .expect(200);
      expect(res.body).toMatchObject({ id: userIds.r2, status: 'suspended' });
      const until = new Date(res.body.suspendedUntil).getTime();
      expect(Math.abs(until - (Date.now() + 7 * 86_400_000))).toBeLessThan(
        60_000,
      );
      const after = (
        await asAdmin(http().get('/v1/admin/users/summary')).expect(200)
      ).body;
      expect(after.suspended).toBe(before.suspended + 1);

      const blocked = await asUser(
        http().post(`/v1/restaurants/${id(1)}/reviews`),
        'r2',
      )
        .send({ rating: 3 })
        .expect(403);
      expect(blocked.body.error.code).toBe('USER_SUSPENDED');
      expect(blocked.body.error.message).toContain('도배');

      const filtered = await asAdmin(http().get('/v1/admin/users'))
        .query({ status: 'suspended', size: 100 })
        .expect(200);
      expect(
        filtered.body.items.some((u: { id: string }) => u.id === userIds.r2),
      ).toBe(true);

      const freed = await asAdmin(
        http().post(`/v1/admin/users/${userIds.r2}/unsuspend`),
      ).expect(200);
      expect(freed.body).toMatchObject({
        status: 'active',
        suspendedUntil: null,
      });
      const log = await prisma.adminAuditLog.findFirst({
        where: { action: 'user.suspend', targetId: userIds.r2 },
      });
      expect(log?.detail).toEqual({ days: 7, reason: '도배' });
    });

    it('기간이 지난 정지는 정상으로 보인다, 무기한은 until null', async () => {
      await asAdmin(http().post(`/v1/admin/users/${userIds.r1}/suspend`))
        .send({ reason: '무기한 테스트' })
        .expect(200)
        .expect((res) => {
          expect(res.body.suspendedUntil).toBeNull();
          expect(res.body.status).toBe('suspended');
        });
      await prisma.user.update({
        where: { id: userIds.r1 },
        data: { suspendedUntil: new Date(Date.now() - 1000) },
      });
      const res = await asAdmin(http().get('/v1/admin/users'))
        .query({ status: 'suspended', size: 100 })
        .expect(200);
      expect(
        res.body.items.some((u: { id: string }) => u.id === userIds.r1),
      ).toBe(false);
    });

    it('탈퇴한 유저 정지 → 409, 없는 유저 → 404', async () => {
      const gone = await http()
        .post('/v1/auth/login')
        .send({ provider: 'kakao', providerToken: `dev:md-gone-${run}` })
        .expect(200);
      const goneId = (
        await http()
          .get('/v1/me')
          .set('Authorization', `Bearer ${gone.body.accessToken}`)
      ).body.id;
      await http()
        .delete('/v1/me')
        .set('Authorization', `Bearer ${gone.body.accessToken}`)
        .expect(204);
      await asAdmin(http().post(`/v1/admin/users/${goneId}/suspend`))
        .send({ days: 1, reason: '테스트' })
        .expect(409);
      await asAdmin(http().post('/v1/admin/users/nobody/suspend'))
        .send({ days: 1, reason: '테스트' })
        .expect(404);
    });

    it('CSV: 같은 조건 · 엑셀 수식 막기', async () => {
      await prisma.user.update({
        where: { id: userIds.author },
        data: { name: `=${NAME}` },
      });
      const res = await asAdmin(http().get('/v1/admin/users/export.csv'))
        .query({ q: NAME })
        .expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const lines = res.text.split('\n');
      expect(lines[0]).toBe(
        'id,이름,이메일,로그인,가입일,최근 접속,리뷰,찜,받은 신고,상태',
      );
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain(`'=${NAME}`);
      expect(lines[1]).toMatch(/,카카오,\d{4}-\d{2}-\d{2},/);
      await prisma.user.update({
        where: { id: userIds.author },
        data: { name: NAME },
      });
    });
  });

  describe('리뷰 신고', () => {
    const group = async (reviewId: string, status?: string) => {
      const res = await asAdmin(http().get('/v1/admin/reports'))
        .query({ size: 100, ...(status && { status }) })
        .expect(200);
      return res.body.items.find(
        (g: { review: { id: string } }) => g.review.id === reviewId,
      );
    };

    it('리뷰 단위 묶음: 사유별 수 · 메모(최신 먼저) · 작성자 이력', async () => {
      const g = await group(reviewA, 'pending');
      expect(g).toMatchObject({
        status: 'pending',
        resolution: null,
        reasonCounts: { abuse: 2, ad: 0, false_info: 0, irrelevant: 0 },
        reportCount: 2,
        memos: ['불쾌해요', '욕이 있어요'],
        authorHistory: { reviewCount: 2, reportCount: 3, deletedCount: 0 },
      });
      expect(g.review).toMatchObject({ id: reviewA, rating: 1, isMine: false });
      // 최근 신고 순: B가 나중에 신고됐다
      const list = await asAdmin(http().get('/v1/admin/reports'))
        .query({ status: 'pending', size: 100 })
        .expect(200);
      const ids = list.body.items.map(
        (x: { review: { id: string } }) => x.review.id,
      );
      expect(ids.indexOf(reviewB)).toBeLessThan(ids.indexOf(reviewA));
      await asAdmin(http().get(`/v1/admin/reports/${reviewA}`)).expect(200);
      await asAdmin(http().get('/v1/admin/reports/nothing')).expect(404);
    });

    it('기각 → 다시 처리 409, 새 신고가 오면 다시 대기', async () => {
      const before = (
        await asAdmin(http().get('/v1/admin/reports/summary')).expect(200)
      ).body;
      const res = await asAdmin(
        http().post(`/v1/admin/reports/${reviewB}/resolve`),
      )
        .send({ action: 'dismiss' })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'resolved',
        resolution: 'dismissed',
      });
      await asAdmin(http().post(`/v1/admin/reports/${reviewB}/resolve`))
        .send({ action: 'dismiss' })
        .expect(409);
      await asAdmin(http().post(`/v1/admin/reports/${reviewB}/resolve`))
        .send({ action: 'hide' })
        .expect(400);
      // 리뷰는 그대로 보인다
      const visible = await http()
        .get(`/v1/restaurants/${id(2)}/reviews`)
        .expect(200);
      expect(visible.body.items[0].id).toBe(reviewB);

      const after = (
        await asAdmin(http().get('/v1/admin/reports/summary')).expect(200)
      ).body;
      expect(after.pending).toBe(before.pending - 1);
      expect(after.resolvedThisMonth).toBe(before.resolvedThisMonth + 1);

      await asUser(http().post(`/v1/reviews/${reviewB}/reports`), 'r2')
        .send({ reason: 'false_info' })
        .expect(204);
      expect((await group(reviewB, 'pending'))?.reportCount).toBe(2);
    });

    it('삭제 + 작성자 3일 정지 → 리뷰 · 집계에서 빠지고 이력에 남는다', async () => {
      const res = await asAdmin(
        http().post(`/v1/admin/reports/${reviewA}/resolve`),
      )
        .send({ action: 'delete', suspendAuthorDays: 3 })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'resolved',
        resolution: 'deleted',
        authorHistory: { reviewCount: 1, deletedCount: 1 },
      });
      const list = await http()
        .get(`/v1/restaurants/${id(1)}/reviews`)
        .expect(200);
      expect(list.body.items).toHaveLength(0);
      expect(
        await prisma.placeStats.findUnique({ where: { placeId: id(1) } }),
      ).toMatchObject({ reviewCount: 0, ratingSum: 0 });

      const author = await prisma.user.findUniqueOrThrow({
        where: { id: userIds.author },
      });
      expect(author.status).toBe('suspended');
      expect(author.suspendReason).toBe('신고된 리뷰 (욕설·비방)');
      // 처리된 신고는 resolved 목록에 남는다
      expect((await group(reviewA, 'resolved'))?.resolution).toBe('deleted');
      // 지운 리뷰는 더 신고할 수 없다
      await asUser(http().post(`/v1/reviews/${reviewA}/reports`), 'r2')
        .send({ reason: 'ad' })
        .expect(404);
      const audit = await prisma.adminAuditLog.findFirst({
        where: { action: 'report.resolve', targetId: reviewA },
      });
      expect(audit?.detail).toMatchObject({
        action: 'delete',
        suspendAuthorDays: 3,
        reports: 2,
      });
    });
  });
});
