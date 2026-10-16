// 기상청 단기예보 격자 · 발표 시각 계산 (기상청 단기예보 활용가이드). 프론트 scripts/spike/kma.mjs에서 옮겼다

export interface KmaGrid {
  nx: number;
  ny: number;
}

// 위경도 → 기상청 LCC 격자 (5km)
export function toGrid(lat: number, lng: number): KmaGrid {
  const RE = 6371.00877;
  const GRID = 5.0;
  const SLAT1 = 30.0;
  const SLAT2 = 60.0;
  const OLON = 126.0;
  const OLAT = 38.0;
  const XO = 43;
  const YO = 136;
  const DEG = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEG;
  const slat2 = SLAT2 * DEG;
  const olon = OLON * DEG;
  const olat = OLAT * DEG;
  let sn =
    Math.tan(Math.PI * 0.25 + slat2 * 0.5) /
    Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * DEG * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * DEG - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

export interface KmaBase {
  base_date: string;
  base_time: string;
}

const KST_MS = 9 * 60 * 60 * 1000;
// UTC 시각을 KST 벽시계로 옮긴 Date (getUTC*로 읽는다)
const kst = (now: Date) => new Date(now.getTime() + KST_MS);
const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '');
const hh = (d: Date) => String(d.getUTCHours()).padStart(2, '0');
const minus = (d: Date, minutes: number) =>
  new Date(d.getTime() - minutes * 60 * 1000);

export const kstDate = (now: Date) => ymd(kst(now));

// 초단기실황: 매시 정각 자료, 40분 이후 제공 → 여유 있게 45분 전 시각의 정각
export function ncstBase(now: Date): KmaBase {
  const d = minus(kst(now), 45);
  return { base_date: ymd(d), base_time: `${hh(d)}00` };
}

// 초단기예보: 매시 30분 자료, 45분 이후 제공
export function ultraFcstBase(now: Date): KmaBase {
  const d = minus(kst(now), 45);
  return { base_date: ymd(d), base_time: `${hh(d)}30` };
}

// 오늘 최고 · 최저: 오늘 02시 발표(02:10 이후 제공)에 TMN · TMX가 모두 있다. 그 전이면 어제 23시 발표
export function dailyBase(now: Date): KmaBase {
  const local = kst(now);
  const twoTen = new Date(local);
  twoTen.setUTCHours(2, 10, 0, 0);
  if (local >= twoTen) return { base_date: ymd(local), base_time: '0200' };
  return { base_date: ymd(minus(local, 24 * 60)), base_time: '2300' };
}
