import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AppException } from '../src/common/errors/app.exception.js';
import {
  KakaoLocalClient,
  type KakaoPlaceDoc,
} from '../src/integrations/kakao/kakao-local.client.js';
import { KmaClient } from '../src/integrations/kma/kma.client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Redis 캐시(검색 결과 · 장소 기억)는 개발 서버와 같이 쓰므로 실행마다 기준점 · 장소 ID를 바꾼다
const run = Date.now() % 1000;
const O = { lat: 36.0 + run / 1000, lng: 127.0 };
const id = (n: number) => `t${run}_${n}`;

// 기준점에서 북쪽으로 m만큼
function doc(
  n: number,
  name: string,
  category: string,
  northM: number,
): KakaoPlaceDoc {
  return {
    id: id(n),
    place_name: name,
    category_name: category,
    address_name: '서울 강남구 역삼동',
    road_address_name: '서울 강남구 테헤란로',
    phone: '02-000-0000',
    x: String(O.lng),
    y: String(O.lat + northM / 111_000),
    place_url: '',
  };
}

const KEYWORD_DOCS = [
  doc(1, '고봉밥상', '음식점 > 한식', 100), // 키워드, 카테고리 다름 → 4단계
  doc(2, '북창동 순두부', '음식점 > 한식 > 찌개,전골', 400), // 이름 일치 → 2단계
  doc(3, '찌개마을', '음식점 > 한식 > 찌개,전골', 200), // 키워드 + 카테고리 일치 → 3단계
  doc(4, '리뷰맛집', '음식점 > 한식', 900), // 리뷰 근거 → 1단계
  doc(5, '먼 식당', '음식점 > 한식 > 찌개,전골', 1500), // 반경(1000) 밖
  doc(6, '쌀국수집', '음식점 > 아시아음식 > 베트남음식', 300), // 제보 3건 → 빠짐
];
// 카테고리 검색(음식점 전체): 키워드에 없던 찌개,전골 6곳 → 카테고리만 맞는 곳은 5곳까지
const CATEGORY_DOCS = [
  ...KEYWORD_DOCS,
  ...[10, 11, 12, 13, 14, 15].map((n) =>
    doc(n, `동네찌개${n}`, '음식점 > 한식 > 찌개,전골', 500 + n),
  ),
  doc(20, '분식천국', '음식점 > 분식', 50),
];

class FakeKakaoLocal {
  calls = 0;
  down = false;
  searchRestaurants(opts: { keyword?: string }) {
    this.calls++;
    if (this.down)
      return Promise.reject(new AppException('UPSTREAM_UNAVAILABLE'));
    if (!opts.keyword) return Promise.resolve(CATEGORY_DOCS);
    if (opts.keyword === '순두부찌개') return Promise.resolve(KEYWORD_DOCS);
    return Promise.resolve(
      KEYWORD_DOCS.filter((d) => d.place_name.includes(opts.keyword!)),
    );
  }
}

class FakeKma {
  configured = true;
  down = false;
  calls = 0;
  fetch(op: string) {
    this.calls++;
    if (this.down)
      return Promise.reject(new AppException('UPSTREAM_UNAVAILABLE'));
    if (op === 'getUltraSrtNcst') {
      return Promise.resolve([
        { category: 'T1H', obsrValue: '18.4' },
        { category: 'PTY', obsrValue: '0' },
      ]);
    }
    if (op === 'getUltraSrtFcst') {
      return Promise.resolve([
        {
          category: 'SKY',
          fcstDate: '20261016',
          fcstTime: '1200',
          fcstValue: '1',
        },
      ]);
    }
    return Promise.resolve([]);
  }
}

describe('식당 · 찜 · 날씨 (DB e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const kakao = new FakeKakaoLocal();
  const kma = new FakeKma();
  let token = '';
  let otherToken = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KakaoLocalClient)
      .useValue(kakao)
      .overrideProvider(KmaClient)
      .useValue(kma)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.menu.createMany({
      data: [
        {
          id: 'rm_1',
          name: `얼큰 순두부찌개 ${run}`,
          cuisine: '한식',
          category: '찌개류',
          ingredients: ['두부'],
          tastes: [],
          spiceLevel: 3,
          weathers: [],
          kakaoKeyword: '순두부찌개',
          kakaoCategory: '찌개,전골',
        },
      ],
      skipDuplicates: true,
    });
    // 리뷰 근거 · 제보 3건 · 별점
    await prisma.placeMenuEvidence.createMany({
      data: [
        { placeId: id(4), menuId: 'rm_1', reviewCount: 12 },
        { placeId: id(6), menuId: 'rm_1', reportCount: 3 },
      ],
    });
    await prisma.placeStats.createMany({
      data: [
        { placeId: id(3), ratingSum: 9, reviewCount: 2 }, // 4.5
        { placeId: id(1), ratingSum: 3, reviewCount: 1 }, // 3.0
      ],
    });
    // 광고: 이 메뉴, 기준점에서 700m, 반경 1000. 영업시간 있음
    const today = new Date(
      `${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`,
    );
    await prisma.sponsoredPlace.create({
      data: {
        placeId: id(30),
        placeName: '광고 순두부',
        address: '서울 강남구',
        lat: O.lat + 700 / 111_000,
        lng: O.lng,
        category: '음식점 > 한식 > 찌개,전골',
        targetMenuIds: ['rm_1'],
        targetCategories: [],
        radiusM: 1000,
        startDate: new Date(today.getTime() - 86_400_000),
        endDate: new Date(today.getTime() + 86_400_000),
        hours: { open: '00:00', close: '23:59', break: null, closedDays: [] },
        priority: 1,
        feeKrw: 100000,
      },
    });

    const login = async (name: string) =>
      (
        await request(app.getHttpServer())
          .post('/v1/auth/login')
          .send({ provider: 'kakao', providerToken: `dev:${name}${run}` })
          .expect(200)
      ).body.accessToken as string;
    token = await login('rest');
    otherToken = await login('rest2');
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const list = (query: Record<string, unknown>, t?: string) => {
    const req = http()
      .get('/v1/restaurants')
      .query({ lat: O.lat, lng: O.lng, ...query });
    return t ? req.set('Authorization', `Bearer ${t}`) : req;
  };
  const names = (body: { items: { name: string }[] }) =>
    body.items.map((r) => r.name);

  describe('GET /restaurants', () => {
    it('메뉴 검색: 광고 → 리뷰 → 이름 → 키워드(카테고리 일치) → 키워드(불일치) → 카테고리만 5곳', async () => {
      const res = await list({ menuId: 'rm_1', limit: 50 }).expect(200);
      expect(res.body.menu).toEqual({
        id: 'rm_1',
        name: `얼큰 순두부찌개 ${run}`,
        keyword: '순두부찌개',
      });
      expect(names(res.body).slice(0, 5)).toEqual([
        '광고 순두부',
        '리뷰맛집',
        '북창동 순두부',
        '찌개마을',
        '고봉밥상',
      ]);
      // 카테고리만 맞는 곳은 가까운 5곳, 분식 · 반경 밖 · 제보 3건은 빠짐
      expect(names(res.body).slice(5)).toEqual([
        '동네찌개10',
        '동네찌개11',
        '동네찌개12',
        '동네찌개13',
        '동네찌개14',
      ]);
      expect(res.body.total).toBe(10);

      const [ad, review] = res.body.items;
      expect(ad).toMatchObject({
        sponsored: true,
        openNow: true,
        hours: { open: '00:00' },
      });
      expect(review.menuEvidence).toEqual({
        type: 'review',
        count: 12,
        verified: true,
        label: '리뷰 12명이 순두부찌개를 먹었어요',
      });
      expect(res.body.items[2].menuEvidence.type).toBe('name');
      expect(res.body.items.at(-1).menuEvidence.type).toBe('category');
      expect(res.body.items[3]).toMatchObject({
        rating: 4.5,
        reviewCount: 2,
        category: '한식',
      });
      expect(res.body.items[3].walkMinutes).toBe(
        Math.max(1, Math.round(res.body.items[3].distanceM / 80)),
      );

      const ads = await prisma.sponsoredPlace.findFirstOrThrow({
        where: { placeId: id(30) },
      });
      expect(ads.impressions).toBe(1);
    });

    it('자유 검색어: 광고 · 근거 없이 거리순', async () => {
      const res = await list({ q: '순두부' }).expect(200);
      expect(names(res.body)).toEqual(['북창동 순두부']);
      expect(res.body.items[0]).toMatchObject({
        sponsored: false,
        menuEvidence: null,
      });
      expect(res.body.menu).toBeNull();
    });

    it('정렬(리뷰 많은 순) · 최소 별점 · 반경', async () => {
      const byReviews = await list({
        menuId: 'rm_1',
        sort: 'reviews',
        limit: 50,
      }).expect(200);
      expect(byReviews.body.items[0].name).toBe('광고 순두부');
      const rated = await list({ menuId: 'rm_1', minRating: 4 }).expect(200);
      // 광고도 별점 필터에 걸리면 빠진다
      expect(names(rated.body)).toEqual(['찌개마을']);
      const wide = await list({
        menuId: 'rm_1',
        radiusM: 3000,
        limit: 50,
      }).expect(200);
      expect(names(wide.body)).toContain('먼 식당');
    });

    it('페이지: limit · cursor', async () => {
      const first = await list({ menuId: 'rm_1', limit: 4 }).expect(200);
      expect(first.body.items).toHaveLength(4);
      const second = await list({
        menuId: 'rm_1',
        limit: 4,
        cursor: first.body.nextCursor,
      }).expect(200);
      expect(second.body.items[0].name).toBe('고봉밥상');
      await list({ menuId: 'rm_1', cursor: 'broken' }).expect(400);
    });

    it('좌표 없음 → LOCATION_REQUIRED, 없는 메뉴 → 404, 카카오 장애 → 502', async () => {
      const noCoord = await http()
        .get('/v1/restaurants')
        .query({ menuId: 'rm_1' })
        .expect(400);
      expect(noCoord.body.error.code).toBe('LOCATION_REQUIRED');
      await list({ menuId: 'nope' }).expect(404);
      kakao.down = true;
      // 캐시에 없는 반경으로 카카오를 부르게 한다
      const down = await list({ menuId: 'rm_1', radiusM: 2500 }).expect(502);
      expect(down.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
      kakao.down = false;
    });

    it('같은 검색은 10분 캐시 (카카오를 다시 부르지 않음)', async () => {
      const before = kakao.calls;
      await list({ menuId: 'rm_1' }).expect(200);
      expect(kakao.calls).toBe(before);
    });
  });

  describe('상세 · 클릭 · 메뉴 제보', () => {
    it('상세: 검색 때 기억한 정보 + 최근 리뷰 2개 + 별점 분포, 좌표가 있으면 거리', async () => {
      const user = await prisma.user.findFirstOrThrow({
        where: { providerId: `dev-rest${run}` },
      });
      for (const rating of [5, 4, 5]) {
        await prisma.review.create({
          data: {
            userId: user.id,
            placeId: id(3),
            placeName: '찌개마을',
            rating,
            menus: ['순두부찌개'],
            tags: [],
          },
        });
      }
      const res = await http()
        .get(`/v1/restaurants/${id(3)}`)
        .query({ lat: O.lat, lng: O.lng })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        name: '찌개마을',
        distanceM: 200,
        ratingSummary: { 4: 1, 5: 2 },
      });
      expect(res.body.recentReviews).toHaveLength(2);
      expect(res.body.recentReviews[0]).toMatchObject({
        isMine: true,
        author: { name: expect.any(String) },
      });
      expect(res.body.recentReviews[0].createdAt).toMatch(/\+09:00$/);

      const noCoord = await http()
        .get(`/v1/restaurants/${id(3)}`)
        .expect(200);
      expect(noCoord.body.distanceM).toBe(0);
      await http().get('/v1/restaurants/unknown-place').expect(404);
    });

    it('광고 클릭 집계 (비로그인도)', async () => {
      await http()
        .post(`/v1/restaurants/${id(30)}/click`)
        .expect(204);
      const ad = await prisma.sponsoredPlace.findFirstOrThrow({
        where: { placeId: id(30) },
      });
      expect(ad.clicks).toBe(1);
    });

    it('메뉴 제보: 한 번만(409), 3건 쌓이면 확인된 근거 없는 식당은 빠짐', async () => {
      const report = (t: string) =>
        http()
          .post(`/v1/restaurants/${id(1)}/menu-reports`)
          .set('Authorization', `Bearer ${t}`)
          .send({ menuId: 'rm_1' });
      await report(token).expect(204);
      expect((await report(token).expect(409)).body.error.code).toBe(
        'ALREADY_REPORTED_MENU',
      );
      await report(otherToken).expect(204);
      await prisma.placeMenuEvidence.update({
        where: { placeId_menuId: { placeId: id(1), menuId: 'rm_1' } },
        data: { reportCount: { increment: 1 } },
      });
      const res = await list({ menuId: 'rm_1', limit: 50 }).expect(200);
      expect(names(res.body)).not.toContain('고봉밥상');
      await http()
        .post(`/v1/restaurants/${id(1)}/menu-reports`)
        .send({ menuId: 'rm_1' })
        .expect(401);
    });
  });

  describe('찜', () => {
    const auth = (req: request.Test, t = token) =>
      req.set('Authorization', `Bearer ${t}`);

    it('찜 → 목록 · 검색에 isFavorite, 여러 번 해도 한 번, 해제', async () => {
      await auth(http().put(`/v1/me/favorites/${id(3)}`)).expect(204);
      await auth(http().put(`/v1/me/favorites/${id(3)}`)).expect(204);
      await auth(http().put(`/v1/me/favorites/${id(10)}`)).expect(204);
      expect(
        (
          await prisma.placeStats.findUniqueOrThrow({
            where: { placeId: id(3) },
          })
        ).favoriteCount,
      ).toBe(1);

      const favs = await auth(
        http().get('/v1/me/favorites').query({ lat: O.lat, lng: O.lng }),
      ).expect(200);
      expect(favs.body.items.map((r: { name: string }) => r.name)).toEqual([
        '동네찌개10',
        '찌개마을',
      ]);
      expect(favs.body.items[1]).toMatchObject({
        isFavorite: true,
        distanceM: 200,
        rating: 4.5,
      });
      expect(favs.body.nextCursor).toBeNull();

      const searched = await list({ menuId: 'rm_1', limit: 50 }, token).expect(
        200,
      );
      expect(
        searched.body.items.find((r: { name: string }) => r.name === '찌개마을')
          .isFavorite,
      ).toBe(true);
      // 다른 사람에게는 찜 아님
      const other = await list(
        { menuId: 'rm_1', limit: 50 },
        otherToken,
      ).expect(200);
      expect(
        other.body.items.find((r: { name: string }) => r.name === '찌개마을')
          .isFavorite,
      ).toBe(false);

      await auth(http().delete(`/v1/me/favorites/${id(3)}`)).expect(204);
      await auth(http().delete(`/v1/me/favorites/${id(3)}`)).expect(204);
      expect(
        (
          await prisma.placeStats.findUniqueOrThrow({
            where: { placeId: id(3) },
          })
        ).favoriteCount,
      ).toBe(0);
    });

    it('음식 종류 필터 (카카오 "아시아음식" = 아시안)', async () => {
      await auth(http().put(`/v1/me/favorites/${id(6)}`), otherToken).expect(
        204,
      );
      const asian = await auth(
        http().get('/v1/me/favorites').query({ cuisine: '아시안' }),
        otherToken,
      ).expect(200);
      expect(asian.body.items.map((r: { name: string }) => r.name)).toEqual([
        '쌀국수집',
      ]);
      expect(asian.body.items[0].distanceM).toBe(0);
      const korean = await auth(
        http().get('/v1/me/favorites').query({ cuisine: '한식' }),
        otherToken,
      ).expect(200);
      expect(korean.body.items).toEqual([]);
    });

    it('검색에서 본 적 없는 식당 → 404, 비로그인 → 401', async () => {
      await auth(http().put('/v1/me/favorites/never-seen')).expect(404);
      await http().get('/v1/me/favorites').expect(401);
    });
  });

  describe('날씨', () => {
    it('기온 · 하늘 · 최고/최저(없으면 null), 같은 격자는 캐시, 실패 → 502', async () => {
      const lat = O.lat + 0.5; // 다른 실행과 격자가 겹치지 않게
      const res = await http()
        .get('/v1/weather')
        .query({ lat, lng: 128.5 })
        .expect(200);
      expect(res.body).toEqual({
        tempC: 18,
        condition: 'clear',
        label: '맑음',
        highC: null,
        lowC: null,
      });
      const before = kma.calls;
      await http().get('/v1/weather').query({ lat, lng: 128.5 }).expect(200);
      expect(kma.calls).toBe(before);

      kma.down = true;
      const down = await http()
        .get('/v1/weather')
        .query({ lat: lat + 0.3, lng: 129.0 })
        .expect(502);
      expect(down.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
      kma.down = false;
      await http().get('/v1/weather').expect(400);
    });
  });
});
