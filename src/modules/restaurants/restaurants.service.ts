import { Injectable } from '@nestjs/common';
import { paginate } from '../../common/cursor.js';
import { AppException } from '../../common/errors/app.exception.js';
import { Prisma, type Menu } from '../../generated/prisma/client.js';
import { RedisService } from '../../integrations/cache/redis.service.js';
import { KakaoLocalClient } from '../../integrations/kakao/kakao-local.client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REVIEW_INCLUDE, toReview } from '../reviews/review-view.js';
import {
  PlaceCacheService,
  placeFromKakao,
  type Place,
} from './place-cache.service.js';
import {
  CATEGORY_ONLY_LIMIT,
  distanceM,
  evidenceTier,
  MENU_REPORT_HIDE_THRESHOLD,
  menuEvidence,
  type LatLng,
  type MenuEvidence,
} from './restaurant-rules.js';
import {
  RestaurantViewService,
  type Restaurant,
} from './restaurant-view.service.js';
import type { RestaurantQueryDto } from './restaurants.dto.js';
import { SponsoredPlacesService, toPlace } from './sponsored-places.service.js';

const DEFAULT_RADIUS_M = 1000;
const MAX_RADIUS_M = 3000;
// API.md: 카카오 결과는 (키워드, 격자 좌표) 단위로 10분 캐시. 좌표는 약 100m로 묶는다
const KAKAO_TTL_SEC = 10 * 60;
const cell = (o: LatLng) => `${o.lat.toFixed(3)},${o.lng.toFixed(3)}`;

export interface SearchOptions {
  origin: LatLng;
  menu: Menu | null;
  q?: string;
  radiusM?: number;
  minRating?: number;
  sort?: 'distance' | 'reviews';
  userId?: string;
}

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kakao: KakaoLocalClient,
    private readonly cache: RedisService,
    private readonly places: PlaceCacheService,
    private readonly view: RestaurantViewService,
    private readonly sponsored: SponsoredPlacesService,
  ) {}

  // GET /restaurants
  async list(query: RestaurantQueryDto, userId: string | undefined) {
    if (query.lat === undefined || query.lng === undefined) {
      throw new AppException('LOCATION_REQUIRED');
    }
    const menu = query.menuId ? await this.findMenu(query.menuId) : null;
    const all = await this.search({
      origin: { lat: query.lat, lng: query.lng },
      menu,
      q: query.q,
      radiusM: query.radiusM,
      minRating: query.minRating,
      sort: query.sort,
      userId,
    });
    const page = paginate(all, query.cursor, query.limit);
    await this.sponsored.countImpressions(
      await this.sponsoredIdsOf(
        page.items.filter((r) => r.sponsored).map((r) => r.placeId),
      ),
    );
    return {
      ...page,
      total: all.length,
      menu: menu
        ? { id: menu.id, name: menu.name, keyword: menu.kakaoKeyword }
        : null,
    };
  }

  async findMenu(menuId: string): Promise<Menu> {
    const menu = await this.prisma.menu.findUnique({ where: { id: menuId } });
    if (!menu || !menu.visible)
      throw new AppException('NOT_FOUND', '메뉴를 찾을 수 없어요.');
    return menu;
  }

  // 근처 식당 전체(최대 45 + 광고). 추천 · 통합 검색(2단계-3b)도 이걸 쓴다
  async search(opts: SearchOptions): Promise<Restaurant[]> {
    const radius = Math.min(opts.radiusM ?? DEFAULT_RADIUS_M, MAX_RADIUS_M);
    const keyword = opts.menu?.kakaoKeyword ?? opts.q?.trim() ?? '';
    const keywordPlaces = await this.kakaoSearch(keyword, opts.origin, radius);

    let places = keywordPlaces;
    const found = new Map<string, 'keyword' | 'category'>(
      keywordPlaces.map((p) => [p.placeId, 'keyword']),
    );
    const sponsoredIds = new Set<string>();
    let evidence: Map<string, MenuEvidence> | undefined;

    if (opts.menu) {
      const menu = opts.menu;
      // 카테고리만 맞는 식당 (키워드 검색에 없던 곳)
      const categoryPlaces = (
        await this.kakaoSearch('', opts.origin, radius)
      ).filter(
        (p) =>
          !found.has(p.placeId) && p.categoryPath.includes(menu.kakaoCategory),
      );
      for (const p of categoryPlaces) found.set(p.placeId, 'category');

      // 광고: 노출 조건이 맞고 광고 반경 안 (자유 검색어 검색에는 붙이지 않음)
      const ads = (await this.sponsored.forMenu(menu)).filter(
        (ad) => distanceM(opts.origin, ad) <= ad.radiusM,
      );
      for (const ad of ads) sponsoredIds.add(ad.placeId);
      const adPlaces = ads
        .map(toPlace)
        .filter(
          (p, i, arr) => arr.findIndex((x) => x.placeId === p.placeId) === i,
        );

      places = [
        ...adPlaces,
        ...[...keywordPlaces, ...categoryPlaces].filter(
          (p) => !sponsoredIds.has(p.placeId),
        ),
      ];
      evidence = await this.evidenceFor(places, menu, found);
    }

    let list = await this.view.build(places, {
      origin: opts.origin,
      userId: opts.userId,
      sponsoredIds,
      evidence,
      fallbackImageUrl: opts.menu?.imageUrl,
    });
    // 반경 밖은 뺀다 (광고는 광고 반경으로 이미 걸렀다). 필터에 걸리면 광고라도 빠진다
    list = list
      .filter((r) => r.sponsored || r.distanceM <= radius)
      .filter(
        (r) =>
          opts.minRating === undefined || (r.rating ?? 0) >= opts.minRating,
      );
    if (opts.menu) list = list.filter((r) => r.sponsored || r.menuEvidence);
    return this.sort(list, opts.sort ?? 'distance', opts.menu);
  }

  // GET /restaurants/{placeId}: 기억해 둔 카카오 정보 → 찜해 둔 정보 → 광고 정보 순으로 찾는다
  async detail(
    placeId: string,
    origin: LatLng | null,
    userId: string | undefined,
  ) {
    const place = await this.findPlace(placeId, userId);
    if (!place) throw new AppException('NOT_FOUND', '식당을 찾을 수 없어요.');
    const [restaurant] = await this.view.build([place], { origin, userId });
    const [recent, counts] = await Promise.all([
      this.prisma.review.findMany({
        where: { placeId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 2,
        include: REVIEW_INCLUDE,
      }),
      this.prisma.review.groupBy({
        by: ['rating'],
        where: { placeId, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const ratingSummary: Record<1 | 2 | 3 | 4 | 5, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    for (const c of counts)
      ratingSummary[c.rating as 1 | 2 | 3 | 4 | 5] = c._count._all;
    return {
      ...restaurant,
      recentReviews: recent.map((r) => toReview(r, userId)),
      ratingSummary,
    };
  }

  async findPlace(placeId: string, userId?: string): Promise<Place | null> {
    const cached = await this.places.get(placeId);
    if (cached) return cached;
    const favorite = await this.prisma.favorite.findFirst({
      where: { placeId, ...(userId && { userId }) },
      orderBy: { createdAt: 'desc' },
    });
    if (favorite) {
      return {
        placeId,
        name: favorite.placeName,
        category: favorite.category,
        categoryPath: favorite.categoryPath,
        address: favorite.address,
        phone: null,
        lat: favorite.lat,
        lng: favorite.lng,
        kakaoMapUrl: `https://place.map.kakao.com/${placeId}`,
      };
    }
    return this.sponsored.findPlace(placeId);
  }

  // POST /restaurants/{placeId}/click: 광고 식당 클릭 집계
  async click(placeId: string) {
    await this.sponsored.countClick(placeId);
  }

  // POST /restaurants/{placeId}/menu-reports: "이 메뉴 안 팔아요". 같은 사용자 · 식당 · 메뉴는 한 번
  async reportMenu(userId: string, placeId: string, menuId: string) {
    await this.findMenu(menuId);
    try {
      await this.prisma.$transaction([
        this.prisma.menuReport.create({ data: { userId, placeId, menuId } }),
        this.prisma.placeMenuEvidence.upsert({
          where: { placeId_menuId: { placeId, menuId } },
          create: { placeId, menuId, reportCount: 1 },
          update: { reportCount: { increment: 1 } },
        }),
      ]);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppException('ALREADY_REPORTED_MENU');
      }
      throw error;
    }
  }

  // ---------- 내부 ----------

  // 키워드가 없으면 카테고리(음식점 전체) 검색. 결과는 기억해 두고(상세 · 찜) 10분 캐시
  private async kakaoSearch(
    keyword: string,
    origin: LatLng,
    radius: number,
  ): Promise<Place[]> {
    const places = await this.cache.cached(
      `rest:${keyword || '*'}:${cell(origin)}:${radius}`,
      KAKAO_TTL_SEC,
      async () =>
        (
          await this.kakao.searchRestaurants({
            keyword: keyword || undefined,
            lat: origin.lat,
            lng: origin.lng,
            radiusM: radius,
          })
        ).map(placeFromKakao),
    );
    await this.places.remember(places);
    return places;
  }

  // 리뷰 · 사장님 근거(PlaceMenuEvidence) + 이름 · 키워드 · 카테고리 추정.
  // 제보가 3건 이상 쌓였고 확인된 근거가 없는 식당은 뺀다(evidence에 넣지 않음)
  private async evidenceFor(
    places: Place[],
    menu: Menu,
    found: Map<string, 'keyword' | 'category'>,
  ): Promise<Map<string, MenuEvidence>> {
    const rows = await this.prisma.placeMenuEvidence.findMany({
      where: { menuId: menu.id, placeId: { in: places.map((p) => p.placeId) } },
    });
    const stored = new Map(rows.map((r) => [r.placeId, r]));
    const map = new Map<string, MenuEvidence>();
    for (const p of places) {
      const s = stored.get(p.placeId);
      const e = menuEvidence(p, menu, found.get(p.placeId) ?? 'category', s);
      if (!e.verified && (s?.reportCount ?? 0) >= MENU_REPORT_HIDE_THRESHOLD)
        continue;
      map.set(p.placeId, e);
    }
    return map;
  }

  // 메뉴 검색: 근거 단계 → 정렬 기준, 카테고리만 맞는 곳은 5곳까지. 그 밖은 광고 → 정렬 기준
  private sort(
    list: Restaurant[],
    sort: 'distance' | 'reviews',
    menu: Menu | null,
  ): Restaurant[] {
    const bySort = (a: Restaurant, b: Restaurant) =>
      sort === 'reviews'
        ? b.reviewCount - a.reviewCount || a.distanceM - b.distanceM
        : a.distanceM - b.distanceM;
    if (!menu) {
      return [...list].sort(
        (a, b) => Number(b.sponsored) - Number(a.sponsored) || bySort(a, b),
      );
    }
    const sorted = [...list].sort(
      (a, b) => evidenceTier(a, menu) - evidenceTier(b, menu) || bySort(a, b),
    );
    let categoryOnly = 0;
    return sorted.filter(
      (r) =>
        evidenceTier(r, menu) !== 5 || ++categoryOnly <= CATEGORY_ONLY_LIMIT,
    );
  }

  private async sponsoredIdsOf(placeIds: string[]): Promise<string[]> {
    if (!placeIds.length) return [];
    const rows = await this.prisma.sponsoredPlace.findMany({
      where: this.sponsored.activeWhere({ placeId: { in: placeIds } }),
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
