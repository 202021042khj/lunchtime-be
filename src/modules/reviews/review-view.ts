import { toKstIso } from '../../common/time.js';
import type { Prisma } from '../../generated/prisma/client.js';

// API.md Review. 식당 상세(최근 리뷰 2개)와 리뷰 API(2단계-4)가 같이 쓴다
export const REVIEW_INCLUDE = {
  user: { select: { id: true, name: true } },
  photos: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.ReviewInclude;

type ReviewRow = Prisma.ReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>;

export function toReview(row: ReviewRow, viewerId: string | undefined) {
  return {
    id: row.id,
    placeId: row.placeId,
    placeName: row.placeName,
    author: { id: row.user.id, name: row.user.name },
    rating: row.rating,
    menus: row.menus,
    tags: row.tags,
    content: row.content,
    photos: row.photos.map((p) => ({ id: p.id, url: p.url })),
    createdAt: toKstIso(row.createdAt),
    isMine: viewerId === row.userId,
  };
}
