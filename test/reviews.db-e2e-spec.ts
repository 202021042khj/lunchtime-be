import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import {
  KakaoLocalClient,
  type KakaoPlaceDoc,
} from '../src/integrations/kakao/kakao-local.client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// 다른 테스트 파일과 Redis 캐시가 겹치지 않게 33.x 좌표를 쓴다
const run = Date.now() % 1000;
const O = { lat: 33.0 + run / 1000, lng: 126.5 };
const id = (n: number) => `rv${run}_${n}`;
const KEYWORD = `리뷰찌개${run}`;

const doc = (n: number, name: string): KakaoPlaceDoc => ({
  id: id(n),
  place_name: name,
  category_name: '음식점 > 한식 > 찌개,전골',
  address_name: '제주 제주시',
  road_address_name: '',
  phone: '',
  x: String(O.lng),
  y: String(O.lat + (n * 100) / 111_000),
  place_url: '',
});
const DOCS = [doc(1, '리뷰 식당'), doc(2, '옆 식당')];

class FakeKakaoLocal {
  searchRestaurants() {
    return Promise.resolve(DOCS);
  }
}

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('리뷰 · 사진 · 신고 (DB e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let author = '';
  let other = '';
  let banned = '';
  let reviewId = '';
  let otherReviewId = '';
  let photoUrl = '';
  let photoId = '';

  const http = () => request(app.getHttpServer());
  const as = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);
  const place = id(1);
  const write = (token: string, body: object, placeId = place) =>
    as(http().post(`/v1/restaurants/${placeId}/reviews`), token).send(body);
  const slots = (token: string, count: number) =>
    as(http().post('/v1/uploads/review-photos'), token).send({ count });
  // uploadUrl은 http://localhost:4000/v1/... 이므로 경로만 쓴다
  const put = (uploadUrl: string, body: Buffer) => {
    const url = new URL(uploadUrl);
    return http()
      .put(url.pathname + url.search)
      .set('Content-Type', 'image/png')
      .send(body);
  };
  const stats = () =>
    prisma.placeStats.findUnique({ where: { placeId: place } });
  const evidence = () =>
    prisma.placeMenuEvidence.findUnique({
      where: { placeId_menuId: { placeId: place, menuId: `rvm_${run}` } },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KakaoLocalClient)
      .useValue(new FakeKakaoLocal())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.menu.create({
      data: {
        id: `rvm_${run}`,
        name: `리뷰 테스트 찌개 ${run}`,
        cuisine: '한식',
        category: '찌개류',
        ingredients: [],
        tastes: [],
        spiceLevel: 1,
        weathers: [],
        kakaoKeyword: KEYWORD,
        kakaoCategory: '찌개,전골',
      },
    });
    const login = async (name: string) =>
      (
        await http()
          .post('/v1/auth/login')
          .send({ provider: 'kakao', providerToken: `dev:${name}${run}` })
          .expect(200)
      ).body.accessToken as string;
    author = await login('rv-author');
    other = await login('rv-other');
    banned = await login('rv-banned');
    // 검색으로 식당을 기억시킨다 (카카오에는 ID 조회가 없다)
    await http()
      .get('/v1/restaurants')
      .query({ lat: O.lat, lng: O.lng })
      .expect(200);
  });

  afterAll(async () => {
    await prisma.menu.delete({ where: { id: `rvm_${run}` } });
    await app.close();
  });

  describe('사진 업로드', () => {
    it('주소 발급 → PUT으로 올리기. 한 번만, 서명이 틀리면 403, 사진이 아니면 400', async () => {
      const res = await slots(author, 2).expect(200);
      expect(res.body.items).toHaveLength(2);
      const [first, second] = res.body.items as {
        photoId: string;
        uploadUrl: string;
      }[];
      expect(first.uploadUrl).toMatch(
        /^http:\/\/localhost:4000\/v1\/uploads\/review-photos\/\w+\?exp=\d+&sig=/,
      );

      await put(first.uploadUrl.replace(/sig=[^&]+/, 'sig=bad'), PNG).expect(
        403,
      );
      await put(second.uploadUrl, Buffer.from('<html></html>')).expect(400);
      await put(first.uploadUrl, PNG).expect(204);
      await put(first.uploadUrl, PNG).expect(409);

      const photo = await prisma.reviewPhoto.findUniqueOrThrow({
        where: { id: first.photoId },
      });
      expect(photo.url).toMatch(
        /^http:\/\/localhost:9000\/lunchtime-test\/reviews\/[a-f0-9]{24}\.png$/,
      );
      photoUrl = photo.url;
      const img = await fetch(photo.url);
      expect(img.status).toBe(200);

      // 올리지 않은 사진 · 남의 사진은 리뷰에 붙일 수 없다
      const bad = await write(author, {
        rating: 4,
        photoIds: [second.photoId],
      }).expect(400);
      expect(bad.body.error.fields.photoIds).toBeDefined();
      await write(other, { rating: 4, photoIds: [first.photoId] }).expect(400);

      photoId = first.photoId;
    });

    it('6장 → TOO_MANY_PHOTOS, 비로그인 → 401', async () => {
      const res = await slots(author, 6).expect(400);
      expect(res.body.error.code).toBe('TOO_MANY_PHOTOS');
      await http()
        .post('/v1/uploads/review-photos')
        .send({ count: 1 })
        .expect(401);
    });
  });

  describe('등록', () => {
    it('리뷰 등록 → 별점 · 리뷰 수 · 메뉴 근거 · 식당 사진이 바뀐다', async () => {
      const res = await write(author, {
        rating: 4,
        menus: [KEYWORD, '직접 쓴 메뉴'],
        tags: ['친절해요'],
        content: '  국물이 진해요.  ',
        photoIds: [photoId],
      }).expect(201);
      reviewId = res.body.review.id;
      expect(res.body.review).toMatchObject({
        placeId: place,
        placeName: '리뷰 식당',
        rating: 4,
        menus: [KEYWORD, '직접 쓴 메뉴'],
        content: '국물이 진해요.',
        photos: [{ id: photoId, url: photoUrl }],
        isMine: true,
      });
      expect(res.body.review.createdAt).toMatch(/\+09:00$/);
      expect(res.body.placeStats).toEqual({ rating: 4, reviewCount: 1 });
      expect((await evidence())?.reviewCount).toBe(1);

      const list = await http()
        .get('/v1/restaurants')
        .query({ lat: O.lat, lng: O.lng })
        .expect(200);
      const row = list.body.items.find(
        (r: { placeId: string }) => r.placeId === place,
      );
      expect(row).toMatchObject({
        imageUrl: photoUrl,
        imageSource: 'review',
        rating: 4,
        reviewCount: 1,
      });
    });

    it('같은 식당 오늘 두 번째 → 409, 다음 날은 된다', async () => {
      const res = await write(author, { rating: 5 }).expect(409);
      expect(res.body.error.code).toBe('REVIEW_DAILY_LIMIT');
      // 다른 식당은 된다 → 어제 쓴 것으로 옮기면 같은 식당에 다시 쓸 수 있다
      const yesterday = await write(author, { rating: 3 }, id(2)).expect(201);
      await prisma.review.update({
        where: { id: yesterday.body.review.id },
        data: { createdAt: new Date(Date.now() - 86_400_000) },
      });
      await write(author, { rating: 2 }, id(2)).expect(201);
    });

    it('규칙 위반 · 없는 식당 · 비로그인', async () => {
      const long = await write(other, {
        rating: 3,
        content: 'a'.repeat(501),
      }).expect(400);
      expect(long.body.error.code).toBe('REVIEW_TOO_LONG');
      const tag = await write(other, { rating: 3, tags: ['없는 태그'] }).expect(
        400,
      );
      expect(tag.body.error.fields.tags).toBeDefined();
      await write(other, { rating: 6 }).expect(400);
      await write(other, { rating: 3 }, 'no-such-place').expect(404);
      await http()
        .post(`/v1/restaurants/${place}/reviews`)
        .send({ rating: 3 })
        .expect(401);
    });

    it('다른 사람 리뷰 → 평균이 바뀌고 메뉴 근거는 먹은 사람 수', async () => {
      const res = await write(other, { rating: 2, menus: [KEYWORD] }).expect(
        201,
      );
      otherReviewId = res.body.review.id;
      expect(res.body.placeStats).toEqual({ rating: 3, reviewCount: 2 });
      expect((await evidence())?.reviewCount).toBe(2);
    });

    it('정지된 사용자 → 403 USER_SUSPENDED + until, 기간이 끝났으면 된다', async () => {
      const until = new Date(Date.now() + 3 * 86_400_000);
      const user = (await as(http().get('/v1/me'), banned).expect(200))
        .body as { id: string };
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'suspended', suspendedUntil: until },
      });
      const res = await write(banned, { rating: 5 }).expect(403);
      expect(res.body.error.code).toBe('USER_SUSPENDED');
      expect(res.body.error.until).toMatch(/\+09:00$/);
      await slots(banned, 1).expect(403);
      await as(http().post(`/v1/reviews/${reviewId}/reports`), banned)
        .send({ reason: 'ad' })
        .expect(403);

      await prisma.user.update({
        where: { id: user.id },
        data: { suspendedUntil: new Date(Date.now() - 1000) },
      });
      await slots(banned, 1).expect(200);
    });
  });

  describe('목록 · 상세', () => {
    it('정렬 · 사진 리뷰 · 페이지 · isMine', async () => {
      const get = (query: object, token?: string) => {
        const req = http().get(`/v1/restaurants/${place}/reviews`).query(query);
        return token ? as(req, token) : req;
      };
      const ids = (body: { items: { id: string }[] }) =>
        body.items.map((r) => r.id);

      expect(ids((await get({}).expect(200)).body)).toEqual([
        otherReviewId,
        reviewId,
      ]);
      expect(ids((await get({ sort: 'rating_desc' })).body)).toEqual([
        reviewId,
        otherReviewId,
      ]);
      expect(ids((await get({ sort: 'rating_asc' })).body)).toEqual([
        otherReviewId,
        reviewId,
      ]);
      expect(ids((await get({ sort: 'photo' })).body)).toEqual([reviewId]);

      const first = await get({ limit: 1 }, author).expect(200);
      expect(first.body.items[0].isMine).toBe(false);
      const second = await get(
        { limit: 1, cursor: first.body.nextCursor },
        author,
      ).expect(200);
      expect(second.body.items[0]).toMatchObject({
        id: reviewId,
        isMine: true,
      });
      expect(second.body.nextCursor).toBeNull();
      await get({ sort: 'best' }).expect(400);
    });

    it('식당 상세: 최근 리뷰 2개 · 별점 분포', async () => {
      const res = await http().get(`/v1/restaurants/${place}`).expect(200);
      expect(res.body.recentReviews.map((r: { id: string }) => r.id)).toEqual([
        otherReviewId,
        reviewId,
      ]);
      expect(res.body.ratingSummary).toEqual({ 1: 0, 2: 1, 3: 0, 4: 1, 5: 0 });
    });

    it('리뷰 쓰기 메뉴: 이 식당 리뷰에 자주 나온 메뉴 → 카테고리가 맞는 메뉴 마스터', async () => {
      const res = await http()
        .get(`/v1/restaurants/${place}/review-form`)
        .expect(200);
      expect(res.body.menus.slice(0, 2)).toEqual([KEYWORD, '직접 쓴 메뉴']);
      expect(res.body.tags).toContain('친절해요');
      await http().get('/v1/restaurants/no-such-place/review-form').expect(404);
    });

    it('내 리뷰: 내 것만 최신순', async () => {
      const res = await as(http().get('/v1/me/reviews'), other).expect(200);
      expect(res.body.items.map((r: { id: string }) => r.id)).toEqual([
        otherReviewId,
      ]);
    });
  });

  describe('수정 · 신고 · 삭제', () => {
    it('남의 리뷰 수정 → 403, 내 리뷰는 보낸 항목만 바뀐다', async () => {
      await as(http().patch(`/v1/reviews/${reviewId}`), other)
        .send({ rating: 1 })
        .expect(403);
      const res = await as(http().patch(`/v1/reviews/${reviewId}`), author)
        .send({ rating: 5, menus: ['직접 쓴 메뉴'], photoIds: [] })
        .expect(200);
      expect(res.body.review).toMatchObject({
        rating: 5,
        menus: ['직접 쓴 메뉴'],
        tags: ['친절해요'],
        content: '국물이 진해요.',
        photos: [],
      });
      expect(res.body.placeStats).toEqual({ rating: 3.5, reviewCount: 2 });
      // 메뉴에서 뺐으니 먹은 사람은 한 명
      expect((await evidence())?.reviewCount).toBe(1);
      // 사진을 뺐으니 식당 사진도 없다
      const detail = await http().get(`/v1/restaurants/${place}`).expect(200);
      expect(detail.body.imageUrl).toBeNull();
      expect(detail.body.imageSource).toBeNull();
    });

    it('신고: 내 리뷰 403, 한 번만(409), 사유가 없으면 400', async () => {
      const report = (token: string, body: object) =>
        as(http().post(`/v1/reviews/${reviewId}/reports`), token).send(body);
      await report(author, { reason: 'ad' }).expect(403);
      await report(other, { reason: 'spam' }).expect(400);
      await report(other, { reason: 'ad', memo: 'a'.repeat(201) }).expect(400);
      await report(other, {
        reason: 'false_info',
        memo: ' 사진이 달라요 ',
      }).expect(204);
      const again = await report(other, { reason: 'ad' }).expect(409);
      expect(again.body.error.code).toBe('ALREADY_REPORTED');
      const saved = await prisma.reviewReport.findFirstOrThrow({
        where: { reviewId },
      });
      expect(saved).toMatchObject({
        reason: 'false_info',
        memo: '사진이 달라요',
      });
    });

    it('삭제 → 목록 · 집계에서 빠지고 기록은 남는다', async () => {
      await as(http().delete(`/v1/reviews/${otherReviewId}`), author).expect(
        403,
      );
      await as(http().delete(`/v1/reviews/${otherReviewId}`), other).expect(
        204,
      );
      await as(http().delete(`/v1/reviews/${otherReviewId}`), other).expect(
        404,
      );
      expect(await stats()).toMatchObject({ ratingSum: 5, reviewCount: 1 });
      expect((await evidence())?.reviewCount).toBe(0);
      const list = await http()
        .get(`/v1/restaurants/${place}/reviews`)
        .expect(200);
      expect(list.body.items.map((r: { id: string }) => r.id)).toEqual([
        reviewId,
      ]);
      const row = await prisma.review.findUniqueOrThrow({
        where: { id: otherReviewId },
      });
      expect(row.deletedAt).not.toBeNull();
      // 지운 식당에는 오늘 다시 쓸 수 있다
      await write(other, { rating: 4 }).expect(201);
    });
  });
});
