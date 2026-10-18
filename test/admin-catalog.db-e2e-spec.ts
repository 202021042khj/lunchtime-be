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

// 사진은 실제 저장소(RustFS lunchtime-test 버킷)에 올린다. 카카오만 가짜
const run = Date.now() % 1000;
const O = { lat: 35.0 + run / 1000, lng: 128.0 };
const placeDoc = (id: string, name: string, northM: number): KakaoPlaceDoc => ({
  id,
  place_name: name,
  category_name: '음식점 > 한식 > 찌개,전골',
  address_name: '서울 강남구 역삼동',
  road_address_name: '서울 강남구 테헤란로',
  phone: '',
  x: String(O.lng),
  y: String(O.lat + northM / 111_000),
  place_url: '',
});
const AD_PLACE = placeDoc(`ad${run}`, '사진있는 순두부', 300);
const PLAIN_PLACE = placeDoc(`pl${run}`, '사진없는 찌개집', 200);

class FakeKakaoLocal {
  searchKeyword() {
    return Promise.resolve([
      AD_PLACE,
      { ...AD_PLACE, id: 'cafe', category_name: '카페 > 커피전문점' },
    ]);
  }
  searchRestaurants() {
    return Promise.resolve([AD_PLACE, PLAIN_PLACE]);
  }
}

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('어드민 메뉴 · 광고 · 사진 (DB e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token = '';

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
      where: { loginId: 'catalog' },
      create: {
        loginId: 'catalog',
        passwordHash: await hashPassword('admin1234'),
        otpSecret: 'JBSWY3DPEHPK3PXP',
        name: '메뉴담당',
      },
      update: {},
    });
    const login = await request(app.getHttpServer())
      .post('/v1/admin/auth/login')
      .send({ loginId: 'catalog', password: 'admin1234', otp: '123456' })
      .expect(200);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const as = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
  const upload = (buf: Buffer, purpose = 'menu', name = 'food.png') =>
    as(http().post('/v1/admin/uploads/images'))
      .field('purpose', purpose)
      .attach('file', buf, name);

  const menuBody = (over: Record<string, unknown> = {}) => ({
    name: '테스트 순두부찌개',
    cuisine: '한식',
    category: '찌개류',
    imageUrl: null,
    ingredients: ['두부', '바지락'],
    tastes: ['매운맛'],
    spiceLevel: 3,
    weathers: ['cold'],
    kakaoKeyword: '순두부찌개',
    kakaoCategory: '찌개,전골',
    visible: true,
    ...over,
  });

  describe('사진 올리기', () => {
    it('PNG → 저장소 공개 주소, 누구나 내려받을 수 있다', async () => {
      const res = await upload(PNG).expect(201);
      expect(res.body.imageUrl).toMatch(
        /^http:\/\/localhost:9000\/lunchtime-test\/menus\/[a-f0-9]{24}\.png$/,
      );
      const img = await fetch(res.body.imageUrl);
      expect(img.status).toBe(200);
      expect(img.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);
    });

    it('이름만 .png인 HTML · 5MB 넘는 파일 · 파일 없음 → 400', async () => {
      const html = await upload(
        Buffer.from('<html><script>alert(1)</script></html>'),
        'menu',
        'x.png',
      ).expect(400);
      expect(html.body.error.fields.file).toMatch(/JPG · PNG · WEBP/);
      const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
      expect((await upload(big).expect(400)).body.error.fields.file).toMatch(
        /5MB/,
      );
      await as(http().post('/v1/admin/uploads/images'))
        .field('purpose', 'menu')
        .expect(400);
      await upload(PNG, 'avatar').expect(400);
    });

    it('사용자 토큰 · 비로그인 → 401', async () => {
      await http()
        .post('/v1/admin/uploads/images')
        .field('purpose', 'menu')
        .attach('file', PNG, 'a.png')
        .expect(401);
    });
  });

  describe('메뉴 관리', () => {
    let menuId = '';
    let imageUrl = '';

    it('사진과 함께 추가 → 목록 · 개수, 같은 이름은 409', async () => {
      imageUrl = (await upload(PNG).expect(201)).body.imageUrl;
      const created = await as(http().post('/v1/admin/menus'))
        .send(menuBody({ imageUrl, ingredients: [' 두부 ', '두부', '바지락'] }))
        .expect(201);
      menuId = created.body.id;
      expect(created.body).toMatchObject({
        imageUrl,
        recommendCount7d: 0,
        ingredients: ['두부', '바지락'],
      });
      const dup = await as(http().post('/v1/admin/menus'))
        .send(menuBody())
        .expect(409);
      expect(dup.body.error.code).toBe('CONFLICT');

      const list = await as(http().get('/v1/admin/menus')).expect(200);
      expect(list.body).toMatchObject({
        total: 1,
        page: 1,
        size: 20,
        counts: { all: 1, hidden: 0 },
      });
    });

    it('우리 저장소가 아닌 사진 주소 · 지어낸 주소 → 400', async () => {
      const external = await as(http().patch(`/v1/admin/menus/${menuId}`))
        .send({ imageUrl: 'https://evil.example/a.png' })
        .expect(400);
      expect(external.body.error.fields).toHaveProperty('imageUrl');
      await as(http().patch(`/v1/admin/menus/${menuId}`))
        .send({
          imageUrl:
            'http://localhost:9000/lunchtime-test/menus/000000000000000000000000.png',
        })
        .expect(400);
    });

    it('규칙: 종류 · 재료 · 맵기 · 날씨 → 400 + fields', async () => {
      const cases: [Record<string, unknown>, string][] = [
        [{ name: '새메뉴1', cuisine: '외계식' }, 'cuisine'],
        [{ name: '새메뉴2', ingredients: [] }, 'ingredients'],
        [{ name: '새메뉴3', spiceLevel: 5 }, 'spiceLevel'],
        [{ name: '새메뉴4', weathers: ['foggy'] }, 'weathers'],
        [{ name: '새메뉴5', kakaoKeyword: ' ' }, 'kakaoKeyword'],
      ];
      for (const [over, field] of cases) {
        const res = await as(http().post('/v1/admin/menus'))
          .send(menuBody(over))
          .expect(400);
        expect(res.body.error.fields).toHaveProperty(field);
      }
    });

    it('숨김 · 필터 · 7일 추천 수 정렬', async () => {
      await as(http().patch(`/v1/admin/menus/${menuId}`))
        .send({ visible: false })
        .expect(200);
      const other = await as(http().post('/v1/admin/menus'))
        .send(
          menuBody({
            name: '테스트 초밥',
            cuisine: '일식',
            ingredients: ['생선'],
            kakaoKeyword: '초밥',
          }),
        )
        .expect(201);
      await prisma.recommendationLog.createMany({
        data: [{ menuId: other.body.id }, { menuId: other.body.id }],
      });

      const all = await as(http().get('/v1/admin/menus')).expect(200);
      // 노출 메뉴 먼저
      expect(all.body.items.map((m: { name: string }) => m.name)).toEqual([
        '테스트 초밥',
        '테스트 순두부찌개',
      ]);
      expect(all.body.items[0].recommendCount7d).toBe(2);
      expect(all.body.counts).toEqual({ all: 2, hidden: 1 });
      expect(
        (
          await as(
            http().get('/v1/admin/menus').query({ visible: 'false' }),
          ).expect(200)
        ).body.total,
      ).toBe(1);
      expect(
        (
          await as(
            http().get('/v1/admin/menus').query({ cuisine: '일식' }),
          ).expect(200)
        ).body.items[0].name,
      ).toBe('테스트 초밥');
      expect(
        (
          await as(http().get('/v1/admin/menus').query({ q: '바지락' })).expect(
            200,
          )
        ).body.total,
      ).toBe(1);
      const paged = await as(
        http().get('/v1/admin/menus').query({ size: 1, page: 9 }),
      ).expect(200);
      expect(paged.body).toMatchObject({ page: 2, size: 1, total: 2 });
    });

    it('CSV 가져오기: 새로 · 덮어쓰기(사진 유지) · 문제 줄만 건너뜀', async () => {
      const csv = [
        '﻿이름,종류,카테고리,재료,맛,맵기,날씨,카카오 키워드,카카오 카테고리,노출',
        '테스트 순두부찌개,한식,찌개류,두부|바지락|계란,매운맛|국물,2,쌀쌀함|비,순두부찌개,"찌개,전골",Y',
        '테스트 칼국수,한식,면류,밀가루면|바지락,국물,0,상관없음,칼국수,국수,N',
        '이상한메뉴,외계식,?,재료,맛,1,,키워드,카테고리,Y',
        '맵기빠짐,한식,찌개류,두부,,,,두부,찌개,Y',
      ].join('\n');
      const res = await as(http().post('/v1/admin/menus/import'))
        .attach('file', Buffer.from(csv), 'menus.csv')
        .expect(200);
      expect(res.body).toMatchObject({ created: 1, updated: 1 });
      expect(res.body.failed.map((f: { line: number }) => f.line)).toEqual([
        4, 5,
      ]);
      const sundubu = await prisma.menu.findUniqueOrThrow({
        where: { name: '테스트 순두부찌개' },
      });
      expect(sundubu).toMatchObject({
        spiceLevel: 2,
        weathers: ['cold', 'rain'],
        imageUrl,
      });
      const kal = await prisma.menu.findUniqueOrThrow({
        where: { name: '테스트 칼국수' },
      });
      expect(kal).toMatchObject({ visible: false, weathers: [] });
      await as(http().post('/v1/admin/menus/import'))
        .attach('file', Buffer.from('name,cuisine\n'), 'x.csv')
        .expect(400);
    });

    it('재료 사전: 메뉴 재료 포함, 추가', async () => {
      const added = await as(http().post('/v1/admin/ingredients'))
        .send({ name: '샤프란' })
        .expect(200);
      expect(added.body.items).toEqual(
        expect.arrayContaining(['샤프란', '바지락', '계란']),
      );
    });
  });

  describe('광고 식당 고정', () => {
    const today = new Date(Date.now() + 9 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const shift = (days: number) =>
      new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000)
        .toISOString()
        .slice(0, 10);
    let menuId = '';
    let adId = '';
    let adImage = '';
    const body = (over: Record<string, unknown> = {}) => ({
      place: {
        placeId: AD_PLACE.id,
        name: AD_PLACE.place_name,
        address: '서울 강남구 테헤란로',
        lat: Number(AD_PLACE.y),
        lng: Number(AD_PLACE.x),
        category: AD_PLACE.category_name,
      },
      targetMenuIds: [menuId],
      targetCategories: [],
      radiusM: 1000,
      startDate: shift(-1),
      endDate: shift(10),
      hours: {
        open: '11:00',
        close: '21:00',
        break: ['15:00', '16:30'],
        closedDays: ['sun'],
      },
      priority: 1,
      feeKrw: 300000,
      paymentStatus: 'paid',
      imageUrl: adImage,
      ...over,
    });

    beforeAll(async () => {
      menuId = (
        await prisma.menu.findUniqueOrThrow({ where: { name: '테스트 초밥' } })
      ).id;
      adImage = (await upload(PNG, 'sponsored').expect(201)).body.imageUrl;
      expect(adImage).toContain('/sponsored/');
    });

    it('장소 검색: 음식점만', async () => {
      const res = await as(
        http().get('/v1/admin/places/search').query({ q: '순두부' }),
      ).expect(200);
      expect(res.body.items).toEqual([
        expect.objectContaining({
          placeId: AD_PLACE.id,
          name: '사진있는 순두부',
          category: AD_PLACE.category_name,
        }),
      ]);
    });

    it('등록 (사진 포함) → 진행 중, 규칙 위반 400', async () => {
      const created = await as(http().post('/v1/admin/sponsored'))
        .send(body())
        .expect(201);
      adId = created.body.id;
      expect(created.body).toMatchObject({
        status: 'active',
        canceled: false,
        imageUrl: adImage,
        targetMenuNames: ['테스트 초밥'],
        startDate: shift(-1),
      });
      const cases: [Record<string, unknown>, string][] = [
        [{ radiusM: 700 }, 'radiusM'],
        [{ endDate: shift(-5) }, 'endDate'],
        [{ priority: 100 }, 'priority'],
        [{ targetMenuIds: [], targetCategories: [] }, 'targetMenuIds'],
        [
          {
            hours: {
              open: '11:00',
              close: '21:00',
              break: ['10:00', '12:00'],
              closedDays: [],
            },
          },
          'hours',
        ],
        [{ targetMenuIds: ['nope'] }, 'targetMenuIds'],
        [{ imageUrl: 'https://evil.example/x.png' }, 'imageUrl'],
      ];
      for (const [over, field] of cases) {
        const res = await as(http().post('/v1/admin/sponsored'))
          .send(body(over))
          .expect(400);
        expect(res.body.error.fields).toHaveProperty(field);
      }
    });

    it('식당 목록에 광고 사진 · 메뉴 사진이 채워진다', async () => {
      const menuImage = (await upload(PNG).expect(201)).body.imageUrl;
      await as(http().patch(`/v1/admin/menus/${menuId}`))
        .send({ imageUrl: menuImage })
        .expect(200);
      const res = await http()
        .get('/v1/restaurants')
        .query({ lat: O.lat, lng: O.lng, menuId })
        .expect(200);
      const byName = Object.fromEntries(
        res.body.items.map((r: { name: string; imageUrl: string }) => [
          r.name,
          r.imageUrl,
        ]),
      );
      expect(byName['사진있는 순두부']).toBe(adImage);
      expect(byName['사진없는 찌개집']).toBe(menuImage);
      // 자유 검색어에는 메뉴 사진을 쓰지 않는다
      const free = await http()
        .get('/v1/restaurants')
        .query({ lat: O.lat, lng: O.lng, q: '찌개' })
        .expect(200);
      expect(
        free.body.items.find(
          (r: { name: string }) => r.name === '사진없는 찌개집',
        ).imageUrl,
      ).toBeNull();
    });

    it('목록 · 요약, 수정, 취소 → 종료(수정 409), 재등록 → 새 광고', async () => {
      await as(http().post('/v1/admin/sponsored'))
        .send(
          body({ startDate: shift(3), paymentStatus: 'pending', priority: 2 }),
        )
        .expect(201);
      const list = await as(http().get('/v1/admin/sponsored')).expect(200);
      expect(list.body.items.map((s: { status: string }) => s.status)).toEqual([
        'active',
        'scheduled',
      ]);
      const summary = await as(
        http().get('/v1/admin/sponsored/summary'),
      ).expect(200);
      expect(summary.body).toMatchObject({
        active: 1,
        monthRevenueKrw: 300000,
        pendingPayment: 1,
      });

      const patched = await as(http().patch(`/v1/admin/sponsored/${adId}`))
        .send({ priority: 5, imageUrl: null })
        .expect(200);
      expect(patched.body).toMatchObject({ priority: 5, imageUrl: null });

      await as(http().delete(`/v1/admin/sponsored/${adId}`)).expect(204);
      await as(http().delete(`/v1/admin/sponsored/${adId}`)).expect(409);
      await as(http().patch(`/v1/admin/sponsored/${adId}`))
        .send({ priority: 3 })
        .expect(409);
      const ended = await as(
        http().get('/v1/admin/sponsored').query({ status: 'ended' }),
      ).expect(200);
      expect(ended.body.items[0]).toMatchObject({
        id: adId,
        canceled: true,
        status: 'ended',
      });

      const { place: _place, ...renewBody } = body({
        startDate: shift(0),
        endDate: shift(30),
      });
      void _place;
      const renewed = await as(http().post(`/v1/admin/sponsored/${adId}/renew`))
        .send(renewBody)
        .expect(201);
      expect(renewed.body).toMatchObject({ status: 'active', canceled: false });
      expect(renewed.body.place.placeId).toBe(AD_PLACE.id);
      expect(renewed.body.id).not.toBe(adId);
      // 진행 중인 광고는 재등록할 수 없다
      await as(http().post(`/v1/admin/sponsored/${renewed.body.id}/renew`))
        .send(renewBody)
        .expect(409);
    });

    it('변경은 감사 로그에 남는다', async () => {
      const actions = (
        await prisma.adminAuditLog.findMany({ select: { action: true } })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'image.upload',
          'menu.create',
          'menu.update',
          'menu.import',
          'sponsored.create',
          'sponsored.update',
          'sponsored.cancel',
          'sponsored.renew',
        ]),
      );
    });
  });
});
