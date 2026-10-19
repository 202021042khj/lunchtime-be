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

// Redis(검색 · 날씨 · 동네 캐시)는 개발 서버와 같이 쓰므로 실행마다 기준점을 바꾼다
const run = Date.now() % 1000;
// 다른 파일과 좌표대가 겹치지 않게 (날씨 · 검색 캐시 키가 격자 · 좌표 단위): 이 파일은 38.0~38.5, 날씨 실패는 34.2~34.7
const O = { lat: 38.0 + run / 2000, lng: 127.5 };
const NO_WEATHER_LAT = 34.2 + run / 2000;
const KEYWORDS: Record<string, number> = {
  순두부찌개: 3,
  초밥: 2,
  짬뽕: 2,
  쌀국수: 2,
  떡볶이: 1,
  파스타: 1,
};

// 요청한 좌표 바로 북쪽에 식당을 놓는다 (좌표를 바꾼 테스트도 반경 안에 식당이 있게)
function docsFor(keyword: string, lat: number): KakaoPlaceDoc[] {
  return Array.from({ length: KEYWORDS[keyword] ?? 0 }, (_, i) => ({
    id: `r${run}_${Math.round(lat * 1000)}_${keyword}_${i}`,
    place_name: `${keyword}집 ${i + 1}`,
    category_name: '음식점 > 한식',
    address_name: '서울',
    road_address_name: '',
    phone: '',
    x: String(O.lng),
    y: String(lat + (100 + i * 50) / 111_000),
    place_url: '',
  }));
}

class FakeKakaoLocal {
  empty = false;
  searchRestaurants(opts: { keyword?: string; lat: number }) {
    if (this.empty || !opts.keyword) return Promise.resolve([]);
    // 이름 검색("순두부")도 순두부찌개 식당을 준다
    const key =
      Object.keys(KEYWORDS).find((k) => k.includes(opts.keyword!)) ??
      opts.keyword;
    return Promise.resolve(docsFor(key, opts.lat));
  }
  coordToRegion(lat: number) {
    if (lat < 34)
      return Promise.reject(new AppException('OUT_OF_SERVICE_AREA'));
    return Promise.resolve([
      {
        region_type: 'B',
        address_name: '테스트동',
        region_3depth_name: '테스트동',
      },
    ]);
  }
}

class FakeKma {
  configured = true;
  down = false;
  fetch(op: string) {
    if (this.down)
      return Promise.reject(new AppException('UPSTREAM_UNAVAILABLE'));
    if (op === 'getUltraSrtNcst') {
      return Promise.resolve([
        { category: 'T1H', obsrValue: '8' },
        { category: 'PTY', obsrValue: '0' },
      ]);
    }
    if (op === 'getUltraSrtFcst') {
      return Promise.resolve([
        {
          category: 'SKY',
          fcstDate: '20261019',
          fcstTime: '1200',
          fcstValue: '1',
        },
      ]);
    }
    return Promise.resolve([]);
  }
}

describe('추천 · 통합 검색 (DB e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const kakao = new FakeKakaoLocal();
  const kma = new FakeKma();
  let shownBefore: string[] = [];

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

    // 테스트 DB는 다른 파일이 만든 메뉴도 있어서, 추천 후보를 이 파일 메뉴로 한정하려고 나머지는 숨긴다
    shownBefore = (
      await prisma.menu.findMany({
        where: { visible: true },
        select: { id: true },
      })
    ).map((m) => m.id);
    await prisma.menu.updateMany({ data: { visible: false } });
    const menu = (
      id: string,
      name: string,
      cuisine: string,
      keyword: string,
      o: Partial<Record<string, unknown>>,
    ) => ({
      id,
      name,
      cuisine,
      category: cuisine,
      ingredients: ['기본재료'],
      tastes: [],
      spiceLevel: 0,
      weathers: [],
      kakaoKeyword: keyword,
      kakaoCategory: cuisine,
      ...o,
    });
    await prisma.menu.createMany({
      data: [
        menu('rc_1', '얼큰 순두부찌개 RC', '한식', '순두부찌개', {
          spiceLevel: 3,
          tastes: ['국물'],
          weathers: ['cold'],
          ingredients: ['두부'],
        }),
        menu('rc_2', '초밥 RC', '일식', '초밥', { weathers: ['clear'] }),
        menu('rc_3', '짬뽕 RC', '중식', '짬뽕', {
          spiceLevel: 3,
          ingredients: ['새우'],
        }),
        menu('rc_4', '쌀국수 RC', '아시안', '쌀국수', {
          ingredients: ['고수'],
        }),
        menu('rc_5', '떡볶이 RC', '분식', '떡볶이', { spiceLevel: 2 }),
        menu('rc_6', '파스타 RC', '양식', '파스타', {}),
        menu('rc_7', '식당없는메뉴 RC', '한식', '아무도안파는메뉴', {}),
      ],
    });
    await prisma.allergy.upsert({
      where: { name: '갑각류 (새우·게)' },
      create: { name: '갑각류 (새우·게)', ingredients: ['새우', '게'] },
      update: {},
    });
  });

  afterAll(async () => {
    // 숨겼던 메뉴는 되돌리고 이 파일 메뉴는 숨긴다 (다른 테스트 파일에 영향 없게)
    await prisma.menu.updateMany({
      where: { id: { startsWith: 'rc_' } },
      data: { visible: false },
    });
    await prisma.menu.updateMany({
      where: { id: { in: shownBefore } },
      data: { visible: true },
    });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const login = async (name: string) =>
    (
      await http()
        .post('/v1/auth/login')
        .send({ provider: 'kakao', providerToken: `dev:${name}${run}` })
        .expect(200)
    ).body.accessToken as string;
  const withTaste = async (token: string) => {
    await http()
      .put('/v1/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({
        dislikedIngredients: ['고수'],
        allergies: ['갑각류 (새우·게)'],
        spiceLevel: 3,
        favoriteCuisines: ['한식'],
        completeOnboarding: true,
      })
      .expect(200);
  };
  const recommend = (query: Record<string, unknown> = {}, token?: string) => {
    const req = http()
      .get('/v1/recommendations')
      .query({ lat: O.lat, lng: O.lng, ...query });
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const ids = (body: {
    today: { menu: { id: string } } | null;
    alternatives: { menu: { id: string } }[];
  }) => [body.today?.menu.id, ...body.alternatives.map((a) => a.menu.id)];

  it('비로그인: 인기 모드 · 취향 배너, 식당 없는 메뉴는 빠짐', async () => {
    const res = await recommend().expect(200);
    expect(res.body).toMatchObject({
      mode: 'popular',
      promptTaste: true,
      location: { name: '테스트동' },
      weather: { tempC: 8, condition: 'clear' },
      suggestRadiusM: null,
    });
    expect(res.body.today).toMatchObject({
      matchPercent: null,
      popularRank: 1,
    });
    expect(res.body.today.reasons[0]).toEqual({
      type: 'popular',
      label: '이 근처 인기 1위',
    });
    expect(res.body.today.reasons.at(-1).type).toBe('nearby');
    expect(
      res.body.alternatives.map((a: { popularRank: number }) => a.popularRank),
    ).toEqual([2, 3, 4, 5]);
    expect(ids(res.body)).not.toContain('rc_7');
    expect(ids(res.body)).toHaveLength(5);
  });

  it('로그인했지만 취향이 없으면 인기 모드', async () => {
    const res = await recommend({}, await login('notaste')).expect(200);
    expect(res.body).toMatchObject({ mode: 'popular', promptTaste: true });
  });

  it('개인 모드: 못 먹는 재료 · 알레르기 제외, 날씨 · 매운맛 · 제외 이유, 날씨 문장', async () => {
    const token = await login('taste');
    await withTaste(token);
    const res = await recommend({}, token).expect(200);
    expect(res.body).toMatchObject({ mode: 'personal', promptTaste: false });
    expect(ids(res.body)).not.toEqual(expect.arrayContaining(['rc_3'])); // 새우 → 갑각류
    expect(ids(res.body)).not.toContain('rc_4'); // 고수
    expect(res.body.today).toMatchObject({
      menu: { id: 'rc_1' },
      popularRank: null,
      description: '쌀쌀한 날씨엔 뜨끈한 국물이 최고예요.',
      nearbyCount: 3,
    });
    expect(res.body.today.matchPercent).toBeGreaterThanOrEqual(40);
    expect(
      res.body.today.reasons.map((r: { label: string }) => r.label),
    ).toEqual(['쌀쌀한 날씨', '매운맛 좋아함', '고수·갑각류 제외', '주변 3곳']);
    expect(res.body.today.restaurants).toHaveLength(3);
    for (const a of res.body.alternatives)
      expect(a.matchPercent).not.toBeNull();

    // 다시 불러도 같은 추천, 기록은 하루 한 번
    const again = await recommend({}, token).expect(200);
    expect(ids(again.body)).toEqual(ids(res.body));
    const user = await prisma.user.findFirstOrThrow({
      where: { providerId: `dev-taste${run}` },
    });
    expect(
      await prisma.recommendationLog.count({ where: { userId: user.id } }),
    ).toBe(1);
    const me = await http()
      .get('/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.stats.recommendationCount).toBe(1);

    // [다른 메뉴 추천]: 본 메뉴 빼고
    const other = await recommend({ excludeMenuIds: 'rc_1' }, token).expect(
      200,
    );
    expect(other.body.today.menu.id).not.toBe('rc_1');
  });

  it('어제 추천받은 메뉴는 감점', async () => {
    const fresh = await login('fresh');
    await withTaste(fresh);
    const base = (await recommend({}, fresh).expect(200)).body.today;

    const tired = await login('tired');
    await withTaste(tired);
    const user = await prisma.user.findFirstOrThrow({
      where: { providerId: `dev-tired${run}` },
    });
    await prisma.recommendationLog.create({
      data: {
        userId: user.id,
        menuId: base.menu.id,
        createdAt: new Date(Date.now() - 24 * 3600_000),
      },
    });
    const res = await recommend({}, tired).expect(200);
    const same = [res.body.today, ...res.body.alternatives].find(
      (x: { menu: { id: string } }) => x.menu.id === base.menu.id,
    );
    expect(same.matchPercent).toBeLessThan(base.matchPercent);
  });

  it('날씨 실패 → weather null, 날씨 이유 없이 추천은 그대로', async () => {
    kma.down = true;
    const token = await login('noweather');
    await withTaste(token);
    // 다른 격자로 (캐시에 없는 날씨)
    const res = await recommend({ lat: NO_WEATHER_LAT }, token).expect(200);
    kma.down = false;
    expect(res.body.weather).toBeNull();
    expect(res.body.today).not.toBeNull();
    expect(
      res.body.today.reasons.some(
        (r: { type: string }) => r.type === 'weather',
      ),
    ).toBe(false);
  });

  it('근처에 식당이 하나도 없으면 today null · 3km 안내, 3km면 안내 없음', async () => {
    kakao.empty = true;
    const far = { lat: O.lat + 0.8 };
    const res = await recommend(far).expect(200);
    expect(res.body).toMatchObject({
      today: null,
      alternatives: [],
      suggestRadiusM: 3000,
    });
    const wide = await recommend({ ...far, radiusM: 3000 }).expect(200);
    expect(wide.body.suggestRadiusM).toBeNull();
    kakao.empty = false;
  });

  it('좌표 없음 400 LOCATION_REQUIRED, 국내 밖 422', async () => {
    const none = await http().get('/v1/recommendations').expect(400);
    expect(none.body.error.code).toBe('LOCATION_REQUIRED');
    const out = await http()
      .get('/v1/recommendations')
      .query({ lat: 33.0 + run / 1e6, lng: 139.7 })
      .expect(422);
    expect(out.body.error.code).toBe('OUT_OF_SERVICE_AREA');
  });

  describe('GET /search', () => {
    const search = (query: Record<string, unknown>, token?: string) => {
      const req = http()
        .get('/v1/search')
        .query({ lat: O.lat, lng: O.lng, ...query });
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };

    it('메뉴(매칭 % · 근처 수) + 식당(메뉴 근거 먼저)', async () => {
      const token = await login('search');
      await withTaste(token);
      const res = await search({ q: '순두부' }, token).expect(200);
      expect(res.body.menus).toEqual([
        {
          menu: { id: 'rc_1', name: '얼큰 순두부찌개 RC', imageUrl: null },
          matchPercent: expect.any(Number),
          nearbyCount: 3,
        },
      ]);
      expect(res.body.restaurants.map((r: { name: string }) => r.name)).toEqual(
        ['순두부찌개집 1', '순두부찌개집 2', '순두부찌개집 3'],
      );
      expect(res.body.restaurants[0].menuEvidence).not.toBeNull();
    });

    it('비로그인은 매칭 % null, 취향에 걸리는 메뉴도 null', async () => {
      expect(
        (await search({ q: '순두부' }).expect(200)).body.menus[0].matchPercent,
      ).toBeNull();
      const token = await login('search2');
      await withTaste(token);
      expect(
        (await search({ q: '짬뽕' }, token).expect(200)).body.menus[0]
          .matchPercent,
      ).toBeNull();
    });

    it('type: menu · restaurant, 빈 검색어, 좌표 없음', async () => {
      expect(
        (await search({ q: '초밥', type: 'menu' }).expect(200)).body
          .restaurants,
      ).toEqual([]);
      expect(
        (await search({ q: '초밥', type: 'restaurant' }).expect(200)).body
          .menus,
      ).toEqual([]);
      expect((await search({ q: ' ' }).expect(200)).body).toEqual({
        menus: [],
        restaurants: [],
      });
      await http().get('/v1/search').query({ q: '초밥' }).expect(400);
    });
  });
});
