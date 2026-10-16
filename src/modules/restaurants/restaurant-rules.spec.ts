import {
  distanceM,
  evidenceTier,
  isOpenNow,
  menuEvidence,
  nameAliases,
  objectParticle,
  walkMinutes,
} from './restaurant-rules.js';

const sundubu = {
  name: '얼큰 순두부찌개',
  kakaoKeyword: '순두부찌개',
  kakaoCategory: '찌개,전골',
};
const gukbap = {
  name: '순대국밥',
  kakaoKeyword: '국밥',
  kakaoCategory: '국밥',
};

describe('거리 · 걷는 시간', () => {
  it('역삼역 → 강남역 약 750m, 걷기 9분', () => {
    const d = distanceM(
      { lat: 37.5007, lng: 127.0363 },
      { lat: 37.4979, lng: 127.0276 },
    );
    expect(d).toBeGreaterThan(700);
    expect(d).toBeLessThan(850);
    expect(walkMinutes(720)).toBe(9);
    expect(walkMinutes(10)).toBe(1);
  });
});

describe('isOpenNow (KST)', () => {
  const hours = {
    open: '11:00',
    close: '21:00',
    break: ['15:00', '16:30'] as [string, string],
    closedDays: ['sun'],
  };
  // 2026-10-16은 금요일
  const kst = (hhmm: string, date = '2026-10-16') =>
    new Date(`${date}T${hhmm}:00+09:00`);

  it('영업시간 안 · 밖 · 브레이크 · 휴무일', () => {
    expect(isOpenNow(hours, kst('12:00'))).toBe(true);
    expect(isOpenNow(hours, kst('10:59'))).toBe(false);
    expect(isOpenNow(hours, kst('21:00'))).toBe(false);
    expect(isOpenNow(hours, kst('15:30'))).toBe(false);
    expect(isOpenNow(hours, kst('16:30'))).toBe(true);
    expect(isOpenNow(hours, kst('12:00', '2026-10-18'))).toBe(false); // 일요일
  });
});

describe('메뉴 근거', () => {
  it('을/를: 받침 있으면 을', () => {
    expect(objectParticle('국밥')).toBe('을');
    expect(objectParticle('순두부찌개')).toBe('를');
    expect(objectParticle('pho')).toBe('를');
  });

  it('이름 일치용 말: 키워드 꼬리말을 뗀 것도', () => {
    expect(nameAliases(sundubu)).toEqual(
      expect.arrayContaining(['순두부찌개', '얼큰순두부찌개', '순두부']),
    );
  });

  it('사장님 > 리뷰 > 이름 > 키워드 > 카테고리', () => {
    const place = { name: '북창동 순두부' };
    expect(
      menuEvidence(place, sundubu, 'keyword', {
        reviewCount: 3,
        ownerRegistered: true,
      }).type,
    ).toBe('owner');
    const review = menuEvidence({ name: '광화문국밥' }, gukbap, 'keyword', {
      reviewCount: 87,
      ownerRegistered: false,
    });
    expect(review).toEqual({
      type: 'review',
      count: 87,
      verified: true,
      label: '리뷰 87명이 국밥을 먹었어요',
    });
    expect(menuEvidence(place, sundubu, 'keyword', undefined).type).toBe(
      'name',
    );
    expect(
      menuEvidence({ name: '고봉밥상' }, sundubu, 'keyword', undefined),
    ).toMatchObject({
      type: 'keyword',
      verified: false,
      label: "카카오 검색에서 '순두부찌개'로 나온 식당",
    });
    expect(
      menuEvidence({ name: '고봉밥상' }, sundubu, 'category', undefined).label,
    ).toBe('카테고리(찌개,전골)로 찾은 식당');
  });

  it('정렬 단계: 키워드인데 카테고리가 다르면 키워드 단계 맨 뒤(4)', () => {
    const keyword = menuEvidence(
      { name: '고봉밥상' },
      sundubu,
      'keyword',
      undefined,
    );
    const base = { sponsored: false, menuEvidence: keyword };
    expect(
      evidenceTier(
        { ...base, categoryPath: '음식점 > 한식 > 찌개,전골' },
        sundubu,
      ),
    ).toBe(3);
    expect(
      evidenceTier({ ...base, categoryPath: '음식점 > 한식 > 냉면' }, sundubu),
    ).toBe(4);
    expect(
      evidenceTier({ ...base, sponsored: true, categoryPath: '' }, sundubu),
    ).toBe(0);
  });
});
