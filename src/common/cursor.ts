import { AppException } from './errors/app.exception.js';

// API.md 목록: ?cursor=&limit= (기본 20, 최대 50), 응답 nextCursor (없으면 null).
// 지금은 한 번에 모은 목록을 자르는 경우라 커서에 시작 위치만 담는다
export const DEFAULT_LIMIT = 20;

export function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const { o } = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
      o: unknown;
    };
    if (typeof o === 'number' && Number.isInteger(o) && o >= 0) return o;
  } catch {
    // 아래에서 400
  }
  throw new AppException(
    'VALIDATION_FAILED',
    '목록 위치(cursor)가 올바르지 않아요.',
    {
      fields: { cursor: '목록 위치가 올바르지 않아요.' },
    },
  );
}

export function paginate<T>(
  items: T[],
  cursor: string | undefined,
  limit = DEFAULT_LIMIT,
) {
  const offset = decodeOffset(cursor);
  const page = items.slice(offset, offset + limit);
  const next = offset + limit;
  return {
    items: page,
    nextCursor:
      next < items.length
        ? Buffer.from(JSON.stringify({ o: next })).toString('base64url')
        : null,
  };
}
