import { EMPTY_PREFERENCES } from '../preferences/taste-scoring.js';
import {
  dailyJitter,
  describe as describeMenu,
  personalReasons,
  popularReasons,
  weatherTags,
} from './recommendation-rules.js';

const w = (
  condition: 'clear' | 'cloudy' | 'rain' | 'snow' | 'sleet',
  tempC: number,
) => ({
  tempC,
  condition,
  label: '',
  highC: null,
  lowC: null,
});
const sundubu = {
  id: 'm_12',
  name: '얼큰 순두부찌개',
  cuisine: '한식',
  tastes: ['매운맛', '국물'],
  spiceLevel: 3,
  weathers: ['cold', 'rain'],
};
const sushi = {
  id: 'm_9',
  name: '초밥',
  cuisine: '일식',
  tastes: ['담백'],
  spiceLevel: 0,
  weathers: ['clear', 'hot'],
};

describe('weatherTags', () => {
  it('비 · 눈은 기온과 함께, 맑음은 기온 태그가 없을 때만', () => {
    expect(weatherTags(w('rain', 10))).toEqual(['rain', 'cold']);
    expect(weatherTags(w('sleet', 1))).toEqual(['rain', 'snow', 'cold']);
    expect(weatherTags(w('clear', 18))).toEqual(['clear']);
    expect(weatherTags(w('clear', 30))).toEqual(['hot']);
    expect(weatherTags(w('cloudy', 18))).toEqual([]);
    expect(weatherTags(null)).toEqual([]);
  });
});

describe('추천 이유', () => {
  it('날씨 → 맛 → 제외 (목 예시와 같은 모양)', () => {
    const prefs = {
      ...EMPTY_PREFERENCES,
      dislikedIngredients: ['오이', '고수'],
      spiceLevel: 3,
    };
    expect(personalReasons(sundubu, prefs, ['cold'])).toEqual([
      { type: 'weather', label: '쌀쌀한 날씨' },
      { type: 'taste', label: '매운맛 좋아함' },
      { type: 'excluded', label: '오이·고수 제외' },
    ]);
  });

  it('좋아하는 종류, 알레르기는 짧은 이름, 3개 넘으면 "등"', () => {
    const prefs = {
      ...EMPTY_PREFERENCES,
      dislikedIngredients: ['오이'],
      allergies: ['갑각류 (새우·게)', '땅콩'],
      favoriteCuisines: ['일식'],
    };
    expect(personalReasons(sushi, prefs, [])).toEqual([
      { type: 'taste', label: '일식 좋아함' },
      { type: 'excluded', label: '오이·갑각류 등 제외' },
    ]);
  });

  it('인기 모드: 순위 + 어울리는 날씨', () => {
    expect(popularReasons(sushi, 2, ['clear'])).toEqual([
      { type: 'popular', label: '이 근처 인기 2위' },
      { type: 'weather', label: '맑은 날씨' },
    ]);
  });
});

describe('추천 설명', () => {
  it('날씨가 맞으면 날씨 문장, 아니면 맛 · 기본', () => {
    expect(describeMenu(sundubu, ['cold'])).toBe(
      '쌀쌀한 날씨엔 뜨끈한 국물이 최고예요.',
    );
    expect(describeMenu(sundubu, ['hot'])).toBe(
      '칼칼한 매운맛이 당기는 날이에요.',
    );
    expect(describeMenu(sushi, ['clear'])).toBe(
      '맑은 날엔 가볍고 깔끔한 한 끼.',
    );
    expect(describeMenu(sushi, [])).toBe('오늘 점심은 초밥 어때요?');
  });
});

describe('dailyJitter', () => {
  it('같은 날 · 사용자 · 메뉴면 같고, 날이 바뀌면 달라진다', () => {
    const a = dailyJitter('m_12', '20261019', 'u1');
    expect(dailyJitter('m_12', '20261019', 'u1')).toBe(a);
    expect(dailyJitter('m_12', '20261020', 'u1')).not.toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
  });
});
