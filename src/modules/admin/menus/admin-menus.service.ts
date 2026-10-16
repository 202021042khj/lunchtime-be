import { Injectable } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AppException } from '../../../common/errors/app.exception.js';
import type { Menu, MenuWeather } from '../../../generated/prisma/client.js';
import { StorageService } from '../../../integrations/storage/storage.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';
import { adminPage, type AdminPageQueryDto } from '../common/admin-page.js';
import {
  cleanMenu,
  CSV_HEADER_PREFIX,
  csvRowToMenu,
  menuProblem,
  parseCsvLine,
  type MenuInput,
} from './menu-rules.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AdminMenuQuery extends AdminPageQueryDto {
  q?: string;
  cuisine?: string;
  visible?: boolean;
}

const invalid = (field: string, message: string): never => {
  throw new AppException('VALIDATION_FAILED', message, {
    fields: { [field]: message },
  });
};

@Injectable()
export class AdminMenusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AdminAuditService,
    private readonly clock: Clock,
  ) {}

  // GET /admin/menus: 노출 메뉴 먼저, 그 안에서 7일 추천 수 순. counts는 필터와 상관없는 전체 수
  async list(query: AdminMenuQuery) {
    const q = query.q?.trim();
    const [menus, counts] = await Promise.all([
      this.prisma.menu.findMany({
        where: {
          ...(q && {
            OR: [{ name: { contains: q } }, { ingredients: { has: q } }],
          }),
          ...(query.cuisine && { cuisine: query.cuisine }),
          ...(query.visible !== undefined && { visible: query.visible }),
        },
      }),
      this.recommendCounts(),
    ]);
    const items = menus
      .map((m) => this.toAdminMenu(m, counts.get(m.id) ?? 0))
      .sort(
        (a, b) =>
          Number(b.visible) - Number(a.visible) ||
          b.recommendCount7d - a.recommendCount7d ||
          a.name.localeCompare(b.name, 'ko'),
      );
    const [all, hidden] = await Promise.all([
      this.prisma.menu.count(),
      this.prisma.menu.count({ where: { visible: false } }),
    ]);
    return { ...adminPage(items, query), counts: { all, hidden } };
  }

  async create(adminId: string, input: MenuInput) {
    const menu = await this.validate(input);
    const created = await this.prisma.menu.create({ data: toData(menu) });
    await this.audit.record({
      adminId,
      action: 'menu.create',
      targetType: 'menu',
      targetId: created.id,
      detail: { name: created.name },
    });
    return this.toAdminMenu(created, 0);
  }

  // 일부만 보내도 된다 (노출/숨김 토글 등). 합친 결과를 다시 검사한다
  async update(adminId: string, id: string, patch: Partial<MenuInput>) {
    const target = await this.prisma.menu.findUnique({ where: { id } });
    if (!target) throw new AppException('NOT_FOUND', '메뉴를 찾을 수 없어요.');
    const merged: MenuInput = { ...fromRow(target), ...patch };
    const menu = await this.validate(merged, id, patch.imageUrl !== undefined);
    const updated = await this.prisma.menu.update({
      where: { id },
      data: toData(menu),
    });
    await this.audit.record({
      adminId,
      action: 'menu.update',
      targetType: 'menu',
      targetId: id,
      detail: { fields: Object.keys(patch) },
    });
    return this.toAdminMenu(
      updated,
      (await this.recommendCounts()).get(id) ?? 0,
    );
  }

  // CSV 가져오기: 문제 있는 줄만 건너뛰고 나머지는 반영, 같은 이름은 덮어쓰기
  async importCsv(adminId: string, text: string) {
    const lines = text
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .filter((l) => l.trim());
    if (!lines.length || !lines[0].startsWith(CSV_HEADER_PREFIX)) {
      invalid(
        'file',
        '양식의 첫 줄(이름,종류,…)이 없어요. 양식을 내려받아 써 주세요.',
      );
    }
    const result = {
      created: 0,
      updated: 0,
      failed: [] as { line: number; reason: string }[],
    };
    for (const [i, line] of lines.slice(1).entries()) {
      const input = csvRowToMenu(parseCsvLine(line));
      try {
        if (!Number.isInteger(input.spiceLevel))
          invalid('spiceLevel', '맵기는 0~4 숫자로 적어 주세요.');
        const existing = await this.prisma.menu.findUnique({
          where: { name: input.name.trim() },
        });
        // CSV에는 사진 칸이 없으니 덮어써도 기존 사진은 그대로 둔다
        const menu = await this.validate(
          { ...input, imageUrl: existing?.imageUrl ?? null },
          existing?.id,
          false,
        );
        if (existing) {
          await this.prisma.menu.update({
            where: { id: existing.id },
            data: toData(menu),
          });
          result.updated += 1;
        } else {
          await this.prisma.menu.create({ data: toData(menu) });
          result.created += 1;
        }
      } catch (error) {
        result.failed.push({
          line: i + 2,
          reason: error instanceof Error ? error.message : '알 수 없는 오류',
        });
      }
    }
    await this.audit.record({
      adminId,
      action: 'menu.import',
      targetType: 'menu',
      detail: {
        created: result.created,
        updated: result.updated,
        failed: result.failed.length,
      },
    });
    return result;
  }

  // 재료 · 알레르기 사전 (취향 선택지와 같은 목록) + 메뉴에 쓰인 재료
  async ingredients() {
    const [dictionary, allergies, menus] = await Promise.all([
      this.prisma.ingredient.findMany({ select: { name: true } }),
      this.prisma.allergy.findMany({ select: { ingredients: true } }),
      this.prisma.menu.findMany({ select: { ingredients: true } }),
    ]);
    const all = [
      ...dictionary.map((d) => d.name),
      ...allergies.flatMap((a) => a.ingredients),
      ...menus.flatMap((m) => m.ingredients),
    ];
    return {
      items: [...new Set(all)].sort((a, b) => a.localeCompare(b, 'ko')),
    };
  }

  async addIngredient(adminId: string, name: string, inOptions: boolean) {
    const clean = name.trim();
    if (!clean) invalid('name', '재료 이름을 적어 주세요.');
    const last = await this.prisma.ingredient.findFirst({
      orderBy: { sortOrder: 'desc' },
    });
    await this.prisma.ingredient.upsert({
      where: { name: clean },
      create: { name: clean, inOptions, sortOrder: (last?.sortOrder ?? 0) + 1 },
      update: { inOptions },
    });
    await this.audit.record({
      adminId,
      action: 'ingredient.upsert',
      targetType: 'ingredient',
      targetId: clean,
    });
    return this.ingredients();
  }

  // ---------- 내부 ----------

  private async validate(
    input: MenuInput,
    selfId?: string,
    checkImage = true,
  ): Promise<MenuInput> {
    const problem = menuProblem(input);
    if (problem) invalid(problem.field, problem.message);
    const menu = cleanMenu(input);
    const same = await this.prisma.menu.findUnique({
      where: { name: menu.name },
    });
    if (same && same.id !== selfId) {
      throw new AppException('CONFLICT', `'${menu.name}' 메뉴가 이미 있어요.`, {
        fields: { name: '같은 이름의 메뉴가 있어요.' },
      });
    }
    if (checkImage && menu.imageUrl)
      await this.storage.assertOwnImage(menu.imageUrl, 'imageUrl');
    return menu;
  }

  private async recommendCounts(): Promise<Map<string, number>> {
    const since = new Date(this.clock.now().getTime() - 7 * DAY_MS);
    const rows = await this.prisma.recommendationLog.groupBy({
      by: ['menuId'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.menuId, r._count._all]));
  }

  private toAdminMenu(m: Menu, recommendCount7d: number) {
    return { ...fromRow(m), id: m.id, recommendCount7d };
  }
}

function fromRow(m: Menu): MenuInput {
  return {
    name: m.name,
    cuisine: m.cuisine,
    category: m.category,
    imageUrl: m.imageUrl,
    ingredients: m.ingredients,
    tastes: m.tastes,
    spiceLevel: m.spiceLevel,
    weathers: m.weathers,
    kakaoKeyword: m.kakaoKeyword,
    kakaoCategory: m.kakaoCategory,
    visible: m.visible,
  };
}

const toData = (m: MenuInput) => ({
  ...m,
  weathers: m.weathers as MenuWeather[],
});
