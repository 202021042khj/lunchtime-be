// 식당 목록 규칙 (순수 함수). API.md "식당 · 찜"과 프론트 목(handlers.ts)의 규칙을 옮겼다

export interface LatLng {
  lat: number;
  lng: number;
}

export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// API.md: 거리 ÷ 80m 어림값, 최소 1분
export const walkMinutes = (meters: number) =>
  Math.max(1, Math.round(meters / 80));

// ---------- 영업시간 (광고 · 입점 식당만) ----------

export interface Hours {
  open: string; // "11:00"
  close: string;
  break: [string, string] | null;
  closedDays: string[]; // "sun" 등
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// 지금(KST) 영업 중인지. 휴무일 · 브레이크면 false
export function isOpenNow(hours: Hours, now: Date): boolean {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  if (hours.closedDays.includes(DAYS[kst.getUTCDay()])) return false;
  const t = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  if (t < minutesOf(hours.open) || t >= minutesOf(hours.close)) return false;
  if (
    hours.break &&
    t >= minutesOf(hours.break[0]) &&
    t < minutesOf(hours.break[1])
  )
    return false;
  return true;
}

// ---------- 메뉴 근거 (menuId 검색) ----------

export type EvidenceType = 'owner' | 'review' | 'name' | 'keyword' | 'category';

export interface MenuEvidence {
  type: EvidenceType;
  // review일 때 먹은 사람 수
  count: number | null;
  // owner · review = 확인된 근거, 나머지는 추정
  verified: boolean;
  label: string;
}

export interface EvidenceMenu {
  name: string;
  kakaoKeyword: string;
  kakaoCategory: string;
}

// 받침이 있으면 "을", 없으면 "를" (순두부찌개를 · 국밥을)
export function objectParticle(word: string): '을' | '를' {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return '를';
  return code % 28 === 0 ? '를' : '을';
}

// 식당 이름에 들어 있으면 "이름 일치"로 보는 말: 검색 키워드, 메뉴 이름, 키워드에서 흔한 꼬리말을 뗀 것(순두부찌개 → 순두부)
const SUFFIXES = ['찌개', '국밥', '볶음', '구이', '전골', '덮밥'];
export function nameAliases(menu: EvidenceMenu): string[] {
  const aliases = new Set([menu.kakaoKeyword, menu.name.replace(/\s/g, '')]);
  for (const suffix of SUFFIXES) {
    if (
      menu.kakaoKeyword.endsWith(suffix) &&
      menu.kakaoKeyword.length - suffix.length >= 2
    ) {
      aliases.add(menu.kakaoKeyword.slice(0, -suffix.length));
    }
  }
  return [...aliases];
}

// 확인된 근거(리뷰 · 사장님)가 없으면 이름 → 키워드 → 카테고리 순으로 추정한다.
// found: 카카오 키워드 검색에서 나왔는지(keyword), 카테고리 검색에서만 나왔는지(category)
export function menuEvidence(
  place: { name: string },
  menu: EvidenceMenu,
  found: 'keyword' | 'category',
  stored: { reviewCount: number; ownerRegistered: boolean } | undefined,
): MenuEvidence {
  if (stored?.ownerRegistered) {
    return {
      type: 'owner',
      count: null,
      verified: true,
      label: '사장님이 등록한 대표 메뉴예요',
    };
  }
  if (stored && stored.reviewCount > 0) {
    return {
      type: 'review',
      count: stored.reviewCount,
      verified: true,
      label: `리뷰 ${stored.reviewCount}명이 ${menu.kakaoKeyword}${objectParticle(menu.kakaoKeyword)} 먹었어요`,
    };
  }
  const compact = place.name.replace(/\s/g, '');
  if (nameAliases(menu).some((a) => compact.includes(a))) {
    return {
      type: 'name',
      count: null,
      verified: false,
      label: '식당 이름으로 찾은 식당',
    };
  }
  if (found === 'keyword') {
    return {
      type: 'keyword',
      count: null,
      verified: false,
      label: `카카오 검색에서 '${menu.kakaoKeyword}'로 나온 식당`,
    };
  }
  return {
    type: 'category',
    count: null,
    verified: false,
    label: `카테고리(${menu.kakaoCategory})로 찾은 식당`,
  };
}

// API.md 정렬 단계: 광고 0 → 확인된 근거 1 → 이름 2 → 키워드 3(카테고리 불일치는 4) → 카테고리만 5
export function evidenceTier(
  r: {
    sponsored: boolean;
    categoryPath: string;
    menuEvidence: MenuEvidence | null;
  },
  menu: EvidenceMenu,
): number {
  if (r.sponsored) return 0;
  const e = r.menuEvidence;
  if (!e) return 9;
  if (e.verified) return 1;
  if (e.type === 'name') return 2;
  if (e.type === 'keyword')
    return r.categoryPath.includes(menu.kakaoCategory) ? 3 : 4;
  return 5;
}

export const CATEGORY_ONLY_LIMIT = 5;
// 메뉴 제보("안 팔아요")가 이만큼 쌓이고 확인된 근거가 없으면 뺀다
export const MENU_REPORT_HIDE_THRESHOLD = 3;
