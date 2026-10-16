import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import type { Prisma, SponsoredPlace } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { cuisineOf, kakaoMapUrl, type Place } from './place-cache.service.js';
import type { Hours } from './restaurant-rules.js';

// 진행 중 광고: 취소되지 않았고 오늘(KST)이 기간 안. 입금 대기(pending) 노출 여부는 미결정이라 지금은 함께 노출한다
@Injectable()
export class SponsoredPlacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  // @db.Date 비교용 오늘(KST) 날짜
  private today(): Date {
    const kst = new Date(this.clock.now().getTime() + 9 * 60 * 60 * 1000);
    return new Date(`${kst.toISOString().slice(0, 10)}T00:00:00Z`);
  }

  activeWhere(
    extra: Prisma.SponsoredPlaceWhereInput = {},
  ): Prisma.SponsoredPlaceWhereInput {
    const today = this.today();
    return {
      canceledAt: null,
      startDate: { lte: today },
      endDate: { gte: today },
      ...extra,
    };
  }

  // 메뉴 검색에서 노출할 광고: 노출 메뉴 · 세부 카테고리 · 종류 중 하나가 맞는 것 (우선순위 순)
  forMenu(menu: {
    id: string;
    category: string;
    cuisine: string;
  }): Promise<SponsoredPlace[]> {
    return this.prisma.sponsoredPlace.findMany({
      where: this.activeWhere({
        OR: [
          { targetMenuIds: { has: menu.id } },
          { targetCategories: { hasSome: [menu.category, menu.cuisine] } },
        ],
      }),
      orderBy: { priority: 'asc' },
    });
  }

  // 식당별 영업시간 · 사진 (진행 중인 광고 · 입점 식당만 가지고 있다)
  async extrasFor(
    placeIds: string[],
  ): Promise<Map<string, { hours: Hours | null; imageUrl: string | null }>> {
    if (!placeIds.length) return new Map();
    const rows = await this.prisma.sponsoredPlace.findMany({
      where: this.activeWhere({ placeId: { in: placeIds } }),
      select: { placeId: true, hours: true, imageUrl: true },
      orderBy: { priority: 'asc' },
    });
    const map = new Map<
      string,
      { hours: Hours | null; imageUrl: string | null }
    >();
    for (const r of rows) {
      const prev = map.get(r.placeId);
      map.set(r.placeId, {
        hours: prev?.hours ?? (r.hours as unknown as Hours | null),
        imageUrl: prev?.imageUrl ?? r.imageUrl,
      });
    }
    return map;
  }

  async findPlace(placeId: string): Promise<Place | null> {
    const row = await this.prisma.sponsoredPlace.findFirst({
      where: { placeId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toPlace(row) : null;
  }

  // 목록에 보인 광고 노출 수 · 광고 클릭 수 (실패해도 응답은 그대로)
  async countImpressions(ids: string[]) {
    if (!ids.length) return;
    await this.prisma.sponsoredPlace
      .updateMany({
        where: { id: { in: ids } },
        data: { impressions: { increment: 1 } },
      })
      .catch(() => undefined);
  }

  async countClick(placeId: string) {
    await this.prisma.sponsoredPlace.updateMany({
      where: this.activeWhere({ placeId }),
      data: { clicks: { increment: 1 } },
    });
  }
}

export function toPlace(row: SponsoredPlace): Place {
  return {
    placeId: row.placeId,
    name: row.placeName,
    category: cuisineOf(row.category),
    categoryPath: row.category,
    address: row.address,
    phone: null,
    lat: row.lat,
    lng: row.lng,
    kakaoMapUrl: kakaoMapUrl(row.placeId),
  };
}
