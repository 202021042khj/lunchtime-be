import { Injectable } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AppException } from '../../../common/errors/app.exception.js';
import type {
  Prisma,
  SponsoredPlace,
} from '../../../generated/prisma/client.js';
import { KakaoLocalClient } from '../../../integrations/kakao/kakao-local.client.js';
import { StorageService } from '../../../integrations/storage/storage.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { Hours } from '../../restaurants/restaurant-rules.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';
import { adminPage, type AdminPageQueryDto } from '../common/admin-page.js';

export const SPONSORED_RADII = [500, 1000, 2000, 3000];
export type SponsoredStatus = 'scheduled' | 'active' | 'ended';
const STATUS_ORDER: Record<SponsoredStatus, number> = {
  active: 0,
  scheduled: 1,
  ended: 2,
};

export interface SponsoredPlaceInput {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: string;
}

export interface SponsoredInput {
  place: SponsoredPlaceInput;
  targetMenuIds: string[];
  targetCategories: string[];
  radiusM: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  hours: Hours | null;
  priority: number;
  feeKrw: number;
  paymentStatus: 'pending' | 'paid';
  // 없으면 사진 없음
  imageUrl?: string | null;
}

const invalid = (field: string, message: string): never => {
  throw new AppException('VALIDATION_FAILED', message, {
    fields: { [field]: message },
  });
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (s: string) => new Date(`${s}T00:00:00Z`);

// API.md 검사 규칙 (문구는 프론트 목과 같다)
export function sponsoredProblem(
  input: Omit<SponsoredInput, 'place'>,
): { field: string; message: string } | null {
  if (!input.targetMenuIds.length && !input.targetCategories.length) {
    return {
      field: 'targetMenuIds',
      message: '노출 메뉴나 카테고리를 하나 이상 골라 주세요.',
    };
  }
  if (!SPONSORED_RADII.includes(input.radiusM))
    return { field: 'radiusM', message: '노출 반경을 골라 주세요.' };
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)
  ) {
    return { field: 'startDate', message: '기간을 확인해 주세요.' };
  }
  if (input.endDate < input.startDate) {
    return {
      field: 'endDate',
      message: '기간을 확인해 주세요. 끝나는 날이 시작일보다 빨라요.',
    };
  }
  if (
    !Number.isInteger(input.priority) ||
    input.priority < 1 ||
    input.priority > 99
  ) {
    return { field: 'priority', message: '우선순위는 1~99로 적어 주세요.' };
  }
  if (!Number.isInteger(input.feeKrw) || input.feeKrw < 0)
    return { field: 'feeKrw', message: '광고료를 확인해 주세요.' };
  const h = input.hours;
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (h && (!hhmm.test(h.open) || !hhmm.test(h.close) || h.close <= h.open)) {
    return { field: 'hours', message: '영업시간을 확인해 주세요.' };
  }
  if (
    h?.break &&
    (h.break[1] <= h.break[0] || h.break[0] < h.open || h.break[1] > h.close)
  ) {
    return {
      field: 'hours',
      message: '브레이크 시간이 영업시간 안에 있어야 해요.',
    };
  }
  return null;
}

@Injectable()
export class AdminSponsoredService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kakao: KakaoLocalClient,
    private readonly storage: StorageService,
    private readonly audit: AdminAuditService,
    private readonly clock: Clock,
  ) {}

  private today(): string {
    return ymd(new Date(this.clock.now().getTime() + 9 * 60 * 60 * 1000));
  }

  // 기간 중 취소했으면 종료, 아니면 오늘(KST)과 기간으로
  statusOf(
    s: Pick<SponsoredPlace, 'canceledAt' | 'startDate' | 'endDate'>,
  ): SponsoredStatus {
    if (s.canceledAt) return 'ended';
    const t = this.today();
    if (t < ymd(s.startDate)) return 'scheduled';
    if (t > ymd(s.endDate)) return 'ended';
    return 'active';
  }

  async summary() {
    const rows = await this.prisma.sponsoredPlace.findMany();
    const active = rows.filter((s) => this.statusOf(s) === 'active');
    const month = this.today().slice(0, 7);
    const impressions = active.reduce((a, s) => a + s.impressions, 0);
    const clicks = active.reduce((a, s) => a + s.clicks, 0);
    return {
      active: active.length,
      // 이번 달에 걸친 결제 완료 광고의 광고료 합
      monthRevenueKrw: rows
        .filter(
          (s) =>
            s.paymentStatus === 'paid' &&
            ymd(s.startDate).slice(0, 7) <= month &&
            ymd(s.endDate).slice(0, 7) >= month,
        )
        .reduce((a, s) => a + s.feeKrw, 0),
      avgCtrPercent: impressions
        ? Math.round((clicks / impressions) * 1000) / 10
        : null,
      pendingPayment: rows.filter(
        (s) => s.paymentStatus === 'pending' && this.statusOf(s) !== 'ended',
      ).length,
    };
  }

  // 진행 중 → 예약 → 종료, 같은 상태는 우선순위 순
  async list(query: AdminPageQueryDto & { status?: SponsoredStatus }) {
    const rows = await this.prisma.sponsoredPlace.findMany();
    const names = await this.menuNames(rows.flatMap((r) => r.targetMenuIds));
    const items = rows
      .map((r) => this.toSponsored(r, names))
      .filter((s) => !query.status || s.status === query.status)
      .sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          a.priority - b.priority ||
          b.startDate.localeCompare(a.startDate),
      );
    return adminPage(items, query);
  }

  // 광고 등록용 카카오 장소 검색 (음식점만)
  async searchPlaces(q: string | undefined, lat?: number, lng?: number) {
    const query = q?.trim();
    if (!query) return { items: [] };
    const docs =
      lat !== undefined && lng !== undefined
        ? await this.kakao.searchRestaurants({
            keyword: query,
            lat,
            lng,
            radiusM: 20000,
            sort: 'accuracy',
            maxPages: 1,
          })
        : (await this.kakao.searchKeyword(query, 15)).filter((d) =>
            d.category_name.startsWith('음식점'),
          );
    return {
      items: docs.map((d) => ({
        placeId: d.id,
        name: d.place_name,
        address: d.road_address_name || d.address_name,
        lat: Number(d.y),
        lng: Number(d.x),
        category: d.category_name,
      })),
    };
  }

  async create(adminId: string, input: SponsoredInput) {
    if (!input.place?.placeId) invalid('place', '식당을 골라 주세요.');
    await this.validate(input);
    const created = await this.prisma.sponsoredPlace.create({
      data: this.toData(input),
    });
    await this.record(adminId, 'sponsored.create', created.id, {
      placeId: created.placeId,
    });
    return this.withNames(created);
  }

  // 식당(place)은 바꿀 수 없다. 종료된 광고는 409 → 재등록
  async update(
    adminId: string,
    id: string,
    patch: Partial<Omit<SponsoredInput, 'place'>>,
  ) {
    const target = await this.find(id);
    if (this.statusOf(target) === 'ended') {
      throw new AppException(
        'CONFLICT',
        '종료된 광고는 고칠 수 없어요. 재등록해 주세요.',
      );
    }
    const merged: SponsoredInput = {
      ...this.toInput(target),
      ...patch,
      place: this.toInput(target).place,
    };
    await this.validate(merged, patch.imageUrl !== undefined);
    // merged.place는 원래 광고의 식당이라 그대로 다시 저장된다
    const updated = await this.prisma.sponsoredPlace.update({
      where: { id },
      data: this.toData(merged),
    });
    await this.record(adminId, 'sponsored.update', id, {
      fields: Object.keys(patch),
    });
    return this.withNames(updated);
  }

  // 종료된 광고만. 식당은 원래 광고에서 복사하고 새 광고를 만든다
  async renew(
    adminId: string,
    id: string,
    input: Omit<SponsoredInput, 'place'>,
  ) {
    const original = await this.find(id);
    if (this.statusOf(original) !== 'ended') {
      throw new AppException('CONFLICT', '종료된 광고만 재등록할 수 있어요.');
    }
    const full: SponsoredInput = {
      ...input,
      place: this.toInput(original).place,
    };
    await this.validate(full);
    const created = await this.prisma.sponsoredPlace.create({
      data: { ...this.toData(full), renewedFromId: original.id },
    });
    await this.record(adminId, 'sponsored.renew', created.id, {
      from: original.id,
    });
    return this.withNames(created);
  }

  // 지우지 않고 바로 종료 (기록 유지). 이미 종료면 409
  async cancel(adminId: string, id: string) {
    const target = await this.find(id);
    if (this.statusOf(target) === 'ended')
      throw new AppException('CONFLICT', '이미 종료된 광고예요.');
    await this.prisma.sponsoredPlace.update({
      where: { id },
      data: { canceledAt: this.clock.now() },
    });
    await this.record(adminId, 'sponsored.cancel', id, {});
  }

  // ---------- 내부 ----------

  private async find(id: string) {
    const row = await this.prisma.sponsoredPlace.findUnique({ where: { id } });
    if (!row) throw new AppException('NOT_FOUND', '광고를 찾을 수 없어요.');
    return row;
  }

  private async validate(input: SponsoredInput, checkImage = true) {
    const problem = sponsoredProblem(input);
    if (problem) invalid(problem.field, problem.message);
    if (input.targetMenuIds.length) {
      const found = await this.prisma.menu.count({
        where: { id: { in: input.targetMenuIds } },
      });
      if (found !== new Set(input.targetMenuIds).size)
        invalid('targetMenuIds', '없는 메뉴가 들어 있어요.');
    }
    if (checkImage && input.imageUrl)
      await this.storage.assertOwnImage(input.imageUrl, 'imageUrl');
  }

  private toData(input: SponsoredInput) {
    return {
      placeId: input.place.placeId,
      placeName: input.place.name,
      address: input.place.address,
      lat: input.place.lat,
      lng: input.place.lng,
      category: input.place.category,
      targetMenuIds: [...new Set(input.targetMenuIds)],
      targetCategories: [
        ...new Set(input.targetCategories.map((c) => c.trim()).filter(Boolean)),
      ],
      radiusM: input.radiusM,
      startDate: dateOf(input.startDate),
      endDate: dateOf(input.endDate),
      hours: (input.hours ?? undefined) as Prisma.InputJsonValue | undefined,
      priority: input.priority,
      feeKrw: input.feeKrw,
      paymentStatus: input.paymentStatus,
      imageUrl: input.imageUrl ?? null,
    };
  }

  private toInput(r: SponsoredPlace): SponsoredInput {
    return {
      place: {
        placeId: r.placeId,
        name: r.placeName,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        category: r.category,
      },
      targetMenuIds: r.targetMenuIds,
      targetCategories: r.targetCategories,
      radiusM: r.radiusM,
      startDate: ymd(r.startDate),
      endDate: ymd(r.endDate),
      hours: (r.hours as unknown as Hours | null) ?? null,
      priority: r.priority,
      feeKrw: r.feeKrw,
      paymentStatus: r.paymentStatus,
      imageUrl: r.imageUrl,
    };
  }

  private async menuNames(ids: string[]) {
    const menus = await this.prisma.menu.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return new Map(menus.map((m) => [m.id, m.name]));
  }

  private async withNames(row: SponsoredPlace) {
    return this.toSponsored(row, await this.menuNames(row.targetMenuIds));
  }

  // API.md Sponsored (어드민)
  private toSponsored(r: SponsoredPlace, names: Map<string, string>) {
    return {
      id: r.id,
      ...this.toInput(r),
      status: this.statusOf(r),
      canceled: Boolean(r.canceledAt),
      targetMenuNames: r.targetMenuIds.map((id) => names.get(id) ?? id),
      impressions: r.impressions,
      clicks: r.clicks,
    };
  }

  private record(
    adminId: string,
    action: string,
    targetId: string,
    detail: Prisma.InputJsonValue,
  ) {
    return this.audit.record({
      adminId,
      action,
      targetType: 'sponsored',
      targetId,
      detail,
    });
  }
}
