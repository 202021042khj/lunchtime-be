import {
  EMPTY_PREFERENCES,
  exclusionReason,
  hasTaste,
  matchPercent,
  type TastePreferences,
} from './taste-scoring.js';

const ALLERGENS = new Map([['갑각류 (새우·게)', ['새우', '게', '꽃게']]]);
const sundubu = {
  cuisine: '한식',
  ingredients: ['두부', '바지락', '계란', '고춧가루'],
  spiceLevel: 3,
};
const jjamppong = {
  cuisine: '중식',
  ingredients: ['밀가루면', '오징어', '새우', '홍합'],
  spiceLevel: 3,
};
const pho = {
  cuisine: '아시안',
  ingredients: ['쌀국수면', '소고기', '숙주', '고수'],
  spiceLevel: 1,
};

const prefs = (p: Partial<TastePreferences>): TastePreferences => ({
  ...EMPTY_PREFERENCES,
  ...p,
});

describe('exclusionReason', () => {
  it('못 먹는 재료 → 재료 이름', () => {
    expect(
      exclusionReason(
        pho,
        prefs({ dislikedIngredients: ['오이', '고수'] }),
        ALLERGENS,
      ),
    ).toBe('고수');
  });

  it('알레르기 → 사전의 재료로 판단, "갑각류 알레르기"', () => {
    expect(
      exclusionReason(
        jjamppong,
        prefs({ allergies: ['갑각류 (새우·게)'] }),
        ALLERGENS,
      ),
    ).toBe('갑각류 알레르기');
  });

  it('사전에 없는 알레르기는 이름 그대로 재료로 본다', () => {
    expect(
      exclusionReason(sundubu, prefs({ allergies: ['두부'] }), ALLERGENS),
    ).toBe('두부 알레르기');
  });

  it('맵기 "못 먹어요"(0)면 보통(2) 이상 매운 메뉴 제외', () => {
    expect(exclusionReason(sundubu, prefs({ spiceLevel: 0 }), ALLERGENS)).toBe(
      '매운맛',
    );
    expect(
      exclusionReason(pho, prefs({ spiceLevel: 0 }), ALLERGENS),
    ).toBeNull();
    expect(
      exclusionReason(sundubu, prefs({ spiceLevel: 1 }), ALLERGENS),
    ).toBeNull();
  });
});

describe('matchPercent', () => {
  it('좋아하는 종류 +18, 아니면 -6 / 맵기가 같을수록 높게', () => {
    const liked = matchPercent(
      sundubu,
      prefs({ favoriteCuisines: ['한식'], spiceLevel: 3 }),
      1,
    );
    const notLiked = matchPercent(
      jjamppong,
      prefs({ favoriteCuisines: ['한식'], spiceLevel: 3 }),
      1,
    );
    expect(liked).toBe(98); // 62 + 9 + 18 + 12 = 101 → 98
    expect(notLiked).toBe(77); // 62 + 9 - 6 + 12
    expect(matchPercent(pho, prefs({ spiceLevel: 3 }), 1)).toBe(71); // 62 + 9 + (12 - 12)
  });

  it('가장 나쁜 경우(순위 밖 · 싫어하는 종류 · 맵기 차이 4)도 40 이상', () => {
    const worst = matchPercent(
      { ...sundubu, spiceLevel: 4 },
      prefs({ favoriteCuisines: ['양식'], spiceLevel: 0 }),
      50,
    );
    expect(worst).toBe(44); // 62 + 0 - 6 + (12 - 24)
  });
});

describe('hasTaste', () => {
  it('아무것도 고르지 않으면 false', () => {
    expect(hasTaste(EMPTY_PREFERENCES)).toBe(false);
    expect(hasTaste(prefs({ spiceLevel: 0 }))).toBe(true);
  });
});
