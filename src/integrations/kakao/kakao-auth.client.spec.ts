import type { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/errors/app.exception.js';
import type { Env } from '../../config/env.js';
import { KakaoAuthClient } from './kakao-auth.client.js';

function makeClient(values: Partial<Env> = {}) {
  const env: Partial<Env> = {
    KAKAO_REST_KEY: 'rest-key',
    KAKAO_CLIENT_SECRET: '',
    KAKAO_ADMIN_KEY: '',
    ...values,
  };
  const config = {
    get: (key: keyof Env) => env[key],
  } as unknown as ConfigService<Env, true>;
  return new KakaoAuthClient(config);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// 카카오에 보낸 form 본문
const formOf = (init: RequestInit | undefined) => init?.body as URLSearchParams;

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as AppException).code;
  }
  return 'resolved';
}

describe('KakaoAuthClient', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('인가 코드 교환: REST 키 · redirect_uri · code를 form으로 보낸다 (secret 없으면 빼고)', async () => {
    fetchMock.mockResolvedValue(json(200, { access_token: 'AT' }));
    await expect(
      makeClient().exchangeCode('CODE', 'http://localhost:3000/cb'),
    ).resolves.toBe('AT');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://kauth.kakao.com/oauth/token');
    const body = formOf(init);
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'rest-key',
      redirect_uri: 'http://localhost:3000/cb',
      code: 'CODE',
    });
  });

  it('Client Secret이 있으면 같이 보낸다', async () => {
    fetchMock.mockResolvedValue(json(200, { access_token: 'AT' }));
    await makeClient({ KAKAO_CLIENT_SECRET: 'sec' }).exchangeCode(
      'CODE',
      'http://x',
    );
    expect(formOf(fetchMock.mock.calls[0][1]).get('client_secret')).toBe('sec');
  });

  it('프로필: 확인된 이메일만 쓴다', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        id: 12345,
        kakao_account: {
          profile: { nickname: '지민' },
          email: 'a@kakao.com',
          is_email_valid: true,
          is_email_verified: true,
        },
      }),
    );
    await expect(makeClient().me('AT')).resolves.toEqual({
      id: '12345',
      nickname: '지민',
      email: 'a@kakao.com',
    });

    fetchMock.mockResolvedValueOnce(
      json(200, {
        id: 1,
        kakao_account: {
          email: 'b@kakao.com',
          is_email_valid: true,
          is_email_verified: false,
        },
      }),
    );
    await expect(makeClient().me('AT')).resolves.toEqual({
      id: '1',
      nickname: null,
      email: null,
    });
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      Authorization: 'Bearer AT',
    });
  });

  it('카카오 4xx(코드 · 토큰 무효) → 401 INVALID_CREDENTIALS', async () => {
    fetchMock.mockResolvedValue(
      json(400, { error: 'invalid_grant', error_code: 'KOE320' }),
    );
    expect(await codeOf(makeClient().exchangeCode('bad', 'http://x'))).toBe(
      'INVALID_CREDENTIALS',
    );
    fetchMock.mockResolvedValue(json(401, { code: -401 }));
    expect(await codeOf(makeClient().tokenInfo('bad'))).toBe(
      'INVALID_CREDENTIALS',
    );
  });

  it('카카오 5xx · 네트워크 오류 → 502 UPSTREAM_UNAVAILABLE', async () => {
    fetchMock.mockResolvedValue(json(503, {}));
    expect(await codeOf(makeClient().tokenInfo('AT'))).toBe(
      'UPSTREAM_UNAVAILABLE',
    );
    fetchMock.mockRejectedValue(new Error('timeout'));
    expect(await codeOf(makeClient().me('AT'))).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('연결 끊기: 어드민 키가 없으면 부르지 않고, 있으면 KakaoAK로 회원번호를 보낸다', async () => {
    await expect(makeClient().unlink('12345')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(json(200, { id: 12345 }));
    await expect(
      makeClient({ KAKAO_ADMIN_KEY: 'admin' }).unlink('12345'),
    ).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://kapi.kakao.com/v1/user/unlink');
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      'KakaoAK admin',
    );
    expect(Object.fromEntries(formOf(init))).toEqual({
      target_id_type: 'user_id',
      target_id: '12345',
    });
  });
});
