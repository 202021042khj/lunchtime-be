import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { PreferencesDto } from './preferences.dto.js';
import {
  EMPTY_PREFERENCES,
  exclusionReason,
  matchPercent,
  type TastePreferences,
} from './taste-scoring.js';

// 음식 종류 (취향 "좋아하는 음식 종류" = 메뉴 cuisine). 프론트 constants/admin.ts MENU_CUISINES와 같다
export const CUISINES = [
  '한식',
  '중식',
  '일식',
  '양식',
  '분식',
  '아시안',
  '패스트푸드',
  '샐러드·건강식',
] as const;

const PREVIEW_RECOMMENDED = 3;
const PREVIEW_EXCLUDED = 4;
const POPULARITY_DAYS = 7;

function fieldError(field: string, message: string): never {
  throw new AppException('VALIDATION_FAILED', message, {
    fields: { [field]: message },
  });
}

@Injectable()
export class PreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async options() {
    const [ingredients, allergies] = await Promise.all([
      this.prisma.ingredient.findMany({
        where: { inOptions: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.allergy.findMany({ orderBy: { sortOrder: 'asc' } }),
    ]);
    return {
      ingredients: ingredients.map((i) => i.name),
      allergies: allergies.map((a) => a.name),
      cuisines: [...CUISINES],
    };
  }

  // "목록에 없는 재료" 검색: 재료 사전에서 이름에 q가 들어간 것
  async searchIngredients(q: string | undefined) {
    const query = q?.trim();
    if (!query) return { items: [] };
    const rows = await this.prisma.ingredient.findMany({
      where: { name: { contains: query } },
      orderBy: [{ sortOrder: 'asc' }],
      take: 20,
    });
    return { items: rows.map((r) => r.name) };
  }

  async get(userId: string): Promise<TastePreferences> {
    const row = await this.prisma.userPreference.findUnique({
      where: { userId },
    });
    if (!row) return { ...EMPTY_PREFERENCES };
    return {
      dislikedIngredients: row.dislikedIngredients,
      allergies: row.allergies,
      spiceLevel: row.spiceLevel,
      favoriteCuisines: row.favoriteCuisines,
    };
  }

  // 전체 교체. 온보딩 끝 · "나중에 할게요"면 온보딩 완료로 표시한다
  async save(
    userId: string,
    input: PreferencesDto,
    completeOnboarding: boolean,
  ) {
    const prefs = await this.normalize(input);
    await this.prisma.$transaction(async (tx) => {
      await tx.userPreference.upsert({
        where: { userId },
        create: { userId, ...prefs },
        update: prefs,
      });
      if (completeOnboarding) {
        await tx.user.update({
          where: { id: userId },
          data: { onboardingCompleted: true },
        });
      }
    });
    return prefs;
  }

  // 저장 전 취향으로 추천이 어떻게 바뀌는지 (로그인 없이도). 고를 때마다 불리니 쿼리 3번으로 끝낸다
  async preview(input: PreferencesDto) {
    const prefs = await this.normalize(input);
    const [menus, allergies, ranks] = await Promise.all([
      this.prisma.menu.findMany({
        where: { visible: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.allergy.findMany(),
      this.popularityRanks(),
    ]);
    const allergens = new Map(allergies.map((a) => [a.name, a.ingredients]));

    const recommended: { menu: MenuSummary; matchPercent: number }[] = [];
    const excluded: { menu: MenuSummary; reason: string }[] = [];
    for (const m of menus) {
      const menu = { id: m.id, name: m.name, imageUrl: m.imageUrl };
      const reason = exclusionReason(m, prefs, allergens);
      if (reason) {
        excluded.push({ menu, reason });
        continue;
      }
      recommended.push({
        menu,
        matchPercent: matchPercent(m, prefs, ranks.get(m.id) ?? menus.length),
      });
    }
    recommended.sort((a, b) => b.matchPercent - a.matchPercent);
    return {
      recommended: recommended.slice(0, PREVIEW_RECOMMENDED),
      excluded: excluded.slice(0, PREVIEW_EXCLUDED),
    };
  }

  // 최근 7일 추천 수로 매긴 메뉴 인기 순위 (1부터). 기록이 없는 메뉴는 순위 없음
  async popularityRanks(): Promise<Map<string, number>> {
    const since = new Date(
      this.clock.now().getTime() - POPULARITY_DAYS * 24 * 60 * 60 * 1000,
    );
    const counts = await this.prisma.recommendationLog.groupBy({
      by: ['menuId'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { menuId: 'desc' } },
    });
    return new Map(counts.map((c, i) => [c.menuId, i + 1]));
  }

  // 공백 · 중복 정리, 알레르기 · 음식 종류는 선택지에 있는 값만
  private async normalize(input: PreferencesDto): Promise<TastePreferences> {
    const clean = (values: string[]) => [
      ...new Set(values.map((v) => v.trim()).filter(Boolean)),
    ];
    const allergies = clean(input.allergies);
    const favoriteCuisines = clean(input.favoriteCuisines);

    const unknownCuisine = favoriteCuisines.find(
      (c) => !(CUISINES as readonly string[]).includes(c),
    );
    if (unknownCuisine)
      fieldError(
        'favoriteCuisines',
        `'${unknownCuisine}'은(는) 음식 종류에 없어요.`,
      );
    if (allergies.length) {
      const known = await this.prisma.allergy.findMany({
        where: { name: { in: allergies } },
        select: { name: true },
      });
      const unknown = allergies.find((a) => !known.some((k) => k.name === a));
      if (unknown)
        fieldError('allergies', `'${unknown}'은(는) 알레르기 선택지에 없어요.`);
    }
    return {
      dislikedIngredients: clean(input.dislikedIngredients),
      allergies,
      spiceLevel: input.spiceLevel ?? null,
      favoriteCuisines,
    };
  }
}

export interface MenuSummary {
  id: string;
  name: string;
  imageUrl: string | null;
}
