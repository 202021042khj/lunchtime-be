// API.md: 시각은 ISO 8601 KST(+09:00)로 내보낸다. DB에는 UTC로 저장한다
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function toKstIso(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS)
    .toISOString()
    .replace('Z', '+09:00');
}
