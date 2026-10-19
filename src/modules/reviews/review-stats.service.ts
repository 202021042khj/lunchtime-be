import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

// 리뷰가 바뀔 때(등록 · 수정 · 삭제, 어드민 신고 삭제) 같은 트랜잭션 안에서 부른다.
// 더하고 빼지 않고 다시 세서, 수정 · 삭제가 섞여도 어긋나지 않는다
@Injectable()
export class ReviewStatsService {
  // 식당 별점 · 리뷰 수, 그리고 리뷰 "먹은 메뉴"에 나온 메뉴 마스터의 근거(먹은 사람 수)를 다시 센다
  async recalculate(tx: Tx, placeId: string, menuNames: string[]) {
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
}
