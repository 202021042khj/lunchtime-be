import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { paginate } from '../../common/cursor.js';
import { AppException } from '../../common/errors/app.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { kakaoMapUrl, type Place } from '../restaurants/place-cache.service.js';
import type { LatLng } from '../restaurants/restaurant-rules.js';
import { RestaurantViewService } from '../restaurants/restaurant-view.service.js';
import { RestaurantsService } from '../restaurants/restaurants.service.js';

export interface FavoritesQuery {
  origin: LatLng | null;
  cuisine?: string;
  cursor?: string;
  limit?: number;
}

@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restaurants: RestaurantsService,
    private readonly view: RestaurantViewService,
    private readonly clock: Clock,
  ) {}

  // PUT /me/favorites/{placeId}: 여러 번 불러도 한 번만. 식당 정보는 검색 때 기억해 둔 것을 쓴다
  async add(userId: string, placeId: string) {
    const exists = await this.prisma.favorite.findUnique({
      where: { userId_placeId: { userId, placeId } },
    });
    if (exists) return;
    const place = await this.restaurants.findPlace(placeId);
    if (!place) {
      throw new AppException(
        'NOT_FOUND',
        '식당 정보를 찾을 수 없어요. 목록에서 다시 찜해 주세요.',
      );
    }
    try {
      await this.prisma.$transaction([
        this.prisma.favorite.create({
          data: {
            userId,
            placeId,
            placeName: place.name,
            category: place.category,
            categoryPath: place.categoryPath,
            address: place.address,
            lat: place.lat,
            lng: place.lng,
            createdAt: this.clock.now(),
          },
        }),
        this.prisma.placeStats.upsert({
          where: { placeId },
          create: { placeId, favoriteCount: 1 },
          update: { favoriteCount: { increment: 1 } },
        }),
      ]);
    } catch (error) {
      // 같은 식당을 동시에 두 번 찜하면 한쪽만 저장된다
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return;
      throw error;
    }
  }

  // DELETE /me/favorites/{placeId}: 찜이 없어도 204
  async remove(userId: string, placeId: string) {
    const { count } = await this.prisma.favorite.deleteMany({
      where: { userId, placeId },
    });
    if (count > 0) {
      await this.prisma.placeStats.updateMany({
        where: { placeId, favoriteCount: { gt: 0 } },
        data: { favoriteCount: { decrement: 1 } },
      });
    }
  }

  // GET /me/favorites: 최근 찜한 순. cuisine = 음식 종류(한식 · 아시안 …), 좌표를 주면 거리 계산
  async list(userId: string, query: FavoritesQuery) {
    const rows = await this.prisma.favorite.findMany({
      where: { userId, ...(query.cuisine && { category: query.cuisine }) },
      orderBy: { createdAt: 'desc' },
    });
    const places: Place[] = rows.map((f) => ({
      placeId: f.placeId,
      name: f.placeName,
      category: f.category,
      categoryPath: f.categoryPath,
      address: f.address,
      phone: null,
      lat: f.lat,
      lng: f.lng,
      kakaoMapUrl: kakaoMapUrl(f.placeId),
    }));
    const page = paginate(places, query.cursor, query.limit);
    return {
      ...page,
      items: await this.view.build(page.items, {
        origin: query.origin,
        userId,
      }),
    };
  }
}
