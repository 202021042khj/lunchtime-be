import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { decodeOffset, DEFAULT_LIMIT } from '../../common/cursor.js';
import { AppException } from '../../common/errors/app.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RestaurantsService } from '../restaurants/restaurants.service.js';
import { ReviewAccess } from './review-access.service.js';
import {
  normalizeReview,
  REVIEW_TAGS,
  type ReviewFields,
} from './review-rules.js';
import { REVIEW_INCLUDE, toReview } from './review-view.js';
import type {
  ReviewInputDto,
  ReviewListQueryDto,
  ReviewPageQueryDto,
  ReviewPatchDto,
  ReviewReportDto,
  ReviewSort,
} from './reviews.dto.js';

type Tx = Prisma.TransactionClient;

const KST_OFFSET_MS = 9 * 3600_000;
// 리뷰 쓰기 메뉴 목록 길이
const FORM_MENU_LIMIT = 20;

const ORDER_BY: Record<ReviewSort, Prisma.ReviewOrderByWithRelationInput[]> = {
  recent: [{ createdAt: 'desc' }, { id: 'desc' }],
  photo: [{ createdAt: 'desc' }, { id: 'desc' }],
  rating_desc: [{ rating: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  rating_asc: [{ rating: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
};

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restaurants: RestaurantsService,
    private readonly access: ReviewAccess,
    private readonly clock: Clock,
  ) {}

  // GET /restaurants/{placeId}/reviews (공개). photo = 사진 있는 리뷰만 최신순
  list(placeId: string, query: ReviewListQueryDto, viewerId?: string) {
    const sort = query.sort ?? 'recent';
    return this.page(
      {
        placeId,
        deletedAt: null,
        ...(sort === 'photo' && { photos: { some: {} } }),
      },
      ORDER_BY[sort],
      query,
      viewerId,
    );
  }

  // GET /me/reviews
  mine(userId: string, query: ReviewPageQueryDto) {
    return this.page(
      { userId, deletedAt: null },
      ORDER_BY.recent,
      query,
      userId,
    );
  }

  // GET /restaurants/{placeId}/review-form: 이 식당 리뷰에 자주 나온 메뉴 → 식당 카테고리에 맞는 메뉴 마스터
  async form(placeId: string, userId?: string) {
    const place = await this.findPlace(placeId, userId);
    const [reviews, menus] = await Promise.all([
      this.prisma.review.findMany({
        where: { placeId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { menus: true },
      }),
      this.prisma.menu.findMany({
        where: { visible: true },
        orderBy: { name: 'asc' },
        select: { kakaoKeyword: true, kakaoCategory: true },
      }),
    ]);
    const counts = new Map<string, number>();
    for (const m of reviews.flatMap((r) => r.menus)) {
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    const fromReviews = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([m]) => m);
    const fromMaster = menus
      .filter((m) => place.categoryPath.includes(m.kakaoCategory))
      .map((m) => m.kakaoKeyword);
    return {
      menus: [...new Set([...fromReviews, ...fromMaster])].slice(
        0,
        FORM_MENU_LIMIT,
      ),
      tags: REVIEW_TAGS,
    };
  }

  // POST /restaurants/{placeId}/reviews. 한 사용자 · 식당에 하루(KST) 한 개
  async create(userId: string, placeId: string, dto: ReviewInputDto) {
    await this.access.assertCanWrite(userId);
    const fields = normalizeReview({
      rating: dto.rating,
      menus: dto.menus ?? [],
      tags: dto.tags ?? [],
      content: dto.content ?? null,
      photoIds: dto.photoIds ?? [],
    });
    const place = await this.findPlace(placeId, userId);
    const id = await this.prisma.$transaction(async (tx) => {
      // 같은 사용자 · 식당의 동시 등록을 한 줄로 세운다 (하루 한 개 확인이 겹치지 않게)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`review:${userId}:${placeId}`}))`;
      const already = await tx.review.count({
        where: {
          userId,
          placeId,
          deletedAt: null,
          createdAt: { gte: this.todayStartKst() },
        },
      });
      if (already) throw new AppException('REVIEW_DAILY_LIMIT');
      const review = await tx.review.create({
        data: {
          userId,
          placeId,
          placeName: place.name,
          rating: fields.rating,
          menus: fields.menus,
          tags: fields.tags,
          content: fields.content,
        },
      });
      await this.attachPhotos(tx, userId, review.id, fields.photoIds);
      await this.recalculate(tx, placeId, fields.menus);
      return review.id;
    });
    return this.result(id, userId);
  }

  // PATCH /reviews/{id}: 보낸 항목만 바꾼다. photoIds를 보내면 그 순서 · 목록으로 바꾼다
  async update(userId: string, id: string, dto: ReviewPatchDto) {
    const current = await this.ownReview(userId, id);
    await this.access.assertCanWrite(userId);
    const fields: ReviewFields = normalizeReview({
      rating: dto.rating ?? current.rating,
      menus: dto.menus ?? current.menus,
      tags: dto.tags ?? current.tags,
      content: dto.content === undefined ? current.content : dto.content,
      photoIds: dto.photoIds ?? current.photos.map((p) => p.id),
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.review.update({
        where: { id },
        data: {
          rating: fields.rating,
          menus: fields.menus,
          tags: fields.tags,
          content: fields.content,
        },
      });
      if (dto.photoIds) {
        await this.attachPhotos(tx, userId, id, fields.photoIds);
      }
      await this.recalculate(tx, current.placeId, [
        ...current.menus,
        ...fields.menus,
      ]);
    });
    return this.result(id, userId);
  }

  // DELETE /reviews/{id}: 기록은 남기고(deletedAt) 목록 · 집계에서 뺀다
  async remove(userId: string, id: string) {
    const current = await this.ownReview(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.review.update({
        where: { id },
        data: { deletedAt: this.clock.now() },
      });
      await this.recalculate(tx, current.placeId, current.menus);
    });
  }

  // POST /reviews/{id}/reports: 같은 리뷰는 한 사람이 한 번, 자기 리뷰는 안 된다
  async report(userId: string, id: string, dto: ReviewReportDto) {
    const review = await this.prisma.review.findFirst({
      where: { id, deletedAt: null },
      select: { userId: true },
    });
    if (!review) throw new AppException('NOT_FOUND', '리뷰를 찾을 수 없어요.');
    if (review.userId === userId) {
      throw new AppException('FORBIDDEN', '내 리뷰는 신고할 수 없어요.');
    }
    await this.access.assertCanWrite(userId);
    try {
      await this.prisma.reviewReport.create({
        data: {
          reviewId: id,
          reporterId: userId,
          reason: dto.reason,
          memo: dto.memo?.trim() || null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppException('ALREADY_REPORTED');
      }
      throw error;
    }
  }

  // ---------- 내부 ----------

  private async page(
    where: Prisma.ReviewWhereInput,
    orderBy: Prisma.ReviewOrderByWithRelationInput[],
    query: ReviewPageQueryDto,
    viewerId: string | undefined,
  ) {
    const offset = decodeOffset(query.cursor);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const rows = await this.prisma.review.findMany({
      where,
      orderBy,
      skip: offset,
      take: limit + 1,
      include: REVIEW_INCLUDE,
    });
    return {
      items: rows.slice(0, limit).map((r) => toReview(r, viewerId)),
      nextCursor:
        rows.length > limit
          ? Buffer.from(JSON.stringify({ o: offset + limit })).toString(
              'base64url',
            )
          : null,
    };
  }

  private async findPlace(placeId: string, userId?: string) {
    const place = await this.restaurants.findPlace(placeId, userId);
    if (!place) {
      throw new AppException(
        'NOT_FOUND',
        '식당을 찾을 수 없어요. 목록에서 다시 열어 주세요.',
      );
    }
    return place;
  }

  private async ownReview(userId: string, id: string) {
    const review = await this.prisma.review.findFirst({
      where: { id, deletedAt: null },
      include: { photos: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!review) throw new AppException('NOT_FOUND', '리뷰를 찾을 수 없어요.');
    if (review.userId !== userId) {
      throw new AppException('FORBIDDEN', '내 리뷰만 고칠 수 있어요.');
    }
    return review;
  }

  // 사진은 내가 올린(업로드까지 끝난) 것이고, 다른 리뷰에 붙지 않은 것만. 목록에서 빠진 사진은 떼어 낸다
  private async attachPhotos(
    tx: Tx,
    userId: string,
    reviewId: string,
    photoIds: string[],
  ) {
    const usable = await tx.reviewPhoto.count({
      where: {
        id: { in: photoIds },
        userId,
        url: { not: '' },
        OR: [{ reviewId: null }, { reviewId }],
      },
    });
    if (usable !== photoIds.length) {
      throw new AppException('VALIDATION_FAILED', '사진을 다시 올려 주세요.', {
        fields: { photoIds: '사진을 다시 올려 주세요.' },
      });
    }
    await tx.reviewPhoto.updateMany({
      where: { reviewId, id: { notIn: photoIds } },
      data: { reviewId: null },
    });
    for (const [i, id] of photoIds.entries()) {
      await tx.reviewPhoto.update({
        where: { id },
        data: { reviewId, sortOrder: i },
      });
    }
  }

  // 식당 별점 · 리뷰 수, 그리고 리뷰 "먹은 메뉴"에 나온 메뉴 마스터의 근거(먹은 사람 수)를 다시 센다
  private async recalculate(tx: Tx, placeId: string, menuNames: string[]) {
    const agg = await tx.review.aggregate({
      where: { placeId, deletedAt: null },
      _sum: { rating: true },
      _count: { _all: true },
    });
    const stats = {
      ratingSum: agg._sum.rating ?? 0,
      reviewCount: agg._count._all,
    };
    await tx.placeStats.upsert({
      where: { placeId },
      create: { placeId, ...stats },
      update: stats,
    });

    const names = [...new Set(menuNames)];
    if (!names.length) return;
    const menus = await tx.menu.findMany({
      where: {
        OR: [{ name: { in: names } }, { kakaoKeyword: { in: names } }],
      },
      select: { id: true, name: true, kakaoKeyword: true },
    });
    for (const menu of menus) {
      const eaters = await tx.review.findMany({
        where: {
          placeId,
          deletedAt: null,
          menus: { hasSome: [menu.name, menu.kakaoKeyword] },
        },
        distinct: ['userId'],
        select: { userId: true },
      });
      await tx.placeMenuEvidence.upsert({
        where: { placeId_menuId: { placeId, menuId: menu.id } },
        create: { placeId, menuId: menu.id, reviewCount: eaters.length },
        update: { reviewCount: eaters.length },
      });
    }
  }

  private async result(id: string, userId: string) {
    const review = await this.prisma.review.findUniqueOrThrow({
      where: { id },
      include: REVIEW_INCLUDE,
    });
    const stats = await this.prisma.placeStats.findUnique({
      where: { placeId: review.placeId },
    });
    const count = stats?.reviewCount ?? 0;
    return {
      review: toReview(review, userId),
      placeStats: {
        rating: count ? Math.round((stats!.ratingSum / count) * 10) / 10 : null,
        reviewCount: count,
      },
    };
  }

  // 오늘(KST) 0시
  private todayStartKst(): Date {
    const kst = new Date(this.clock.now().getTime() + KST_OFFSET_MS);
    return new Date(
      Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) -
        KST_OFFSET_MS,
    );
  }
}
