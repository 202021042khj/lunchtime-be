import { CUISINES } from '../../preferences/preferences.service.js';

// 메뉴 입력 검사 · 정리 (화면 저장과 CSV 가져오기 공용). 문구는 프론트 목과 같다

export const WEATHERS = [
  { value: 'clear', label: '맑음' },
  { value: 'hot', label: '더움' },
  { value: 'cold', label: '쌀쌀함' },
  { value: 'rain', label: '비' },
  { value: 'snow', label: '눈' },
] as const;
export type WeatherValue = (typeof WEATHERS)[number]['value'];

export interface MenuInput {
  name: string;
  cuisine: string;
  category: string;
  imageUrl: string | null;
  ingredients: string[];
  tastes: string[];
  spiceLevel: number;
  weathers: string[];
  kakaoKeyword: string;
  kakaoCategory: string;
  visible: boolean;
}

export interface MenuProblem {
  field: string;
  message: string;
}

// 문제가 있으면 첫 번째 문제, 없으면 null (이름 중복은 DB를 봐야 해서 서비스가 따로)
export function menuProblem(input: Partial<MenuInput>): MenuProblem | null {
  if (!input.name?.trim())
    return { field: 'name', message: '메뉴 이름을 적어 주세요.' };
  if (
    !input.cuisine ||
    !(CUISINES as readonly string[]).includes(input.cuisine)
  ) {
    return { field: 'cuisine', message: '종류를 골라 주세요.' };
  }
  if (!input.kakaoKeyword?.trim()) {
    return {
      field: 'kakaoKeyword',
      message: '카카오 검색 키워드를 적어 주세요.',
    };
  }
  if (!input.ingredients?.some((i) => i.trim())) {
    return {
      field: 'ingredients',
      message: '주요 재료를 하나 이상 넣어 주세요.',
    };
  }
  if (
    input.spiceLevel === undefined ||
    !Number.isInteger(input.spiceLevel) ||
    input.spiceLevel < 0 ||
    input.spiceLevel > 4
  ) {
    return { field: 'spiceLevel', message: '맵기를 골라 주세요.' };
  }
  const unknownWeather = (input.weathers ?? []).find(
    (w) => !WEATHERS.some((x) => x.value === w),
  );
  if (unknownWeather) {
    return {
      field: 'weathers',
      message: `'${unknownWeather}'은(는) 날씨 값에 없어요.`,
    };
  }
  return null;
}

const list = (values: string[] = []) => [
  ...new Set(values.map((v) => v.trim()).filter(Boolean)),
];

export function cleanMenu(input: MenuInput): MenuInput {
  return {
    ...input,
    name: input.name.trim(),
    category: input.category.trim(),
    kakaoKeyword: input.kakaoKeyword.trim(),
    kakaoCategory: input.kakaoCategory.trim(),
    ingredients: list(input.ingredients),
    tastes: list(input.tastes),
    weathers: list(input.weathers),
  };
}

// CSV 한 줄 (따옴표 안 쉼표 · "" 이스케이프)
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

// 양식: 이름,종류,카테고리,재료,맛,맵기,날씨,카카오 키워드,카카오 카테고리,노출
// 목록은 | 로 구분, 날씨는 한글(맑음 …)이나 값 둘 다, "상관없음"은 빈 값, 노출은 Y/N
export function csvRowToMenu(cells: string[]): MenuInput {
  const [
    name,
    cuisine,
    category,
    ingredients,
    tastes,
    spice,
    weathers,
    keyword,
    kakaoCategory,
    visible,
  ] = cells;
  const split = (v = '') =>
    v
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean);
  return {
    name: name ?? '',
    cuisine: cuisine ?? '',
    category: category ?? '',
    imageUrl: null,
    ingredients: split(ingredients),
    tastes: split(tastes),
    spiceLevel: spice?.trim() ? Number(spice) : Number.NaN,
    weathers: split(weathers)
      .filter((w) => w !== '상관없음')
      .map(
        (w) => WEATHERS.find((x) => x.label === w || x.value === w)?.value ?? w,
      ),
    kakaoKeyword: keyword ?? '',
    kakaoCategory: kakaoCategory ?? '',
    visible: (visible ?? 'Y').toUpperCase() !== 'N',
  };
}

export const CSV_HEADER_PREFIX = '이름';
