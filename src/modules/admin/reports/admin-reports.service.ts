import { Injectable } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AppException } from '../../../common/errors/app.exception.js';
import { kstDayStart, kstMonthStart, toKstIso } from '../../../common/time.js';
import type {
  ReportReason,
  ReportResolution,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { ReviewStatsService } from '../../reviews/review-stats.service.js';
import { REVIEW_INCLUDE, toReview } from '../../reviews/review-view.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';
import {
  adminPageWindow,
  type AdminPageQueryDto,
} from '../common/admin-page.js';
import { AdminUsersService } from '../users/admin-users.service.js';

export type ReportGroupStatus = 'pending' | 'resolved';

const REASON_LABELS: Record<ReportReason, string> = {
  abuse: '욕설·비방',
  ad: '광고·홍보',
  false_info: '허위 정보',
  irrelevant: '관련 없는 내용',
};

// 신고는 리뷰 단위로 묶어 처리한다(ReportGroup). 처리 대기 신고가 하나라도 있으면 pending
@Injectable()
export class AdminReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: ReviewStatsService,
    private readonly users: AdminUsersService,
    private readonly audit: AdminAuditService,
    private readonly clock: Clock,
  ) {}

  // GET /admin/reports/summary
  async summary() {
    const now = this.clock.now();
    const [pending, today, resolved] = await Promise.all([
      this.prisma.reviewReport.findMany({
        where: { status: 'pending' },
        distinct: ['reviewId'],
        select: { reviewId: true },
      }),
      this.prisma.reviewReport.findMany({
        where: { createdAt: { gte: kstDayStart(now) } },
        distinct: ['reviewId'],
        select: { reviewId: true },
      }),
      // 처리 한 번 = 같은 리뷰 · 같은 처리 시각
      this.prisma.reviewReport.findMany({
        where: { resolvedAt: { gte: kstMonthStart(now) } },
        distinct: ['reviewId', 'resolvedAt'],
        select: { resolution: true },
      }),
    ]);
    const deleted = resolved.filter((r) => r.resolution === 'deleted').length;
    return {
      pending: pending.length,
      today: today.length,
      resolvedThisMonth: resolved.length,
      deleteRatePercent: resolved.length
        ? Math.round((deleted / resolved.length) * 100)
        : 0,
    };
  }

  // GET /admin/reports?status= (최근 신고 시각 순)
  async list(status: ReportGroupStatus | undefined, query: AdminPageQueryDto) {
    const [all, pending] = await Promise.all([
      this.prisma.reviewReport.groupBy({
        by: ['reviewId'],
        _max: { createdAt: true },
      }),
      this.prisma.reviewReport.groupBy({
        by: ['reviewId'],
        where: { status: 'pending' },
        _count: { _all: true },
      }),
    ]);
    const pendingIds = new Set(pending.map((p) => p.reviewId));
    const ids = all
      .filter(
        (g) => !status || (status === 'pending') === pendingIds.has(g.reviewId),
      )
      .sort(
        (a, b) =>
          b._max.createdAt!.getTime() - a._max.createdAt!.getTime() ||
          b.reviewId.localeCompare(a.reviewId),
      )
      .map((g) => g.reviewId);
    const { page, size, skip, take } = adminPageWindow(ids.length, query);
    return {
      items: await this.groups(ids.slice(skip, skip + take)),
      total: ids.length,
      page,
      size,
    };
  }

  // GET /admin/reports/{reviewId}
  async detail(reviewId: string) {
    const [group] = await this.groups([reviewId]);
    if (!group) throw new AppException('NOT_FOUND', '신고를 찾을 수 없어요.');
    return group;
  }

  // POST /admin/reports/{reviewId}/resolve: 대기 중인 신고를 모두 처리한다. 삭제면 리뷰를 지우고 집계를 다시 센다
  async resolve(
    adminId: string,
    reviewId: string,
    action: 'dismiss' | 'delete',
    suspendAuthorDays: number | null,
  ) {
    const reports = await this.prisma.reviewReport.findMany({
      where: { reviewId },
      select: { status: true, reason: true },
    });
    if (!reports.length) {
      throw new AppException('NOT_FOUND', '신고를 찾을 수 없어요.');
    }
    const pending = reports.filter((r) => r.status === 'pending');
    if (!pending.length) {
      throw new AppException('CONFLICT', '이미 처리한 신고예요.');
    }
    const review = await this.prisma.review.findUniqueOrThrow({
      where: { id: reviewId },
    });
    const now = this.clock.now();
    const resolution: ReportResolution =
      action === 'delete' ? 'deleted' : 'dismissed';

    await this.prisma.$transaction(async (tx) => {
      await tx.reviewReport.updateMany({
        where: { reviewId, status: 'pending' },
        data: {
          status: 'resolved',
          resolution,
          resolvedById: adminId,
          resolvedAt: now,
        },
      });
      if (action === 'delete' && !review.deletedAt) {
        await tx.review.update({
          where: { id: reviewId },
          data: { deletedAt: now },
        });
        await this.stats.recalculate(tx, review.placeId, review.menus);
      }
      await this.audit.record(
        {
          adminId,
          action: 'report.resolve',
          targetType: 'review',
          targetId: reviewId,
          detail: { action, suspendAuthorDays, reports: pending.length },
        },
        tx,
      );
      if (suspendAuthorDays) {
        const author = await tx.user.findUniqueOrThrow({
          where: { id: review.userId },
          select: { status: true },
        });
        // 탈퇴한 작성자는 정지하지 않는다 (신고 처리는 그대로 진행)
        if (author.status !== 'withdrawn') {
          await this.users.applySuspension(
            tx,
            adminId,
            review.userId,
            suspendAuthorDays,
            `신고된 리뷰 (${REASON_LABELS[topReason(pending)]})`,
          );
        }
      }
    });
    return this.detail(reviewId);
  }

  // ---------- 내부 ----------

  // API.md ReportGroup. 주어진 리뷰 순서대로
  private async groups(reviewIds: string[]) {
    if (!reviewIds.length) return [];
    const [reviews, reports] = await Promise.all([
      this.prisma.review.findMany({
        where: { id: { in: reviewIds } },
        include: REVIEW_INCLUDE,
      }),
      this.prisma.reviewReport.findMany({
        where: { reviewId: { in: reviewIds } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const history = await this.authorHistory([
      ...new Set(reviews.map((r) => r.userId)),
    ]);
    const reviewById = new Map(reviews.map((r) => [r.id, r]));

    return reviewIds.flatMap((id) => {
      const review = reviewById.get(id);
      const list = reports.filter((r) => r.reviewId === id);
      if (!review || !list.length) return [];
      const isPending = list.some((r) => r.status === 'pending');
      const lastResolved = list
        .filter((r) => r.resolvedAt)
        .sort((a, b) => b.resolvedAt!.getTime() - a.resolvedAt!.getTime())[0];
      const reasonCounts = { abuse: 0, ad: 0, false_info: 0, irrelevant: 0 };
      for (const r of list) reasonCounts[r.reason] += 1;
      return [
        {
          review: toReview(review, undefined),
          status: (isPending ? 'pending' : 'resolved') as ReportGroupStatus,
          resolution: isPending ? null : (lastResolved?.resolution ?? null),
          reasonCounts,
          reportCount: list.length,
          firstReportedAt: toKstIso(list[0].createdAt),
          lastReportedAt: toKstIso(list[list.length - 1].createdAt),
          memos: list
            .filter((r) => r.memo)
            .reverse()
            .map((r) => r.memo!),
          authorHistory: history.get(review.userId) ?? {
            reviewCount: 0,
            reportCount: 0,
            deletedCount: 0,
          },
        },
      ];
    });
  }

  // 작성자 이력: 남아 있는 리뷰 수 · 받은 신고 수 · 신고로 삭제된 리뷰 수
  private async authorHistory(userIds: string[]) {
    const [reviews, reports] = await Promise.all([
      this.prisma.review.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.reviewReport.findMany({
        where: { review: { userId: { in: userIds } } },
        select: {
          reviewId: true,
          resolution: true,
          review: { select: { userId: true } },
        },
      }),
    ]);
    const map = new Map<
      string,
      { reviewCount: number; reportCount: number; deletedCount: number }
    >(
      userIds.map((id) => [
        id,
        { reviewCount: 0, reportCount: 0, deletedCount: 0 },
      ]),
    );
    for (const r of reviews) map.get(r.userId)!.reviewCount = r._count._all;
    const deleted = new Set<string>();
    for (const r of reports) {
      const h = map.get(r.review.userId)!;
      h.reportCount += 1;
      if (r.resolution === 'deleted' && !deleted.has(r.reviewId)) {
        deleted.add(r.reviewId);
        h.deletedCount += 1;
      }
    }
    return map;
  }
}

// 가장 많이 들어온 신고 사유 (같으면 먼저 들어온 것)
function topReason(reports: { reason: ReportReason }[]): ReportReason {
  const counts = new Map<ReportReason, number>();
  for (const r of reports)
    counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
