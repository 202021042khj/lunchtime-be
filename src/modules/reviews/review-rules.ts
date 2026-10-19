import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppException } from '../../common/errors/app.exception.js';

// API.md 리뷰 규칙
export const REVIEW_LIMITS = {
  menus: 10,
  tags: 10,
  itemLength: 20,
  content: 500,
  photos: 5,
} as const;

// 리뷰 쓰기 "좋았던 점" 태그 (이 목록 밖의 태그는 받지 않는다)
export const REVIEW_TAGS = [
  '국물이 진해요',
  '양이 많아요',
  '빨리 나와요',
  '가성비 좋아요',
  '친절해요',
  '혼밥하기 좋아요',
  '매장이 깨끗해요',
];

export interface ReviewFields {
  rating: number;
  menus: string[];
  tags: string[];
  content: string | null;
  photoIds: string[];
}

const fail = (field: string, message: string): never => {
  throw new AppException('VALIDATION_FAILED', message, {
    fields: { [field]: message },
  });
};

// 앞뒤 공백 · 빈 값 · 중복을 정리하고 개수 · 길이를 확인한다
function cleanList(list: string[], field: string, max: number): string[] {
  const items = [...new Set(list.map((v) => v.trim()).filter(Boolean))];
  if (items.length > max) fail(field, `${max}개까지 고를 수 있어요.`);
  if (items.some((v) => v.length > REVIEW_LIMITS.itemLength)) {
    fail(field, `${REVIEW_LIMITS.itemLength}자까지 쓸 수 있어요.`);
  }
  return items;
}

// 등록 · 수정 공통. 형식(DTO)을 통과한 값을 리뷰 규칙으로 확인 · 정리한다
export function normalizeReview(input: ReviewFields): ReviewFields {
  const content = input.content?.trim() || null;
  if (content && content.length > REVIEW_LIMITS.content) {
    throw new AppException('REVIEW_TOO_LONG');
  }
  if (input.photoIds.length > REVIEW_LIMITS.photos) {
    throw new AppException('TOO_MANY_PHOTOS');
  }
  if (new Set(input.photoIds).size !== input.photoIds.length) {
    fail('photoIds', '같은 사진이 두 번 들어 있어요.');
  }
  const tags = cleanList(input.tags, 'tags', REVIEW_LIMITS.tags);
  if (tags.some((t) => !REVIEW_TAGS.includes(t))) {
    fail('tags', '목록에 있는 태그만 고를 수 있어요.');
  }
  return {
    rating: input.rating,
    menus: cleanList(input.menus, 'menus', REVIEW_LIMITS.menus),
    tags,
    content,
    photoIds: input.photoIds,
  };
}

// ---------- 사진 업로드 주소 서명 ----------
// 업로드 주소(PUT)는 로그인 헤더 없이 부르므로, 사진 id와 만료 시각을 서명해 주소에 담는다 (미리 서명된 URL과 같은 방식)

export const UPLOAD_URL_TTL_SEC = 10 * 60;

export function signUpload(secret: string, photoId: string, exp: number) {
  return createHmac('sha256', secret)
    .update(`review-photo:${photoId}:${exp}`)
    .digest('base64url');
}

export function verifyUpload(
  secret: string,
  photoId: string,
  exp: number,
  sig: string,
  nowSec: number,
): boolean {
  if (!Number.isInteger(exp) || exp < nowSec) return false;
  const expected = Buffer.from(signUpload(secret, photoId, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
