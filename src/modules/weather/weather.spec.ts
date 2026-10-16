import {
  dailyBase,
  ncstBase,
  toGrid,
  ultraFcstBase,
} from '../../integrations/kma/kma-grid.js';
import { parseDaily, parseNow } from './weather.service.js';

describe('기상청 격자 · 발표 시각', () => {
  it('위경도 → 격자 (스파이크에서 확인한 값)', () => {
    expect(toGrid(37.5006, 127.0365)).toEqual({ nx: 61, ny: 125 }); // 역삼동
    expect(toGrid(37.4019, 127.1086)).toEqual({ nx: 62, ny: 123 }); // 판교
    expect(toGrid(36.48, 127.289)).toEqual({ nx: 66, ny: 103 }); // 세종
  });

  it('발표 시각: 45분 전 정각(실황) · 30분(초단기예보), KST 기준', () => {
    const now = new Date('2026-10-16T16:24:00+09:00');
    expect(ncstBase(now)).toEqual({ base_date: '20261016', base_time: '1500' });
    expect(ultraFcstBase(now)).toEqual({
      base_date: '20261016',
      base_time: '1530',
    });
    // 자정 직후는 전날 23시
    expect(ncstBase(new Date('2026-10-17T00:20:00+09:00'))).toEqual({
      base_date: '20261016',
      base_time: '2300',
    });
  });

  it('최고 · 최저: 02:10부터 오늘 02시 발표, 그 전이면 어제 23시 발표', () => {
    expect(dailyBase(new Date('2026-10-16T02:10:00+09:00'))).toEqual({
      base_date: '20261016',
      base_time: '0200',
    });
    expect(dailyBase(new Date('2026-10-16T01:00:00+09:00'))).toEqual({
      base_date: '20261015',
      base_time: '2300',
    });
  });
});

describe('날씨 해석', () => {
  const ncst = (pty: string, t1h = '18.4') => [
    { category: 'T1H', obsrValue: t1h },
    { category: 'PTY', obsrValue: pty },
  ];
  const ultra = [
    { category: 'SKY', fcstDate: '20261016', fcstTime: '1700', fcstValue: '4' },
    { category: 'SKY', fcstDate: '20261016', fcstTime: '1600', fcstValue: '1' },
  ];

  it('강수 없음 → 가장 가까운 시각의 하늘상태, 기온은 반올림', () => {
    expect(parseNow(ncst('0'), ultra)).toEqual({
      tempC: 18,
      condition: 'clear',
      label: '맑음',
    });
  });

  it('강수형태가 있으면 그것 (빗방울 → rain)', () => {
    expect(parseNow(ncst('5'), ultra)).toMatchObject({
      condition: 'rain',
      label: '빗방울',
    });
    expect(parseNow(ncst('3'), ultra)).toMatchObject({
      condition: 'snow',
      label: '눈',
    });
  });

  it('기온이 없으면 502', () => {
    expect(() =>
      parseNow([{ category: 'PTY', obsrValue: '0' }], ultra),
    ).toThrow();
  });

  it('오늘 최고 · 최저만 고르고, 없으면 null', () => {
    const daily = [
      { category: 'TMX', fcstDate: '20261016', fcstValue: '21.0' },
      { category: 'TMN', fcstDate: '20261016', fcstValue: '10.6' },
      { category: 'TMX', fcstDate: '20261017', fcstValue: '25.0' },
    ];
    expect(parseDaily(daily, '20261016')).toEqual({ highC: 21, lowC: 11 });
    expect(parseDaily(daily, '20261018')).toEqual({ highC: null, lowC: null });
  });
});
