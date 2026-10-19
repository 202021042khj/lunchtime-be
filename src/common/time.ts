// API.md: 시각은 ISO 8601 KST(+09:00)로 내보낸다. DB에는 UTC로 저장한다
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function toKstIso(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS)
    .toISOString()
    .replace('Z', '+09:00');
}

// 그 시각이 속한 KST 날짜의 0시 (하루 한 개 리뷰, 오늘 접수 · 활성 집계)
export function kstDayStart(date: Date): Date {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) -
      KST_OFFSET_MS,
  );
}

// 그 시각이 속한 KST 달의 1일 0시 (이번 달 처리 집계)
export function kstMonthStart(date: Date): Date {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - KST_OFFSET_MS,
  );
}
