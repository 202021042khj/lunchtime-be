import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { AppException } from '../../common/errors/app.exception.js';
import type { Menu } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LocationsService } from '../locations/locations.service.js';
import { PreferencesService } from '../preferences/preferences.service.js';
import {
  EMPTY_PREFERENCES,
  exclusionReason,
  hasTaste,
  matchPercent,
  type TastePreferences,
} from '../preferences/taste-scoring.js';
import type { LatLng } from '../restaurants/restaurant-rules.js';
import type { Restaurant } from '../restaurants/restaurant-view.service.js';
import { RestaurantsService } from '../restaurants/restaurants.service.js';
import { WeatherService } from '../weather/weather.service.js';
import {
  dailyJitter,
  describe,
  matchedWeather,
  personalReasons,
  POPULAR_DESCRIPTION,
  popularReasons,
  RECENT_DAYS,
  RECENT_PENALTY,
  WEATHER_BONUS,
  weatherTags,
  type WeatherTag,
} from './recommendation-rules.js';

const PICK = 5;
// 근처 식당이 없는 메뉴가 이어질 때 카카오를 너무 많이 부르지 않게
const MAX_TRIES = 12;
const TODAY_RESTAURANTS = 4;
const WIDE_RADIUS_M = 3000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SEARCH_MENU_LIMIT = 5;

const summary = (m: Menu) => ({ id: m.id, name: m.name, imageUrl: m.imageUrl });

interface Candidate {
  menu: Menu;
  score: number;
  matchPercent: number | null;
  popularRank: number | null;
}

interface Context {
  personal: boolean;
  prefs: TastePreferences;
  tags: WeatherTag[];
}

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: PreferencesService,
    private readonly restaurants: RestaurantsService,
    private readonly weather: WeatherService,
    private readonly locations: LocationsService,
    private readonly clock: Clock,
  ) {}

  // GET /recommendations: 오늘의 추천 1 + 다른 후보 4. 비로그인 · 취향 없음은 인기 모드
  async recommend(
    query: {
      lat?: number;
      lng?: number;
      radiusM?: number;
      excludeMenuIds?: string[];
    },
    userId: string | undefined,
  ) {
    if (query.lat === undefined || query.lng === undefined)
      throw new AppException('LOCATION_REQUIRED');
    const origin = { lat: query.lat, lng: query.lng };
    const radiusM = query.radiusM ?? 1000;

    const [location, weather, ctx] = await Promise.all([
      this.neighborhood(origin),
      // 날씨가 실패해도 추천은 그대로 (weather: null, 날씨 이유 빠짐)
      this.weather.current(origin.lat, origin.lng).catch(() => null),
      this.context(userId),
    ]);
    const context: Context = { ...ctx, tags: weatherTags(weather) };
    const candidates = await this.candidates(
      context,
      userId,
      new Set(query.excludeMenuIds ?? []),
    );

    // 점수 순으로 근처 식당을 확인해 5개가 차면 멈춘다
    const picked: { c: Candidate; restaurants: Restaurant[] }[] = [];
    for (const c of candidates.slice(0, MAX_TRIES)) {
      const restaurants = await this.restaurants.search({
        origin,
        menu: c.menu,
        radiusM,
        userId,
      });
      // 인기 순위는 실제로 보여 주는 메뉴 순서대로 (근처 식당이 없어 빠진 메뉴는 순위를 차지하지 않는다)
      if (restaurants.length) {
        picked.push({ c: { ...c, popularRank: context.personal ? null : picked.length + 1 }, restaurants });
      }
      if (picked.length === PICK) break;
    }

    const base = {
      mode: context.personal ? ('personal' as const) : ('popular' as const),
      promptTaste: !context.personal,
      location,
      weather,
    };
    if (!picked.length) {
      return {
        ...base,
        today: null,
        alternatives: [],
        suggestRadiusM: radiusM < WIDE_RADIUS_M ? WIDE_RADIUS_M : null,
      };
    }

    const [first, ...rest] = picked;
    if (userId) await this.log(userId, first.c.menu.id);
    const reasons = context.personal
      ? personalReasons(first.c.menu, context.prefs, context.tags)
      : popularReasons(first.c.menu, first.c.popularRank ?? 1, context.tags);
    reasons.push({
      type: 'nearby',
      label: `주변 ${first.restaurants.length}곳`,
    });

    return {
      ...base,
      today: {
        menu: summary(first.c.menu),
        matchPercent: first.c.matchPercent,
        popularRank: first.c.popularRank,
        description: context.personal
          ? describe(first.c.menu, context.tags)
          : POPULAR_DESCRIPTION,
        reasons,
        nearbyCount: first.restaurants.length,
        // 광고 식당이 맨 앞 (식당 검색 정렬)
        restaurants: first.restaurants.slice(0, TODAY_RESTAURANTS),
      },
      alternatives: rest.map(({ c, restaurants }) => ({
        menu: summary(c.menu),
        matchPercent: c.matchPercent,
        popularRank: c.popularRank,
        nearbyCount: restaurants.length,
      })),
      suggestRadiusM: null,
    };
  }

  // GET /search: 메뉴(이름 · 키워드) + 식당(그 메뉴를 파는 곳 → 이름 · 카테고리가 맞는 곳)
  async search(
    query: {
      q?: string;
      lat?: number;
      lng?: number;
      type?: 'all' | 'menu' | 'restaurant';
    },
    userId: string | undefined,
  ) {
    if (query.lat === undefined || query.lng === undefined)
      throw new AppException('LOCATION_REQUIRED');
    const q = query.q?.trim() ?? '';
    const type = query.type ?? 'all';
    if (!q) return { menus: [], restaurants: [] };
    const origin = { lat: query.lat, lng: query.lng };

    const matched = (
      await this.prisma.menu.findMany({
        where: {
          visible: true,
          OR: [{ name: { contains: q } }, { kakaoKeyword: { contains: q } }],
        },
      })
    )
      .sort(
        (a, b) =>
          Number(b.name.startsWith(q)) - Number(a.name.startsWith(q)) ||
          a.name.localeCompare(b.name, 'ko'),
      )
      .slice(0, SEARCH_MENU_LIMIT);

    const ctx = await this.context(userId);
    const [ranks, allergens] = await Promise.all([
      this.preferences.popularityRanks(),
      this.allergens(),
    ]);
    const byMenu = new Map<string, Restaurant[]>();
    for (const m of matched) {
      byMenu.set(
        m.id,
        await this.restaurants.search({ origin, menu: m, userId }),
      );
    }

    const menus =
      type === 'restaurant'
        ? []
        : matched.map((m) => ({
            menu: summary(m),
            matchPercent:
              ctx.personal && !exclusionReason(m, ctx.prefs, allergens)
                ? matchPercent(m, ctx.prefs, ranks.get(m.id) ?? 99)
                : null,
            nearbyCount: byMenu.get(m.id)?.length ?? 0,
          }));

    if (type === 'menu') return { menus, restaurants: [] };
    const first = matched[0] ? (byMenu.get(matched[0].id) ?? []) : [];
    const seen = new Set(first.map((r) => r.placeId));
    const byName = (
      await this.restaurants.search({ origin, menu: null, q, userId })
    ).filter((r) => !seen.has(r.placeId));
    return { menus, restaurants: [...first, ...byName] };
  }

  // ---------- 내부 ----------

  private async context(
    userId: string | undefined,
  ): Promise<Omit<Context, 'tags'>> {
    const prefs = userId
      ? await this.preferences.get(userId)
      : { ...EMPTY_PREFERENCES };
    return { personal: Boolean(userId) && hasTaste(prefs), prefs };
  }

  private async allergens() {
    const rows = await this.prisma.allergy.findMany();
    return new Map(rows.map((a) => [a.name, a.ingredients]));
  }

  // 점수 순 후보. 개인: 취향 매칭 + 날씨 가점 - 최근 추천 감점, 인기: 7일 추천 수 순위 → 날씨
  private async candidates(
    ctx: Context,
    userId: string | undefined,
    exclude: Set<string>,
  ) {
    const now = this.clock.now();
    const day = new Date(now.getTime() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const startOfToday = new Date(`${day}T00:00:00+09:00`);
    const [menus, ranks, allergens, recent] = await Promise.all([
      this.prisma.menu.findMany({
        where: { visible: true, id: { notIn: [...exclude] } },
      }),
      this.preferences.popularityRanks(),
      this.allergens(),
      userId
        ? this.prisma.recommendationLog.findMany({
            where: {
              userId,
              createdAt: {
                gte: new Date(startOfToday.getTime() - RECENT_DAYS * DAY_MS),
                lt: startOfToday,
              },
            },
            select: { menuId: true },
          })
        : Promise.resolve([]),
    ]);
    const recentIds = new Set(recent.map((r) => r.menuId));
    const userKey = userId ?? 'guest';

    const scored = menus
      .filter((m) => !ctx.personal || !exclusionReason(m, ctx.prefs, allergens))
      .map((m) => {
        const rank = ranks.get(m.id) ?? menus.length;
        const weatherHit = matchedWeather(m, ctx.tags) ? 1 : 0;
        const jitter = dailyJitter(m.id, day, userKey);
        if (ctx.personal) {
          const percent = Math.max(
            40,
            Math.min(
              98,
              matchPercent(m, ctx.prefs, rank) +
                weatherHit * WEATHER_BONUS -
                (recentIds.has(m.id) ? RECENT_PENALTY : 0),
            ),
          );
          return {
            menu: m,
            score: percent + jitter,
            matchPercent: percent,
            popularRank: null,
          };
        }
        // 인기: 순위가 같으면(기록이 없으면) 날씨가 맞는 메뉴 먼저
        return {
          menu: m,
          score: -rank * 10 + weatherHit * 5 + jitter,
          matchPercent: null,
          popularRank: 0,
        };
      })
      .sort((a, b) => b.score - a.score);
    // popularRank는 식당을 확인하며 고른 순서로 다시 매긴다 (recommend)
    return scored as Candidate[];
  }

  // 오늘 추천 기록 (같은 메뉴는 하루 한 번). 받은 추천 수 · 인기 순위 · 최근 추천 감점에 쓴다
  private async log(userId: string, menuId: string) {
    const day = new Date(this.clock.now().getTime() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const startOfToday = new Date(`${day}T00:00:00+09:00`);
    const exists = await this.prisma.recommendationLog.findFirst({
      where: { userId, menuId, createdAt: { gte: startOfToday } },
      select: { id: true },
    });
    if (!exists) {
      await this.prisma.recommendationLog.create({
        data: { userId, menuId, createdAt: this.clock.now() },
      });
    }
  }

  // 좌표 → 동네 이름. 국내 밖이면 422 그대로, 그 밖의 실패는 "현재 위치"
  private async neighborhood(origin: LatLng) {
    try {
      return await this.locations.reverse(origin.lat, origin.lng);
    } catch (error) {
      if (error instanceof AppException && error.code === 'OUT_OF_SERVICE_AREA')
        throw error;
      this.logger.warn(`동네 이름 실패: ${(error as Error).message}`);
      return { name: '현재 위치', ...origin };
    }
  }
}
