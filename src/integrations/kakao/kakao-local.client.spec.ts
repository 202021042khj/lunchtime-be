import type { ConfigService } from '@nestjs/config';
import type { AppException } from '../../common/errors/app.exception.js';
import type { Env } from '../../config/env.js';
import { KakaoLocalClient } from './kakao-local.client.js';

const client = () =>
  new KakaoLocalClient({ get: () => 'rest-key' } as unknown as ConfigService<
    Env,
    true
  >);

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as AppException).code;
  }
  return 'resolved';
}

describe('KakaoLocalClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterAll(() => vi.unstubAllGlobals());

  it('KakaoAK REST 키로 부르고 documents를 돌려준다', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ documents: [{ region_type: 'B' }] })),
    );
    await expect(client().coordToRegion(37.5, 127.03)).resolves.toEqual([
      { region_type: 'B' },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url as string).toBe(
      'https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=127.03&y=37.5',
    );
    expect(init!.headers).toEqual({ Authorization: 'KakaoAK rest-key' });
  });

  it('국내 밖 좌표(400, code -2) → 422 OUT_OF_SERVICE_AREA', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        '{"code":-2,"msg":"The input parameter value is not in the service area"}',
        {
          status: 400,
        },
      ),
    );
    expect(await codeOf(client().coordToRegion(35.68, 139.69))).toBe(
      'OUT_OF_SERVICE_AREA',
    );
  });

  it('키 오류 · 쿼터 · 장애 · 네트워크 → 502', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"errorType":"AccessDeniedError"}', { status: 401 }),
    );
    expect(await codeOf(client().searchKeyword('역삼'))).toBe(
      'UPSTREAM_UNAVAILABLE',
    );
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }));
    expect(await codeOf(client().searchAddress('역삼'))).toBe(
      'UPSTREAM_UNAVAILABLE',
    );
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect(await codeOf(client().searchAddress('역삼'))).toBe(
      'UPSTREAM_UNAVAILABLE',
    );
  });
});
