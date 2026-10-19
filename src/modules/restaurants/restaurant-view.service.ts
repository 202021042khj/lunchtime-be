import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Place } from './place-cache.service.js';
import {
  distanceM,
  isOpenNow,
  walkMinutes,
  type Hours,
  type LatLng,
  type MenuEvidence,
} from './restaurant-rules.js';
import { SponsoredPlacesService } from './sponsored-places.service.js';

// API.md Restaurant (식당 행 · 카드 · 지도 핀 · 상세 공통)
export interface Restaurant {
  placeId: string;
  name: string;
  category: string;
  categoryPath: string;
  mainMenu: string | null;
  address: string;
  phone: string | null;
  lat: number;
  lng: number;
  distanceM: number;
  walkMinutes: number;
  rating: number | null;
  reviewCount: number;
  openNow: boolean | null;
  hours: Hours | null;
  imageUrl: string | null;
  // 사진 출처. menu(메뉴 대표 사진) · null(사진 없음)이면 이 식당의 실제 사진이 아니다 → 앱이 "예시" 표시
  imageSource: ImageSource;
  kakaoMapUrl: string;
  isFavorite: boolean;
  sponsored: boolean;
  menuEvidence: MenuEvidence | null;
}

export type ImageSource = 'review' | 'sponsored' | 'menu' | null;

export interface ViewOptions {
  // 거리 기준. 없으면 거리 0 (상세 · 찜 목록을 좌표 없이 부를 때)
  origin: LatLng | null;
  userId?: string;
  sponsoredIds?: ReadonlySet<string>;
  evidence?: ReadonlyMap<string, MenuEvidence>;
  // 식당 사진이 없을 때 쓸 사진 (메뉴로 검색했으면 그 메뉴 사진)
  fallbackImageUrl?: string | null;
}

function pickImage(
  review: string | undefined,
  sponsored: string | null | undefined,
  menu: string | null | undefined,
): { url: string | null; source: ImageSource } {
  if (review) return { url: review, source: 'review' };
  if (sponsored) return { url: sponsored, source: 'sponsored' };
  if (menu) return { url: menu, source: 'menu' };
  return { url: null, source: null };
}

// 카카오 장소에 우리 데이터(별점 · 리뷰 수 · 찜 · 광고 · 영업시간 · 사진)를 붙인다. 쿼리 4번으로 끝낸다.
// 사진: 가장 최근 리뷰의 첫 사진 → 광고 · 입점 식당 사진 → 메뉴 사진(fallbackImageUrl) → null
@Injectable()
export class RestaurantViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sponsored: SponsoredPlacesService,
    private readonly clock: Clock,
  ) {}

  async build(places: Place[], opts: ViewOptions): Promise<Restaurant[]> {
    if (!places.length) return [];
    const ids = places.map((p) => p.placeId);
    const [stats, favorites, extras, reviewPhotos] = await Promise.all([
      this.prisma.placeStats.findMany({ where: { placeId: { in: ids } } }),
      opts.userId
        ? this.prisma.favorite.findMany({
            where: { userId: opts.userId, placeId: { in: ids } },
            select: { placeId: true },
          })
        : Promise.resolve([]),
      this.sponsored.extrasFor(ids),
      this.latestReviewPhotos(ids),
    ]);
    const statsById = new Map(stats.map((s) => [s.placeId, s]));
    const favoriteIds = new Set(favorites.map((f) => f.placeId));
    const now = this.clock.now();

    return places.map((p) => {
      const s = statsById.get(p.placeId);
      const d = opts.origin ? distanceM(opts.origin, p) : 0;
      const extra = extras.get(p.placeId);
      const h = extra?.hours ?? null;
      const image = pickImage(
        reviewPhotos.get(p.placeId),
        extra?.imageUrl,
        opts.fallbackImageUrl,
      );
      return {
        placeId: p.placeId,
        name: p.name,
        category: p.category,
        categoryPath: p.categoryPath,
        mainMenu: null,
        address: p.address,
        phone: p.phone,
        lat: p.lat,
        lng: p.lng,
        distanceM: d,
        walkMinutes: opts.origin ? walkMinutes(d) : 0,
        rating:
          s && s.reviewCount > 0
            ? Math.round((s.ratingSum / s.reviewCount) * 10) / 10
            : null,
        reviewCount: s?.reviewCount ?? 0,
        openNow: h ? isOpenNow(h, now) : null,
        hours: h,
        imageUrl: image.url,
        imageSource: image.source,
        kakaoMapUrl: p.kakaoMapUrl,
        isFavorite: favoriteIds.has(p.placeId),
        sponsored: opts.sponsoredIds?.has(p.placeId) ?? false,
        menuEvidence: opts.evidence?.get(p.placeId) ?? null,
      };
    });
  }

  // 식당마다 가장 최근(삭제되지 않은) 리뷰의 첫 사진
  private async latestReviewPhotos(
    placeIds: string[],
  ): Promise<Map<string, string>> {
    const rows = await this.prisma.$queryRaw<
      { placeId: string; url: string }[]
    >`
      SELECT DISTINCT ON (r."placeId") r."placeId", p.url
      FROM "ReviewPhoto" p JOIN "Review" r ON r.id = p."reviewId"
      WHERE r."placeId" = ANY(${placeIds}) AND r."deletedAt" IS NULL AND p.url <> ''
      ORDER BY r."placeId", r."createdAt" DESC, p."sortOrder" ASC`;
    return new Map(rows.map((r) => [r.placeId, r.url]));
  }
}
