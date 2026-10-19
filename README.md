# lunchtime-be

lunchtime(점심 메뉴 추천) 백엔드 API. NestJS + PostgreSQL + Prisma.

- 프론트: `../lunchtime-fe` (Next.js)
- API 계약서: `../lunchtime-fe/API.md`
- 구조 · 규칙: [docs/CONVENTIONS.md](docs/CONVENTIONS.md)
- 단계별 기록: [log.md](log.md)

## 준비물

- Node.js 24, npm 11
- Docker Desktop (PostgreSQL 17 · Redis 7 · 이미지 저장소 RustFS를 docker-compose로 띄운다)

## 처음 실행

```bash
npm install                 # prisma generate도 같이 돈다
cp .env.example .env        # JWT_SECRET · ADMIN_JWT_SECRET은 32자 이상, 서로 다르게
npm run db:up               # Postgres(5432) · Redis(6379) · 이미지 저장소 RustFS(9000)
npm run db:migrate          # 스키마 반영
npm run db:seed             # 메뉴 · 재료 사전 · 테스트 계정
npm run start:dev           # http://localhost:4000
```

- 상태 확인: `GET http://localhost:4000/health` → `{ status: "ok", checks: { db: "up", redis: "up" } }` (하나라도 down이면 503)
- API 문서: http://localhost:4000/docs (OpenAPI JSON: `/docs-json`)
- API는 모두 `/v1` 아래다. 프론트는 `.env.local`에 `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/v1`, `NEXT_PUBLIC_API_MOCK=false`로 연결한다(2단계-6)

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run start:dev` | 개발 서버 (저장하면 다시 시작) |
| `npm run build` / `npm run start:prod` | 빌드 / 빌드 결과 실행 |
| `npm test` | 단위 테스트 (vitest) |
| `npm run test:e2e` | e2e 테스트 (DB 없이 도는 공통 검사) |
| `npm run test:e2e:db` | DB e2e 테스트 (docker DB의 `lunchtime_test` 사용, `npm run db:up` 먼저) |
| `npm run lint` / `npm run format` | oxlint / prettier |
| `npm run db:up` / `npm run db:down` | docker-compose 켜기 / 끄기 (데이터는 볼륨에 남음) |
| `npm run db:migrate` | 스키마 변경 → 마이그레이션 만들고 반영 |
| `npm run db:seed` | 개발용 데이터 넣기 (여러 번 해도 같음) |
| `npm run db:studio` | Prisma Studio (DB를 표로 보기) |

## 개발용 계정 (seed)

| 구분 | 값 |
| --- | --- |
| 이메일 계정 | `test@lunchtime.dev` / `lunch1234` |
| 어드민 | `admin` / `admin1234` + OTP. 개발 환경은 `123456`도 받는다. 실제 OTP는 인증 앱(Google Authenticator 등)에 비밀값 `JBSWY3DPEHPK3PXP`를 등록해서 나온 6자리 |
| 소셜 (개발용) | `POST /v1/auth/login` `{ "provider": "kakao", "providerToken": "dev:아이디:이름" }` |

이메일 가입 인증번호는 메일 대신 개발 서버 로그에 `[가입 인증번호] 이메일 → 123456` 형식으로 나온다.

## 환경 변수

| 이름 | 설명 |
| --- | --- |
| `PORT` | 기본 4000 |
| `CORS_ORIGIN` | 프론트 주소, 쉼표로 여러 개 (기본 `http://localhost:3000`) |
| `API_PUBLIC_URL` | 이 API 서버의 바깥 주소 (기본 `http://localhost:4000`). 리뷰 사진 업로드 주소(`uploadUrl`)를 만들 때 쓴다. 운영은 `https://api.…` |
| `DATABASE_URL` | `postgresql://lunchtime:lunchtime@localhost:5432/lunchtime?schema=public` |
| `REDIS_URL` | `redis://localhost:6379` |
| `JWT_SECRET` / `ADMIN_JWT_SECRET` | 사용자 / 어드민 토큰 서명. 32자 이상, 서로 달라야 함 |
| `KAKAO_REST_KEY` | 카카오 REST 키: 로그인 인가 코드 교환 · 카카오 로컬 검색 |
| `KAKAO_APP_ID` | 카카오 로그인: 토큰이 우리 앱 것인지 확인 (비우면 카카오 로그인 400) |
| `KAKAO_CLIENT_SECRET` / `KAKAO_ADMIN_KEY` | 선택: 콘솔에서 Client Secret을 켰을 때 / 탈퇴 시 카카오 연결 끊기 |
| `GOOGLE_CLIENT_IDS` / `GOOGLE_CLIENT_SECRET` | 구글 로그인: ID 토큰 aud로 받을 client ID(웹이 첫 번째, 앱은 쉼표로) / 웹 코드 교환용 secret |
| `APPLE_SERVICE_ID` · `APPLE_BUNDLE_ID` · `APPLE_TEAM_ID` · `APPLE_KEY_ID` · `APPLE_PRIVATE_KEY` | Apple 로그인 (개발자 계정 준비 후). `.p8` 내용은 줄바꿈을 `\n`으로 |
| `KMA_SERVICE_KEY` / `KMA_BASE_URL` | 기상청 단기예보 (공공데이터포털 일반 인증키, End Point는 비우면 기본값) |
| `S3_ENDPOINT` · `S3_REGION` · `S3_BUCKET` · `S3_ACCESS_KEY` · `S3_SECRET_KEY` | 이미지 저장소 (S3 호환). 개발은 docker-compose의 RustFS(`http://localhost:9000`, 버킷 `lunchtime`), 운영은 S3 · R2 등. `S3_ENDPOINT`를 비우면 AWS S3 |
| `S3_PUBLIC_URL` · `S3_FORCE_PATH_STYLE` | 사진 공개 주소 앞부분(운영은 CDN 주소) · RustFS/MinIO는 `true` |
| `ADMIN_OTP_DEV_CODE` | 개발 전용 어드민 OTP 고정값 (기본 `123456`, 운영에서는 무시) |
| `SOCIAL_DEV_LOGIN` | 개발 전용 `dev:` 소셜 토큰 허용 (`true`/`false`, 운영에서는 무시) |

값이 틀리면 서버가 켜지지 않고 어떤 항목이 틀렸는지 보여 준다.

**이미지 저장소**: 개발 서버(development)가 켜질 때 버킷이 없으면 만들고 공개 읽기를 연다. 운영 버킷은 직접 만들고 공개 읽기(또는 CDN)를 설정한다. 폴더는 `menus/` · `sponsored/`(어드민) · `reviews/`(리뷰 사진). Docker를 막 켠 직후에는 저장소가 몇 초 늦게 준비되어 사진 업로드 테스트가 실패할 수 있다(다시 돌리면 통과).
