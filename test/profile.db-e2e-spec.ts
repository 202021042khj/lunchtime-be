import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AppException } from '../src/common/errors/app.exception.js';
import { KakaoLocalClient } from '../src/integrations/kakao/kakao-local.client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// 카카오 로컬 대신. 호출 수를 세어 캐시가 동작하는지 본다
class FakeKakaoLocal {
  calls = 0;
  searchAddress(query: string) {
    this.calls++;
    return Promise.resolve([
      {
        address_name: `서울 강남구 ${query}`,
        x: '127.0331',
        y: '37.4954',
        address: { region_3depth_name: query, region_3depth_h_name: '' },
        road_address: null,
      },
    ]);
  }
  searchKeyword(query: string) {
    this.calls++;
    return Promise.resolve([
      {
        id: '1',
        place_name: `${query}역 2호선`,
        category_name: '교통',
        address_name: '서울 강남구 역삼동 804',
        road_address_name: '서울 강남구 강남대로 지하 396',
        phone: '',
        x: '127.0365',
        y: '37.5007',
        place_url: '',
      },
    ]);
  }
  coordToRegion(lat: number) {
    this.calls++;
    if (lat < 34)
      return Promise.reject(new AppException('OUT_OF_SERVICE_AREA'));
    return Promise.resolve([
      {
        region_type: 'B',
        address_name: '서울특별시 강남구 역삼동',
        region_3depth_name: '역삼동',
      },
      {
        region_type: 'H',
        address_name: '서울특별시 강남구 역삼1동',
        region_3depth_name: '역삼1동',
      },
    ]);
  }
}

describe('취향 · 위치 (DB e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const kakao = new FakeKakaoLocal();
  // Redis는 개발 서버와 같이 쓰므로 실행마다 다른 검색어 · 좌표로 캐시 키가 겹치지 않게 한다
  const run = Date.now() % 100000;
  let token = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KakaoLocalClient)
      .useValue(kakao)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    // 메뉴 · 재료 사전 (테스트 DB는 시작할 때 비운다)
    await prisma.allergy.createMany({
      data: [
        {
          name: '갑각류 (새우·게)',
          ingredients: ['새우', '게', '꽃게'],
          sortOrder: 0,
        },
        { name: '땅콩', ingredients: ['땅콩'], sortOrder: 1 },
      ],
      skipDuplicates: true,
    });
    await prisma.ingredient.createMany({
      data: [
        { name: '오이', inOptions: true, sortOrder: 0 },
        { name: '고수', inOptions: true, sortOrder: 1 },
        { name: '고추', inOptions: false, sortOrder: 2 },
        { name: '미나리', inOptions: false, sortOrder: 3 },
      ],
      skipDuplicates: true,
    });
    const menu = (
      id: string,
      name: string,
      cuisine: string,
      ingredients: string[],
      spiceLevel: number,
    ) => ({
      id,
      name,
      cuisine,
      category: cuisine,
      ingredients,
      tastes: [],
      spiceLevel,
      weathers: [],
      kakaoKeyword: name,
      kakaoCategory: cuisine,
    });
    await prisma.menu.createMany({
      data: [
        menu('pm_1', '얼큰 순두부찌개', '한식', ['두부', '바지락'], 3),
        menu('pm_2', '쌀국수', '아시안', ['쌀국수면', '고수'], 1),
        menu('pm_3', '짬뽕', '중식', ['밀가루면', '새우'], 3),
        menu('pm_4', '물냉면', '한식', ['메밀면', '오이'], 0),
        menu('pm_5', '초밥', '일식', ['밥', '생선'], 0),
        { ...menu('pm_6', '숨긴메뉴', '한식', [], 0), visible: false },
      ],
      skipDuplicates: true,
    });

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ provider: 'kakao', providerToken: `dev:profile${run}` })
      .expect(200);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  describe('취향', () => {
    it('선택지: 재료(취향 화면용만) · 알레르기 · 음식 종류', async () => {
      const res = await http().get('/v1/preferences/options').expect(200);
      expect(res.body.ingredients).toEqual(['오이', '고수']);
      expect(res.body.allergies).toEqual(['갑각류 (새우·게)', '땅콩']);
      expect(res.body.cuisines).toContain('샐러드·건강식');
    });

    it('재료 검색: 사전 전체에서, 빈 검색어는 빈 목록', async () => {
      expect(
        (await http().get('/v1/ingredients').query({ q: '고' }).expect(200))
          .body.items,
      ).toEqual(['고수', '고추']);
      expect(
        (await http().get('/v1/ingredients').expect(200)).body.items,
      ).toEqual([]);
    });

    it('처음엔 빈 취향 → 저장(온보딩 완료) → 다시 읽기 · /me에도 반영', async () => {
      expect(
        (await auth(http().get('/v1/me/preferences')).expect(200)).body,
      ).toEqual({
        dislikedIngredients: [],
        allergies: [],
        spiceLevel: null,
        favoriteCuisines: [],
      });
      const saved = await auth(http().put('/v1/me/preferences'))
        .send({
          dislikedIngredients: [' 오이 ', '고수', '오이'],
          allergies: ['갑각류 (새우·게)'],
          spiceLevel: 3,
          favoriteCuisines: ['한식', '일식'],
          completeOnboarding: true,
        })
        .expect(200);
      // 공백 · 중복 정리
      expect(saved.body.dislikedIngredients).toEqual(['오이', '고수']);
      expect(
        (await auth(http().get('/v1/me/preferences')).expect(200)).body
          .spiceLevel,
      ).toBe(3);
      expect(
        (await auth(http().get('/v1/me')).expect(200)).body.onboardingCompleted,
      ).toBe(true);
    });

    it('맵기 건너뛰기(null), completeOnboarding 없이 저장해도 온보딩 상태는 그대로', async () => {
      await auth(http().put('/v1/me/preferences'))
        .send({
          dislikedIngredients: [],
          allergies: [],
          spiceLevel: null,
          favoriteCuisines: [],
        })
        .expect(200);
      expect(
        (await auth(http().get('/v1/me/preferences')).expect(200)).body
          .spiceLevel,
      ).toBeNull();
      expect(
        (await auth(http().get('/v1/me')).expect(200)).body.onboardingCompleted,
      ).toBe(true);
    });

    it('선택지에 없는 알레르기 · 음식 종류, 맵기 5 → 400 + fields', async () => {
      const base = {
        dislikedIngredients: [],
        allergies: [],
        spiceLevel: null,
        favoriteCuisines: [],
      };
      const allergy = await auth(http().put('/v1/me/preferences'))
        .send({ ...base, allergies: ['우주먼지'] })
        .expect(400);
      expect(allergy.body.error.fields).toHaveProperty('allergies');
      const cuisine = await auth(http().put('/v1/me/preferences'))
        .send({ ...base, favoriteCuisines: ['외계식'] })
        .expect(400);
      expect(cuisine.body.error.fields).toHaveProperty('favoriteCuisines');
      const spice = await auth(http().put('/v1/me/preferences'))
        .send({ ...base, spiceLevel: 5 })
        .expect(400);
      expect(spice.body.error.fields).toHaveProperty('spiceLevel');
    });

    it('로그인 없이 /me/preferences → 401', async () => {
      await http().get('/v1/me/preferences').expect(401);
    });

    it('미리보기(공개): 제외 이유 · 매칭 % 순, 숨긴 메뉴 제외', async () => {
      const res = await http()
        .post('/v1/preferences/preview')
        .send({
          dislikedIngredients: ['오이', '고수'],
          allergies: ['갑각류 (새우·게)'],
          spiceLevel: 3,
          favoriteCuisines: ['한식'],
        })
        .expect(200);
      const excluded = Object.fromEntries(
        res.body.excluded.map((e: { menu: { id: string }; reason: string }) => [
          e.menu.id,
          e.reason,
        ]),
      );
      expect(excluded).toMatchObject({
        pm_2: '고수',
        pm_3: '갑각류 알레르기',
        pm_4: '오이',
      });
      expect(res.body.recommended[0].menu.id).toBe('pm_1'); // 한식 + 맵기 같음
      const percents = res.body.recommended.map(
        (r: { matchPercent: number }) => r.matchPercent,
      );
      expect(percents).toEqual(
        [...percents].sort((a: number, b: number) => b - a),
      );
      const ids = [...res.body.recommended, ...res.body.excluded].map(
        (r: { menu: { id: string } }) => r.menu.id,
      );
      expect(ids).not.toContain('pm_6');
    });
  });

  describe('위치', () => {
    it('저장 → 목록 → 삭제, 남의 위치 · 없는 위치 삭제는 404', async () => {
      const added = await auth(http().post('/v1/me/locations'))
        .send({
          label: '회사',
          name: '역삼동',
          address: '서울 강남구 테헤란로 123',
          lat: 37.5006,
          lng: 127.0365,
        })
        .expect(201);
      expect(added.body).toMatchObject({
        label: '회사',
        name: '역삼동',
        lat: 37.5006,
      });
      const list = await auth(http().get('/v1/me/locations')).expect(200);
      expect(list.body.items.map((l: { id: string }) => l.id)).toContain(
        added.body.id,
      );

      const other = await http()
        .post('/v1/auth/login')
        .send({ provider: 'kakao', providerToken: `dev:other${run}` })
        .expect(200);
      await http()
        .delete(`/v1/me/locations/${added.body.id}`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(404);
      await auth(http().delete(`/v1/me/locations/${added.body.id}`)).expect(
        204,
      );
      await auth(http().delete(`/v1/me/locations/${added.body.id}`)).expect(
        404,
      );
    });

    it('10개까지 저장, 11번째는 409', async () => {
      const body = {
        label: '집',
        name: '망원동',
        address: '서울 마포구',
        lat: 37.55,
        lng: 126.9,
      };
      for (let i = 0; i < 10; i++)
        await auth(http().post('/v1/me/locations')).send(body).expect(201);
      const res = await auth(http().post('/v1/me/locations'))
        .send(body)
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('좌표 범위 밖 · 빠진 값 → 400', async () => {
      await auth(http().post('/v1/me/locations'))
        .send({
          label: '회사',
          name: '역삼동',
          address: '',
          lat: 137,
          lng: 127,
        })
        .expect(400);
    });

    it('검색(공개): 주소(동네) 먼저 · 장소 다음, 같은 검색어는 캐시', async () => {
      const q = `역삼${run}`;
      const before = kakao.calls;
      const res = await http()
        .get('/v1/locations/search')
        .query({ q })
        .expect(200);
      expect(res.body.items[0]).toEqual({
        name: q,
        address: `서울 강남구 ${q}`,
        lat: 37.4954,
        lng: 127.0331,
      });
      expect(res.body.items[1]).toMatchObject({
        name: `${q}역 2호선`,
        address: '서울 강남구 강남대로 지하 396',
      });
      expect(kakao.calls - before).toBe(2);

      await http().get('/v1/locations/search').query({ q }).expect(200);
      expect(kakao.calls - before).toBe(2);
      expect(
        (await http().get('/v1/locations/search').query({ q: ' ' }).expect(200))
          .body.items,
      ).toEqual([]);
    });

    it('좌표 → 동네(법정동), 국내 밖 → 422, 좌표 없음 → 400', async () => {
      const lat = 37.5 + run / 1e9;
      const res = await http()
        .get('/v1/locations/reverse')
        .query({ lat, lng: 127.0365 })
        .expect(200);
      expect(res.body).toEqual({ name: '역삼동', lat, lng: 127.0365 });
      const out = await http()
        .get('/v1/locations/reverse')
        .query({ lat: 33.0 + run / 1e9, lng: 139.7 })
        .expect(422);
      expect(out.body.error.code).toBe('OUT_OF_SERVICE_AREA');
      await http().get('/v1/locations/reverse').expect(400);
    });
  });
});
