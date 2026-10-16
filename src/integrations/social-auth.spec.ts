import type { ConfigService } from '@nestjs/config';
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  SignJWT,
  type CryptoKey,
  type JWK,
} from 'jose';
import type { AppException } from '../common/errors/app.exception.js';
import type { Env } from '../config/env.js';
import { AppleAuthClient } from './apple/apple-auth.client.js';
import { GoogleAuthClient } from './google/google-auth.client.js';

// 회사 공개키 대신 테스트에서 만든 키로 서명 · 검증한다
const KID = 'test-key';
let signingKey: CryptoKey;
let publicJwk: JWK;
let otherKey: CryptoKey;

const configOf = (values: Partial<Env>) =>
  ({ get: (key: keyof Env) => values[key] ?? '' }) as unknown as ConfigService<
    Env,
    true
  >;

async function idToken(
  claims: Record<string, unknown>,
  opts: { key?: CryptoKey; exp?: string } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '10m')
    .sign(opts.key ?? signingKey);
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as AppException).code;
  }
  return 'resolved';
}

class TestGoogle extends GoogleAuthClient {
  useLocalKeys() {
    this.jwks = createLocalJWKSet({ keys: [publicJwk] });
    return this;
  }
}

class TestApple extends AppleAuthClient {
  useLocalKeys() {
    this.jwks = createLocalJWKSet({ keys: [publicJwk] });
    return this;
  }
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256' };
  otherKey = (await generateKeyPair('RS256')).privateKey;
});

describe('GoogleAuthClient.verifyIdToken', () => {
  const google = () =>
    new TestGoogle(
      configOf({ GOOGLE_CLIENT_IDS: 'web-id, ios-id' }),
    ).useLocalKeys();
  const base = {
    iss: 'https://accounts.google.com',
    aud: 'web-id',
    sub: 'g-123',
  };

  it('우리 client ID로 발급된 토큰 → 프로필 (확인된 이메일만)', async () => {
    const token = await idToken({
      ...base,
      name: '하준',
      email: 'a@gmail.com',
      email_verified: true,
    });
    await expect(google().verifyIdToken(token)).resolves.toEqual({
      id: 'g-123',
      name: '하준',
      email: 'a@gmail.com',
    });
    const unverified = await idToken({
      ...base,
      email: 'b@gmail.com',
      email_verified: false,
    });
    expect((await google().verifyIdToken(unverified)).email).toBeNull();
  });

  it('앱용 client ID(두 번째)도 받는다', async () => {
    const token = await idToken({ ...base, aud: 'ios-id' });
    expect((await google().verifyIdToken(token)).id).toBe('g-123');
  });

  it('다른 앱 · 다른 발급자 · 위조 서명 · 만료 → 401', async () => {
    expect(
      await codeOf(
        google().verifyIdToken(await idToken({ ...base, aud: 'other' })),
      ),
    ).toBe('INVALID_CREDENTIALS');
    expect(
      await codeOf(
        google().verifyIdToken(
          await idToken({ ...base, iss: 'https://evil.example' }),
        ),
      ),
    ).toBe('INVALID_CREDENTIALS');
    expect(
      await codeOf(
        google().verifyIdToken(await idToken(base, { key: otherKey })),
      ),
    ).toBe('INVALID_CREDENTIALS');
    expect(
      await codeOf(google().verifyIdToken(await idToken(base, { exp: '-1m' }))),
    ).toBe('INVALID_CREDENTIALS');
  });

  it('설정이 없으면 configured=false', () => {
    expect(new GoogleAuthClient(configOf({})).configured).toBe(false);
  });
});

describe('AppleAuthClient', () => {
  let pkcs8: string;
  let applePublic: CryptoKey;

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    pkcs8 = await exportPKCS8(pair.privateKey);
    applePublic = pair.publicKey;
  });

  const apple = (values: Partial<Env> = {}) =>
    new TestApple(
      configOf({
        APPLE_SERVICE_ID: 'dev.lunchtime.web',
        APPLE_BUNDLE_ID: 'dev.lunchtime.app',
        APPLE_TEAM_ID: 'TEAM123',
        APPLE_KEY_ID: 'KEY123',
        // .env에는 줄바꿈을 \n 글자로 쓴다
        APPLE_PRIVATE_KEY: pkcs8.replace(/\n/g, '\\n'),
        ...values,
      }),
    ).useLocalKeys();
  const base = {
    iss: 'https://appleid.apple.com',
    aud: 'dev.lunchtime.web',
    sub: 'a-001',
  };

  it('ID 토큰: Service ID · Bundle ID 둘 다 받고, email_verified "true" 문자열도 인정', async () => {
    const web = await idToken({
      ...base,
      email: 'x@privaterelay.appleid.com',
      email_verified: 'true',
    });
    await expect(apple().verifyIdToken(web)).resolves.toEqual({
      id: 'a-001',
      email: 'x@privaterelay.appleid.com',
    });
    const app = await idToken({ ...base, aud: 'dev.lunchtime.app' });
    expect((await apple().verifyIdToken(app)).id).toBe('a-001');
  });

  it('ID 토큰: 다른 앱 · 위조 → 401', async () => {
    expect(
      await codeOf(
        apple().verifyIdToken(await idToken({ ...base, aud: 'other' })),
      ),
    ).toBe('INVALID_CREDENTIALS');
    expect(
      await codeOf(
        apple().verifyIdToken(await idToken(base, { key: otherKey })),
      ),
    ).toBe('INVALID_CREDENTIALS');
  });

  it('client_secret: .p8 키로 ES256 서명, iss=Team ID · sub=Service ID · aud=애플 · kid=Key ID', async () => {
    const secret = await apple().clientSecret();
    expect(decodeProtectedHeader(secret)).toMatchObject({
      alg: 'ES256',
      kid: 'KEY123',
    });
    const { payload } = await jwtVerify(secret, applePublic, {
      issuer: 'TEAM123',
      audience: 'https://appleid.apple.com',
    });
    expect(payload.sub).toBe('dev.lunchtime.web');
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(300);
  });

  it('키 정보가 하나라도 없으면 configured=false', () => {
    expect(apple().configured).toBe(true);
    expect(apple({ APPLE_PRIVATE_KEY: '' }).configured).toBe(false);
  });

  describe('애플 서버 호출', () => {
    const fetchMock = vi.fn<typeof fetch>();
    beforeEach(() => {
      fetchMock.mockReset();
      vi.stubGlobal('fetch', fetchMock);
    });
    afterAll(() => vi.unstubAllGlobals());

    it('코드 교환 → id_token + refresh_token, 요청에 client_secret JWT', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ id_token: 'ID', refresh_token: 'RT' }), {
          status: 200,
        }),
      );
      await expect(
        apple().exchangeCode('CODE', 'https://x/cb'),
      ).resolves.toEqual({
        idToken: 'ID',
        refreshToken: 'RT',
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://appleid.apple.com/auth/token');
      const form = init?.body as URLSearchParams;
      expect(form.get('client_id')).toBe('dev.lunchtime.web');
      expect(form.get('client_secret')?.split('.')).toHaveLength(3);
    });

    it('토큰 폐기 → /auth/revoke, 애플 4xx → 401 · 5xx → 502', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
      await apple().revoke('RT');
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://appleid.apple.com/auth/revoke',
      );
      expect(
        (fetchMock.mock.calls[0][1]!.body as URLSearchParams).get('token'),
      ).toBe('RT');

      fetchMock.mockResolvedValueOnce(
        new Response('{"error":"invalid_grant"}', { status: 400 }),
      );
      expect(await codeOf(apple().exchangeCode('bad', 'https://x/cb'))).toBe(
        'INVALID_CREDENTIALS',
      );
      fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
      expect(await codeOf(apple().exchangeCode('c', 'https://x/cb'))).toBe(
        'UPSTREAM_UNAVAILABLE',
      );
    });
  });
});
