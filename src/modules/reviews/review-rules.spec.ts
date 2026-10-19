import { AppException } from '../../common/errors/app.exception.js';
import { normalizeReview, signUpload, verifyUpload } from './review-rules.js';

const base = { rating: 4, menus: [], tags: [], content: null, photoIds: [] };
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as AppException).code;
  }
  return null;
};

describe('normalizeReview', () => {
  it('공백 · 빈 값 · 중복 정리, 빈 후기는 null', () => {
    expect(
      normalizeReview({
        ...base,
        menus: [' 순두부찌개 ', '순두부찌개', ''],
        tags: ['친절해요'],
        content: '   ',
      }),
    ).toEqual({
      ...base,
      menus: ['순두부찌개'],
      tags: ['친절해요'],
      content: null,
    });
  });

  it('후기 500자 초과 → REVIEW_TOO_LONG, 사진 6장 → TOO_MANY_PHOTOS', () => {
    expect(
      codeOf(() => normalizeReview({ ...base, content: 'a'.repeat(501) })),
    ).toBe('REVIEW_TOO_LONG');
    expect(
      codeOf(() => normalizeReview({ ...base, content: 'a'.repeat(500) })),
    ).toBeNull();
    expect(
      codeOf(() =>
        normalizeReview({
          ...base,
          photoIds: ['1', '2', '3', '4', '5', '6'],
        }),
      ),
    ).toBe('TOO_MANY_PHOTOS');
  });

  it('메뉴 11개 · 목록에 없는 태그 · 같은 사진 두 번 → VALIDATION_FAILED', () => {
    const menus = Array.from({ length: 11 }, (_, i) => `메뉴${i}`);
    expect(codeOf(() => normalizeReview({ ...base, menus }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => normalizeReview({ ...base, tags: ['맛없어요'] }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      codeOf(() => normalizeReview({ ...base, photoIds: ['a', 'a'] })),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('업로드 주소 서명', () => {
  const secret = 'test-secret';
  it('맞는 서명 · 만료 전만 통과', () => {
    const sig = signUpload(secret, 'ph1', 1000);
    expect(verifyUpload(secret, 'ph1', 1000, sig, 999)).toBe(true);
    expect(verifyUpload(secret, 'ph1', 1000, sig, 1001)).toBe(false);
    expect(verifyUpload(secret, 'ph2', 1000, sig, 999)).toBe(false);
    expect(verifyUpload(secret, 'ph1', 2000, sig, 999)).toBe(false);
    expect(verifyUpload('other', 'ph1', 1000, sig, 999)).toBe(false);
    expect(verifyUpload(secret, 'ph1', 1000, 'x', 999)).toBe(false);
  });
});
