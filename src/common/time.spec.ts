import { toKstIso } from './time.js';

describe('toKstIso', () => {
  it('UTC 시각을 +09:00 표기로 바꾼다', () => {
    expect(toKstIso(new Date('2026-10-16T02:39:48.106Z'))).toBe(
      '2026-10-16T11:39:48.106+09:00',
    );
  });

  it('날짜가 넘어가는 경우', () => {
    expect(toKstIso(new Date('2026-10-16T20:00:00.000Z'))).toBe(
      '2026-10-17T05:00:00.000+09:00',
    );
  });
});
