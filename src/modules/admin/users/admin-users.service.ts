import { Injectable } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AppException } from '../../../common/errors/app.exception.js';
import { kstDayStart, toKstIso } from '../../../common/time.js';
import type { Prisma, UserStatus } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';
import {
  adminPageWindow,
  type AdminPageQueryDto,
} from '../common/admin-page.js';

type Tx = Prisma.TransactionClient;

const DAY_MS = 24 * 3600_000;
// CSV 한 번에 내려받는 최대 줄 수
const CSV_LIMIT = 10_000;

export interface AdminUsersFilter {
  q?: string;
  status?: UserStatus;
}

const PROVIDER_LABELS: Record<string, string> = {
  kakao: '카카오',
  google: '구글',
  apple: 'Apple',
  email: '이메일',
};
const STATUS_LABELS: Record<UserStatus, string> = {
  active: '정상',
  suspended: '정지',
  withdrawn: '탈퇴',
};

// "jimin@kakao.com" → "ji***@kakao.com". 이메일이 없으면 빈 문자열
export function maskEmail(email: string | null): string {
  if (!email) return '';
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  const local = email.slice(0, at);
  return `${local.slice(0, local.length > 2 ? 2 : 1)}***${email.slice(at)}`;
}

// 엑셀이 수식으로 읽지 않게 = + - @로 시작하면 '를 붙이고, 쉼표 · 따옴표 · 줄바꿈은 따옴표로 감싼다
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly clock: Clock,
  ) {}

  // GET /admin/users/summary
  async summary() {
    await this.expireSuspensions();
    const now = this.clock.now().getTime();
    const [total, thisWeek, lastWeek, activeToday, suspended] =
      await Promise.all([
        this.prisma.user.count({ where: { status: { not: 'withdrawn' } } }),
        this.prisma.user.count({
          where: { createdAt: { gte: new Date(now - 7 * DAY_MS) } },
        }),
        this.prisma.user.count({
          where: {
            createdAt: {
              gte: new Date(now - 14 * DAY_MS),
              lt: new Date(now - 7 * DAY_MS),
            },
          },
        }),
        this.prisma.user.count({
          where: {
            status: { not: 'withdrawn' },
            lastActiveAt: { gte: kstDayStart(this.clock.now()) },
          },
        }),
        this.prisma.user.count({ where: { status: 'suspended' } }),
      ]);
    return {
      total,
      newThisWeek: thisWeek,
      newWeekChangePercent: lastWeek
        ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
        : null,
      activeToday,
      suspended,
    };
  }

  // GET /admin/users (최근 가입 순)
  async list(filter: AdminUsersFilter, query: AdminPageQueryDto) {
    await this.expireSuspensions();
    const where = this.where(filter);
    const total = await this.prisma.user.count({ where });
    const { page, size, skip, take } = adminPageWindow(total, query);
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
    });
    return { items: await this.toAdminUsers(rows), total, page, size };
  }

  // GET /admin/users/export.csv (목록과 같은 조건, 이메일은 가린 그대로)
  async exportCsv(filter: AdminUsersFilter): Promise<string> {
    await this.expireSuspensions();
    const rows = await this.prisma.user.findMany({
      where: this.where(filter),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: CSV_LIMIT,
    });
    const users = await this.toAdminUsers(rows);
    const header = [
      'id',
      '이름',
      '이메일',
      '로그인',
      '가입일',
      '최근 접속',
      '리뷰',
      '찜',
      '받은 신고',
      '상태',
    ];
    const lines = users.map((u) => [
      u.id,
      u.name,
      u.maskedEmail,
      PROVIDER_LABELS[u.provider] ?? u.provider,
      u.createdAt.slice(0, 10),
      u.lastActiveAt?.slice(0, 10) ?? '',
      u.reviewCount,
      u.favoriteCount,
      u.reportCount,
      STATUS_LABELS[u.status],
    ]);
    return [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\n');
  }

  // POST /admin/users/{id}/suspend — days가 없으면 무기한
  async suspend(
    adminId: string,
    userId: string,
    days: number | null,
    reason: string,
  ) {
    await this.prisma.$transaction((tx) =>
      this.applySuspension(tx, adminId, userId, days, reason),
    );
    return this.one(userId);
  }

  // POST /admin/users/{id}/unsuspend
  async unsuspend(adminId: string, userId: string) {
    const user = await this.findUser(userId);
    if (user.status === 'withdrawn') {
      throw new AppException('CONFLICT', '탈퇴한 유저예요.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: 'active', suspendedUntil: null, suspendReason: null },
      });
      await this.audit.record(
        {
          adminId,
          action: 'user.unsuspend',
          targetType: 'user',
          targetId: userId,
        },
        tx,
      );
    });
    return this.one(userId);
  }

  // 정지 (유저 관리 · 신고 처리가 같이 쓴다). 정지 중이면 새 기간 · 사유로 바꾼다
  async applySuspension(
    tx: Tx,
    adminId: string,
    userId: string,
    days: number | null,
    reason: string,
  ) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppException('NOT_FOUND', '유저를 찾을 수 없어요.');
    if (user.status === 'withdrawn') {
      throw new AppException('CONFLICT', '탈퇴한 유저는 정지할 수 없어요.');
    }
    const until = days
      ? new Date(this.clock.now().getTime() + days * DAY_MS)
      : null;
    await tx.user.update({
      where: { id: userId },
      data: {
        status: 'suspended',
        suspendedUntil: until,
        suspendReason: reason,
      },
    });
    await this.audit.record(
      {
        adminId,
        action: 'user.suspend',
        targetType: 'user',
        targetId: userId,
        detail: { days, reason },
      },
      tx,
    );
  }

  // ---------- 내부 ----------

  // 정지 기간이 끝난 유저를 정상으로 돌린다 (목록 · 집계가 실제 상태를 보이게)
  private async expireSuspensions() {
    await this.prisma.user.updateMany({
      where: {
        status: 'suspended',
        suspendedUntil: { lte: this.clock.now() },
      },
      data: { status: 'active', suspendedUntil: null, suspendReason: null },
    });
  }

  private where(filter: AdminUsersFilter): Prisma.UserWhereInput {
    const q = filter.q?.trim();
    return {
      ...(filter.status && { status: filter.status }),
      ...(q && {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      }),
    };
  }

  private async findUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppException('NOT_FOUND', '유저를 찾을 수 없어요.');
    return user;
  }

  private async one(userId: string) {
    const [user] = await this.toAdminUsers([await this.findUser(userId)]);
    return user;
  }

  // API.md AdminUser. 리뷰 수(삭제 제외) · 찜 수 · 받은 신고 수를 한 번에 센다
  private async toAdminUsers(rows: Prisma.UserGetPayload<object>[]) {
    const ids = rows.map((u) => u.id);
    const [reviews, favorites, reports] = await Promise.all([
      this.prisma.review.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.favorite.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.reviewReport.findMany({
        where: { review: { userId: { in: ids } } },
        select: { review: { select: { userId: true } } },
      }),
    ]);
    const count = (list: { userId: string; _count: { _all: number } }[]) =>
      new Map(list.map((r) => [r.userId, r._count._all]));
    const reviewCounts = count(reviews);
    const favoriteCounts = count(favorites);
    const reportCounts = new Map<string, number>();
    for (const r of reports) {
      reportCounts.set(
        r.review.userId,
        (reportCounts.get(r.review.userId) ?? 0) + 1,
      );
    }
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      maskedEmail: maskEmail(u.email),
      provider: u.provider,
      createdAt: toKstIso(u.createdAt),
      lastActiveAt: u.lastActiveAt ? toKstIso(u.lastActiveAt) : null,
      reviewCount: reviewCounts.get(u.id) ?? 0,
      favoriteCount: favoriteCounts.get(u.id) ?? 0,
      reportCount: reportCounts.get(u.id) ?? 0,
      status: u.status,
      suspendedUntil:
        u.status === 'suspended' && u.suspendedUntil
          ? toKstIso(u.suspendedUntil)
          : null,
    }));
  }
}
