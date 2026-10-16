// 취향 점수 · 제외 규칙 (미리보기 · 추천 공용). DB를 모르는 순수 함수로 둔다.
// 규칙은 프론트 목(previewTaste)과 같다

export interface TastePreferences {
  dislikedIngredients: string[];
  allergies: string[];
  // 0 못 먹어요 ~ 4 아주 매운맛, 건너뛰면 null
  spiceLevel: number | null;
  favoriteCuisines: string[];
}

export interface ScoringMenu {
  cuisine: string;
  ingredients: string[];
  spiceLevel: number;
}

export const EMPTY_PREFERENCES: TastePreferences = {
  dislikedIngredients: [],
  allergies: [],
  spiceLevel: null,
  favoriteCuisines: [],
};

// "갑각류 (새우·게)" → "갑각류 알레르기"
const allergyLabel = (allergy: string) =>
  `${allergy.replace(/\s*\(.*\)$/, '')} 알레르기`;

// 이 메뉴를 빼야 하면 짧은 이유(화면에 그대로 보임), 아니면 null.
// allergens: 알레르기 이름 → 메뉴 재료 (재료 사전). 사전에 없는 알레르기는 이름 그대로 재료로 본다
export function exclusionReason(
  menu: ScoringMenu,
  prefs: TastePreferences,
  allergens: ReadonlyMap<string, string[]>,
): string | null {
  const disliked = prefs.dislikedIngredients.find((i) =>
    menu.ingredients.includes(i),
  );
  if (disliked) return disliked;
  const allergy = prefs.allergies.find((a) =>
    (allergens.get(a) ?? [a]).some((i) => menu.ingredients.includes(i)),
  );
  if (allergy) return allergyLabel(allergy);
  // "못 먹어요"인데 보통(2) 이상 매운 메뉴
  if (prefs.spiceLevel === 0 && menu.spiceLevel >= 2) return '매운맛';
  return null;
}

// 취향 매칭 % (40~98). popularityRank: 근처 · 최근 인기 순위(1부터)
export function matchPercent(
  menu: ScoringMenu,
  prefs: TastePreferences,
  popularityRank: number,
): number {
  let score = 62 + Math.max(0, 10 - popularityRank);
  if (prefs.favoriteCuisines.length) {
    score += prefs.favoriteCuisines.includes(menu.cuisine) ? 18 : -6;
  }
  if (prefs.spiceLevel !== null) {
    score += 12 - 6 * Math.abs(menu.spiceLevel - prefs.spiceLevel);
  }
  return Math.max(40, Math.min(98, score));
}

// 취향을 하나라도 골랐는지 (없으면 추천은 popular 모드)
export const hasTaste = (prefs: TastePreferences) =>
  prefs.dislikedIngredients.length > 0 ||
  prefs.allergies.length > 0 ||
  prefs.spiceLevel !== null ||
  prefs.favoriteCuisines.length > 0;
