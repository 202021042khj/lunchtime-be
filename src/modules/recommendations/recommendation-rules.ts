import { createHash } from 'node:crypto';
import type { Weather } from '../weather/weather.service.js';
import type { TastePreferences } from '../preferences/taste-scoring.js';

// 추천 규칙 (순수 함수). plan.md "추천 로직"과 프론트 목의 문구를 옮겼다

export type WeatherTag = 'clear' | 'hot' | 'cold' | 'rain' | 'snow';

const TAG_LABEL: Record<WeatherTag, string> = {
  clear: '맑은 날씨',
  hot: '더운 날씨',
  cold: '쌀쌀한 날씨',
  rain: '비 오는 날씨',
  snow: '눈 오는 날씨',
};

// 지금 날씨 → 메뉴 "어울리는 날씨" 값. 비 · 눈은 기온과 함께 붙을 수 있다
export function weatherTags(weather: Weather | null): WeatherTag[] {
  if (!weather) return [];
  const tags: WeatherTag[] = [];
  if (weather.condition === 'rain' || weather.condition === 'sleet')
    tags.push('rain');
  if (weather.condition === 'snow' || weather.condition === 'sleet')
    tags.push('snow');
  if (weather.tempC <= 12) tags.push('cold');
  else if (weather.tempC >= 26) tags.push('hot');
  if (weather.condition === 'clear' && !tags.length) tags.push('clear');
  return tags;
}

export interface RuleMenu {
  id: string;
  name: string;
  cuisine: string;
  tastes: string[];
  spiceLevel: number;
  weathers: string[];
}

// 메뉴가 지금 날씨에 어울리는 첫 태그 (없으면 null)
export const matchedWeather = (
  menu: RuleMenu,
  tags: WeatherTag[],
): WeatherTag | null => tags.find((t) => menu.weathers.includes(t)) ?? null;

export const WEATHER_BONUS = 6;
// 어제까지 3일 안에 추천받은 메뉴는 감점 (오늘 받은 추천은 빼서 새로 고쳐도 오늘 추천이 바뀌지 않게)
export const RECENT_PENALTY = 15;
export const RECENT_DAYS = 3;

// 같은 점수일 때 순서를 정하는 0~1 값: 날짜 · 사용자 · 메뉴로 정해 하루 동안 같고 날마다 달라진다
export function dailyJitter(
  menuId: string,
  day: string,
  userKey: string,
): number {
  const hex = createHash('sha256')
    .update(`${day}:${userKey}:${menuId}`)
    .digest('hex')
    .slice(0, 8);
  return parseInt(hex, 16) / 0xffffffff;
}

type Reason = {
  type: 'weather' | 'taste' | 'excluded' | 'nearby' | 'popular';
  label: string;
};

// "갑각류 (새우·게)" → "갑각류"
const shortAllergy = (a: string) => a.replace(/\s*\(.*\)$/, '');

// 추천 이유 태그 (점수에 기여한 요소). nearby는 식당 수를 알고 나서 붙인다
export function personalReasons(
  menu: RuleMenu,
  prefs: TastePreferences,
  tags: WeatherTag[],
): Reason[] {
  const reasons: Reason[] = [];
  const weather = matchedWeather(menu, tags);
  if (weather) reasons.push({ type: 'weather', label: TAG_LABEL[weather] });
  if (
    prefs.spiceLevel !== null &&
    prefs.spiceLevel >= 3 &&
    menu.spiceLevel >= 3
  ) {
    reasons.push({ type: 'taste', label: '매운맛 좋아함' });
  } else if (prefs.spiceLevel === 0 && menu.spiceLevel === 0) {
    reasons.push({ type: 'taste', label: '순한 맛' });
  } else if (prefs.favoriteCuisines.includes(menu.cuisine)) {
    reasons.push({ type: 'taste', label: `${menu.cuisine} 좋아함` });
  }
  const excluded = [
    ...prefs.dislikedIngredients,
    ...prefs.allergies.map(shortAllergy),
  ];
  if (excluded.length) {
    reasons.push({
      type: 'excluded',
      label: `${excluded.slice(0, 2).join('·')}${excluded.length > 2 ? ' 등' : ''} 제외`,
    });
  }
  return reasons;
}

export function popularReasons(
  menu: RuleMenu,
  rank: number,
  tags: WeatherTag[],
): Reason[] {
  const reasons: Reason[] = [
    { type: 'popular', label: `이 근처 인기 ${rank}위` },
  ];
  const weather = matchedWeather(menu, tags);
  if (weather) reasons.push({ type: 'weather', label: TAG_LABEL[weather] });
  return reasons;
}

export const POPULAR_DESCRIPTION =
  '이 근처에서 점심으로 많이 고른 메뉴예요. 취향을 알려주면 나에게 맞춰 추천해요.';

// 추천 설명 한 문장: 날씨 → 맛 → 기본 순
export function describe(menu: RuleMenu, tags: WeatherTag[]): string {
  const weather = matchedWeather(menu, tags);
  const soup = menu.tastes.some((t) => ['국물', '얼큰'].includes(t));
  if (weather === 'cold') {
    return soup
      ? '쌀쌀한 날씨엔 뜨끈한 국물이 최고예요.'
      : '쌀쌀한 날엔 든든하게 먹어요.';
  }
  if (weather === 'rain') return '비 오는 날엔 따뜻한 한 그릇이 생각나요.';
  if (weather === 'snow') return '눈 오는 날엔 뜨끈한 점심으로 몸을 녹여요.';
  if (weather === 'hot') return '더운 날엔 시원하게 한 그릇 어때요?';
  if (weather === 'clear') return '맑은 날엔 가볍고 깔끔한 한 끼.';
  if (menu.spiceLevel >= 3) return '칼칼한 매운맛이 당기는 날이에요.';
  if (soup) return '따뜻한 국물로 속을 든든하게 채워요.';
  return `오늘 점심은 ${menu.name} 어때요?`;
}
