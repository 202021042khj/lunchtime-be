# lunchtime-be 작업 기록

2단계(백엔드)부터의 단계별 기록. 1단계(프론트 + 목) 기록은 `../lunchtime-fe/log.md`.

## 2단계-0 · 백엔드 뼈대 (2026-10-16)

**결정 (사용자)**
- NestJS + PostgreSQL + Prisma
- 별도 저장소 `workspace/lunchtime-be`
- 개발 DB는 Docker Desktop의 docker-compose
- 좋은 Nest 템플릿이 없다는 걱정 → Nest CLI 기본 뼈대 위에 규칙을 직접 정했다 (`docs/CONVENTIONS.md`)

**만든 것**
- 프로젝트 생성: `nest new` (Nest 12)
  - ESM · vitest · oxlint · TypeScript 6 strict
  - git은 init만 했고 커밋은 아직 없다
- 패키지
  - 설정: `@nestjs/config` + zod
  - 문서: `@nestjs/swagger`
  - 검증: class-validator · class-transformer
  - DB: Prisma 7.10.1 + `@prisma/adapter-pg`
  - 인증: `@nestjs/jwt` · argon2
  - 캐시: ioredis
  - 시드 실행용: tsx · dotenv
  - npm 11 설치 스크립트는 꼭 필요한 argon2 · esbuild · prisma · @prisma/engines만 허용했다
    - @scarf/scarf(사용 통계)는 거부
- docker-compose: `postgres:17`(5432, 볼륨) · `redis:7`(6379), 둘 다 healthcheck
- 환경 변수: `.env.example`, `config/env.ts`(zod)
  - 틀리면 항목 이름을 보여 주고 서버가 켜지지 않는다
  - JWT 비밀값은 32자 이상이어야 하고, 사용자용 · 어드민용이 같으면 거부한다
- Prisma 스키마 (`prisma/schema.prisma`): plan.md "DB 테이블"과 API.md 객체를 옮겼다
  - User, EmailVerification, RefreshToken
  - UserPreference, SavedLocation, Favorite
  - Menu(enum 배열 `weathers`), Ingredient(사전), Allergy(알레르기 → 재료)
  - Review(`deletedAt`), ReviewPhoto, PlaceStats, ReviewReport(같은 리뷰 · 신고자 unique)
  - MenuReport(사용자 · 식당 · 메뉴 unique), PlaceMenuEvidence, RecommendationLog
  - SponsoredPlace(`canceledAt`, 상태는 기간으로 계산)
  - AdminUser(OTP 비밀값), AdminRefreshToken, AdminAuditLog
- 시드 (`prisma/seed.ts`, 여러 번 실행해도 같은 결과)
  - 메뉴 24개 · 재료 23개 · 알레르기 10개: 프론트 목 데이터를 tsx로 그대로 읽어 `seed-data.json`으로 뽑았다
  - 테스트 계정 `test@lunchtime.dev` / `lunch1234`과 취향
  - 어드민 `admin` / `admin1234`. OTP는 TOTP라 비밀값 `JBSWY3DPEHPK3PXP`를 인증 앱에 등록해서 쓴다
- 공통
  - `/v1` 접두사(API.md 기본 URL). `/health` · `/docs` · `/docs-json`은 접두사 없음
  - 에러 형식: 모든 실패를 `{ error: { code, message, fields?, until? } }`로 만든다
    - `ERROR_CODES`는 API.md 표와 1:1
    - 서비스 코드는 `AppException('코드')`만 던진다
    - 예상 못 한 오류는 500 `INTERNAL_ERROR`로 바꾸고, 내부 메시지는 응답에 넣지 않는다
  - 검증: class-validator 실패 → 400 `VALIDATION_FAILED` + `fields`. 모르는 필드도 거부한다
  - 인증: 전역 `AuthGuard`
    - 표시 없음 = 사용자 토큰 필수
    - `@Public` = 비로그인 허용(맞는 토큰이면 사용자로 인식)
    - `@AdminRoute` = 어드민 토큰만
    - 사용자 · 어드민 토큰은 비밀값과 `aud`가 달라서 서로 통하지 않는다
  - `GET /health`: DB · Redis 확인
    - 하나라도 down이면 503과 `{ status: "degraded", checks }`
    - 운영 확인용이라 에러 형식 대신 무엇이 down인지 그대로 보여 준다
  - Swagger: `/docs`, OpenAPI `/docs-json` (production에서는 끔)
  - DB · Redis가 꺼져 있어도 서버는 켜진다
    - Prisma는 첫 쿼리 때 연결한다
    - Redis 연결 실패 로그는 30초에 한 번만 남긴다
- 스크립트: `db:up` · `db:down` · `db:migrate` · `db:seed` · `db:studio`, `postinstall`에서 `prisma generate`
- 문서: `README.md`(실행 방법 · 계정 · 환경 변수), `docs/CONVENTIONS.md`(폴더 · 모듈 모양 · 경로/인증 · 에러 · DB · 테스트 규칙)

**계획과 다르게 한 것**
- 전역 접두사를 두지 않으려 했다. 하지만 API.md 기본 URL이 `/v1`이고 프론트 `NEXT_PUBLIC_API_BASE_URL`도 `/v1`까지 포함하므로 `/v1`을 붙였다
- 가드를 사용자용 · 어드민용 둘로 나누려 했다. 대신 전역 가드 하나가 표시(`@Public` · `@AdminRoute`)를 보고 고르게 했다. 표시를 빠뜨리면 로그인 필수가 되므로 더 안전하다
- 빈 기능 모듈 폴더는 만들지 않았다. 자리는 CONVENTIONS.md에 적었고, 각 단계에서 만든다
- `prisma init`이 요청하지 않은 에이전트 스킬 폴더(`.agents` · `.claude` · `.windsurf`, `skills-lock.json`)를 깔아서 지웠다. `prisma7.config.ts`는 표준 이름 `prisma.config.ts`로 바꿨다
- `npm i prisma`가 8.0 RC를 깔아서 `@prisma/client`와 같은 7.10.1로 맞췄다

**API.md · 프론트에 반영한 것**
- 에러 코드 3개 추가: 409 `CONFLICT`, 500 `INTERNAL_ERROR`, 503 `SERVICE_UNAVAILABLE` (API.md 표 · 프론트 `types/common.ts`)
- 상태 충돌 409를 `CONFLICT`로 정했다
  - 대상: 같은 이름 메뉴, 종료된 광고 수정 · 재등록 · 취소, 탈퇴 유저 정지, 이미 처리한 신고
  - 프론트 목이 쓰던 `409 VALIDATION_FAILED` 6곳도 바꿨다. 화면은 이 코드로 분기하지 않아 영향이 없다

**확인한 것 (Docker 없이)**
- `prisma validate` · `prisma generate` 통과
- `tsc`(시드 · prisma.config 포함), `npm run build`, `npm run lint` 에러 0
- `npm test`: 환경 변수 검사 4개 통과
- `npm run test:e2e` 12개 통과 (DB · Redis는 가짜). 확인한 것:
  - `/health` up · 503 degraded
  - 없는 경로 404 형식, `/v1` 접두사
  - 로그인 필수: 토큰 없음 · 엉터리 → 401, 사용자 토큰 통과, 어드민 토큰 401
  - 어드민 경로: 사용자 토큰 401
  - 공개 경로: 토큰 없음 · 만료여도 통과, 맞으면 사용자로 인식
  - 검증 실패 `fields`(모르는 필드 포함)
  - AppException 409, 예상 못 한 오류 500(내부 메시지 숨김)
  - `/docs-json`
- 실제 실행(`node dist/main.js`, DB · Redis 꺼진 상태)
  - 서버 켜짐
  - `/health` 503 `{ db: down, redis: down }`
  - `/v1/nope` 404 형식, `/docs` 200
  - CORS가 `http://localhost:3000` 허용
  - 확인 후 서버 끔
- 프론트: `tsc`, `eslint lib types` 에러 0

**Docker 설치 후 확인 (2026-10-16)**
- 처음 설치는 "가상 머신 플랫폼"(관리자 권한 필요) 때문에 막혔다. 계정이 관리자 그룹이지만 승인을 거쳐야 하는 상태였다. 사용자가 관리자로 다시 설치해 해결했다
- Docker 29.8.2 · Compose v5.6.0
- `npm run db:up` → postgres · redis 둘 다 healthy
- `prisma migrate dev --name init` → `prisma/migrations/20261016015230_init` 생성 · 반영
- `npm run db:seed` 두 번 실행 → 건수 그대로(upsert 확인)
  - 메뉴 24(숨김 3), 재료 23(취향 선택지 12), 알레르기 10, 사용자 1 + 취향 1, 어드민 1
- `npm run start:dev` → `GET /health` 200 `{ db: up, redis: up }`, 컴파일 에러 0. 확인 후 서버를 껐다
- 컨테이너는 켜 둔 상태다(`npm run db:down`으로 끔, 데이터는 볼륨에 남음)

**남은 것 · 확인 필요**
- 첫 커밋은 아직 안 했다 (마이그레이션 폴더 포함해서 올린다)
- 취향 선택지의 음식 종류(cuisines) 목록을 테이블로 둘지 상수로 둘지는 2단계-2에서 정한다
- 다음: 2단계-1 auth
  - 이메일 가입 · 로그인 · 재설정, 토큰 재발급 · 로그아웃, `/me/password`
  - 어드민 로그인 + TOTP, 감사 로그
  - 소셜은 토큰 검증 방식만 먼저
  - 인증 메일 발송 서비스는 미결정이라, 개발 중에는 로그로 대신한다

## 2단계-1a · 인증 API: 이메일 · 어드민 (2026-10-16)

**결정 (사용자)**
- 소셜 로그인은 셋 다 실제로 만들되 단계를 나눈다: 1a 이메일 · 어드민, 1b 카카오, 1c 구글 · 애플
- 인증 메일: 발송부를 교체할 수 있게 만들고, 개발 중에는 서버 로그에 인증번호를 출력한다
- 어드민 OTP: 진짜 TOTP로 검증하고, 개발 환경에서만 `123456`도 받는다

**만든 것**
- 스키마: `User.lockedUntil` 추가 (마이그레이션 `auth_lockout`)
- 공통
  - `common/auth/password.ts`: argon2 해시 · 검증, 비밀번호 · 이름 규칙(프론트 `lib/validation.ts`와 같은 문구), 이메일 소문자 정규화
  - `common/auth/totp.ts`: RFC 6238 TOTP를 직접 구현(의존성 없음). 앞뒤 30초 허용
  - `common/auth/opaque-token.ts`: refreshToken · verificationToken(랜덤 32바이트, DB에는 sha256만), 6자리 인증번호
  - `common/clock.ts`: 현재 시각 주입 (테스트에서 시간 이동)
  - `common/time.ts`: `toKstIso`. API.md 규칙대로 응답 시각을 `+09:00`으로
  - `config`: `ADMIN_OTP_DEV_CODE` · `SOCIAL_DEV_LOGIN` (development에서만 동작)
  - `integrations/mail`: `MailService`(추상) + `LogMailService`(서버 로그)
- `modules/auth` — `/auth/*`
  - 이메일 인증번호
    - 10분 유효, 재전송 60초(429), 5번 틀리면 `CODE_EXPIRED`
    - 가입된 이메일로 가입 요청 → 409
    - 없는 이메일로 재설정 요청 → 같은 응답을 주되 메일은 안 보냄
  - 가입: 인증 토큰 사용 처리와 계정 생성을 한 트랜잭션에서 한다. 동시 가입은 unique 제약으로 409
  - 로그인: 5번 연속 실패하면 15분 잠금(429), 무엇이 틀렸는지 숨긴다
  - 재설정: 비밀번호를 바꾸고 모든 기기 로그인을 끊는다
  - 소셜: `SocialVerifierService` 자리를 만들었다. 지금은 개발용 `dev:<아이디>[:<이름>]`만 받고, 나머지는 "아직 준비 중" 400
  - 토큰: refreshToken 회전, 이미 쓴 토큰이 다시 오면 그 사용자의 토큰 전부 폐기. 동시에 같은 토큰으로 오면 한쪽만 성공
- `modules/users` — `/me`
  - `GET /me`: stats(리뷰 · 찜 · 추천 수), `lastActiveAt` 갱신
  - `DELETE /me`
    - 이메일 · 비밀번호를 지우고 이름은 "탈퇴한 사용자"로 바꾼다
    - 찜(찜 수 집계도 줄임) · 위치 · 취향을 지우고, 토큰을 폐기한다
    - `providerId`를 비워 같은 이메일로 다시 가입할 수 있다
  - `POST /me/password`
- `modules/admin/auth` — `/admin/auth/*`, `/admin/me`
  - 아이디 · 비밀번호 + TOTP, 5번 실패하면 15분 잠금
  - accessToken 30분, refreshToken 12시간(회전)
  - body 없는 로그아웃은 그 운영자의 모든 토큰을 폐기한다(프론트 어드민은 body 없이 부름)
- `modules/admin/audit`: `AdminAuditService.record()`. 로그인 · 로그인 실패 · 잠금 중 시도 · 로그아웃을 기록한다. 2-5 어드민 API도 이걸 쓴다
- 테스트
  - 단위: TOTP(RFC 6238 벡터), 비밀번호 규칙, KST 변환
  - DB e2e (`npm run test:e2e:db`, `test/auth.db-e2e-spec.ts`)

**계획과 다르게 한 것**
- **테스트 DB 초기화**: `prisma migrate reset`을 쓰려 했으나 Prisma가 AI 도구의 실행을 감지하고 사용자 동의를 요구했다. 동의를 우회하지 않고, 데이터를 지우지 않는 `migrate deploy`로 바꿨다. 테이블은 테스트 준비 코드가 비우는데, 대상은 localhost의 `lunchtime_test`로 고정했다. 개발 DB(`lunchtime`)는 건드리지 않는다
- **이메일 인증 규칙 테스트**: 단위 테스트 대신 DB e2e에서 `Clock`을 가짜로 바꿔 시간을 옮기며 확인했다
- **`POST /me/password`**: 다른 기기 로그인을 끊지 않는다. 요청에 지금 기기의 refreshToken이 없어서 끊으면 본인까지 1시간 안에 로그아웃된다. 본인이 바꾸는 것이라 유지하고, 잊어서 바꾸는 재설정만 모두 끊는다
- **`POST /auth/logout`을 공개로 바꿨다**: accessToken이 만료된 뒤에는 401이 나서 로그아웃이 안 되기 때문이다. 프론트는 `/auth/*`에서 토큰 재발급을 하지 않는다. refreshToken을 가진 쪽만 그 토큰을 폐기할 수 있다
- **`GET /me` 시각**: `createdAt`을 KST(`+09:00`)로 바꿨다. API.md 공통 규칙이다. 앞으로 모든 응답 시각에 `toKstIso`를 쓴다

**API.md 반영**
- 토큰 회전 · 재사용 감지
- 재설정 후 전체 로그아웃, 로그아웃 공개, 탈퇴 처리
- 개발 환경 전용 동작: `dev:` 소셜 토큰, OTP 고정값, 인증번호 로그
- 어드민 토큰(30분 · 12시간 · 본문 전달), body 없는 로그아웃, 잠금 규칙

**확인한 것**
- `prisma migrate dev`(auth_lockout), `npm run build`, `npm run lint` 에러 0
- `npm test` 19개, `npm run test:e2e` 12개, `npm run test:e2e:db` 19개 통과. DB e2e는 두 번 연속 돌려도 같은 결과
- DB e2e 시나리오
  - 가입 흐름: 대문자 이메일 → 소문자 저장 · `/me` KST 시각 · 로그아웃 후 refresh 401 · 다시 로그인
  - 이메일 · 인증번호
    - 가입된 이메일 409
    - 규칙 위반 시 `fields`: password · name · email
    - 60초 재전송 429
    - 5번 틀림 / 10분 경과 → `CODE_EXPIRED`
    - 없는 이메일 재설정 요청 → 같은 응답, 메일 없음
  - 비밀번호
    - 로그인 5번 실패 → 429, 15분 뒤 풀림
    - 재설정 → 옛 refresh 401 · 새 비밀번호 로그인 · verificationToken 재사용 400
    - `/me/password`: 틀린 현재 401 · 같은 비밀번호 400 · 규칙 400 · 성공 후 지금 기기 refresh 유지 · 소셜 계정 400
  - 토큰 · 탈퇴
    - refresh 회전, 옛 토큰 재사용 시 새 토큰까지 폐기
    - 탈퇴 → 남은 accessToken 401 · 같은 이메일로 다시 가입
  - 소셜 dev 토큰: 가입 · 재로그인, 실제 토큰 400
  - 어드민
    - TOTP 로그인, 개발 코드 123456
    - 사용자 ↔ 어드민 토큰 교차 401
    - refresh 회전, body 없는 로그아웃 → 전부 폐기
    - 5번 실패 잠금 · 해제, 감사 로그 기록
- 실제 개발 서버(curl)
  - 서버 로그의 인증번호로 가입 → `/me`
  - 시드 계정 로그인, dev 소셜 로그인
  - 어드민 123456 로그인 → `/admin/me`, 사용자 토큰으로 `/admin/me` → 401
  - Swagger에 경로 15개
- Windows 셸에서 curl `-d`로 보낸 한글이 깨졌다. UTF-8 파일로 보내면 정상이라 서버 문제가 아니다. 확인용으로 만든 사용자 3명은 개발 DB에서 지웠다
- 확인 후 개발 서버를 껐다(컨테이너는 켜 둠)

**남은 것 · 확인 필요**
- 여러 탭이 같은 refreshToken으로 동시에 재발급하면 늦은 쪽이 "재사용"으로 판정돼 모두 로그아웃될 수 있다. 프론트는 한 탭 안에서는 재발급을 한 번으로 묶는다. 문제가 되면 몇 초 유예를 둔다
- 로그인 잠금은 계정 단위다. 없는 이메일로 계속 시도하는 경우는 2단계 끝에서 요청 수 제한(분당 60회, Redis)으로 막는다
- 소셜 가입 시 이름을 못 받으면 "점심친구1234" 같은 임시 이름을 붙인다. 이름 바꾸기 API는 아직 없다(API.md에도 없음)
- 다음: 2단계-1b 카카오 로그인. 준비물은 카카오 개발자 앱(앱 ID, REST 키)

## 2단계-1b · 카카오 로그인 (서버 + 프론트 웹) (2026-10-16)

**결정 (사용자)**
- 서버와 프론트 웹 로그인까지 만든다
- 카카오 개발자 콘솔 설정(앱 ID, 카카오 로그인 켜기, Redirect URI, 동의 항목)은 사용자가 직접 한다

**서버**
- `integrations/kakao/kakao-auth.client.ts`
  - 인가 코드 교환(`kauth/oauth/token`, Client Secret이 있으면 같이 보냄), 토큰 정보(앱 ID), 프로필, 연결 끊기(어드민 키가 있을 때만)
  - 프로필은 닉네임과, 카카오가 확인한 이메일만 쓴다
  - 오류 변환: 카카오 4xx → 401 `INVALID_CREDENTIALS`, 연결 실패 · 5xx · 5초 타임아웃 → 502 `UPSTREAM_UNAVAILABLE`
- `SocialVerifierService`
  - 카카오 순서: 코드면 토큰으로 교환 → 앱 ID가 `KAKAO_APP_ID`와 다르면 401 → 프로필
  - 카카오 회원번호를 계정 키로 쓴다
  - `KAKAO_APP_ID`가 비어 있으면 400 "카카오 로그인 설정이 필요해요"
  - 개발용 `dev:` 토큰은 그대로 받는다
- `POST /auth/login`: `providerToken`(앱) 또는 `code` + `redirectUri`(웹) 중 하나. 없으면 400
- 탈퇴: 카카오 계정이면 연결을 끊는다. 실패해도 탈퇴는 끝나고 경고 로그만 남긴다
- 환경 변수
  - `KAKAO_APP_ID` · `KAKAO_CLIENT_SECRET` · `KAKAO_ADMIN_KEY` 추가
  - 로컬 `.env`의 `KAKAO_REST_KEY`는 프론트 `.env.local` 값을 옮겼다(값은 출력하지 않음)

**프론트 (lunchtime-fe)**
- `NEXT_PUBLIC_API_REAL_AUTH=true`: 목을 쓰면서 `/auth/*` · `/me` · `/me/password`만 실서버로 보낸다(`lib/api/client.ts`의 `usesMock(path)`)
  - 실서버 로그인 · 로그아웃 · 탈퇴 후에는 목의 로그인 상태(`lunchtime.mockAuth`)도 맞춘다. 목 화면이 로그인 상태로 보이게 하려는 것이다
- 웹 카카오 로그인 (`lib/socialLogin.ts`)
  - [카카오로 계속하기]를 누르면 `kauth.kakao.com/oauth/authorize`로 이동한다. `state`(랜덤)와 `next`는 sessionStorage에 둔다
  - 로그인 화면과 로그인 필요 팝업 모두 이 흐름을 쓴다
- 새 화면 `/login/kakao/callback`(`useKakaoCallbackLogic`)
  - `state` 확인 → `POST /auth/login { code, redirectUri }` → 온보딩 또는 `next`로 이동
  - 취소 · state 불일치 · 실패하면 `/login?next=`로 돌아가 토스트를 띄운다
  - 인가 코드는 한 번만 보낸다(개발 모드에서 effect가 두 번 돌아도)
- `types/user.ts`: `LoginRequest`를 토큰 방식 | 코드 방식의 유니언으로 바꿨다
- 이메일 인증번호 안내 문구: 실서버면 "메일이 안 보이면 스팸함도…"(목이면 기존 123456 안내)
- `.env.local`(값은 출력하지 않음): `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/v1`, `NEXT_PUBLIC_API_REAL_AUTH=true`, `NEXT_PUBLIC_KAKAO_REST_KEY`

**계획과 다르게 한 것**
- 로그인 필요 팝업의 [카카오로 계속하기]도 `loginWith("kakao")`를 직접 부르고 있어서 같은 리다이렉트로 바꿨다. 돌아올 곳은 지금 화면이고, 페이지가 새로 열려 데이터도 다시 받는다
- 프론트에는 `.env.example`이 없어서 README 표에만 키를 적었다

**API.md · 문서 반영**
- API.md `POST /auth/login`: 두 요청 방식, 카카오 웹 흐름 · 검증 · 오류 · 탈퇴 시 연결 끊기
- 프론트 README: 새 환경 변수, "로그인만 실서버로 확인하기", 콜백 경로
- 백엔드 README(환경 변수), CONVENTIONS(외부 API 클라이언트 오류 규칙)

**확인한 것**
- 백엔드
  - `npm test` 25개(카카오 클라이언트 6개 추가), `npm run test:e2e` 12개, `npm run test:e2e:db` 28개(카카오 9개 추가)
  - lint 경고 0, build 통과
- 카카오 DB e2e(카카오 API는 가짜)
  - 코드로 가입 → 닉네임 사용 → 다시 로그인하면 같은 계정, 토큰으로도 같은 계정
  - 닉네임이 없으면 임시 이름
  - 다른 앱 토큰 · 틀린 코드 → 401, 카카오 장애 → 502
  - code만 보내거나 아무것도 없으면 400
  - 탈퇴하면 연결 끊기를 부르고, 다시 가입하면 새 계정
- 프론트: `tsc` · `eslint` 에러 0
- Playwright(백엔드 4000 + 프론트 3000, 카카오 주소는 가로챔) 13개 통과
  - 카카오 버튼 → 인가 주소(client_id 32자 · response_type · redirect_uri · state)
  - 가짜 코드 → 서버 호출 → `/login?next=` + 토스트 1개
  - state 재사용 · 불일치 → 서버 호출 없이 거절
  - 취소 → "카카오 로그인을 취소했어요."
  - 이메일 로그인이 실서버로 간다(`POST /v1/auth/email/login`, `GET /v1/me`). 추천은 목이고, 목 로그인 상태가 `in`
  - 로그인 필요 팝업 → 인가 주소, 돌아올 곳 = 지금 화면(`/map?menuId=m_12`)
  - 콜백 화면 "카카오 로그인 중…" 캡처
- 확인 후 서버 두 개와 Chrome을 껐다

**실제 카카오 계정 확인 (2026-10-16)**
- 사용자가 콘솔을 설정했다: 앱 ID `1607545`, 카카오 로그인 ON, Redirect URI, 닉네임 동의
- 처음 코드 교환은 `KOE010 invalid_client`로 거절됐다
  - 원인: 새 콘솔에서 클라이언트 시크릿이 켜져 있었다
  - 콘솔 개편으로 위치가 바뀌었다: 앱 → 플랫폼 키 → REST API 키 상세(리다이렉트 URI도 여기)
  - `KAKAO_CLIENT_SECRET`을 넣은 뒤에는 가짜 코드에 `KOE320`(코드 없음)이 나와, 앱 인증이 통과한 것을 확인했다
- 사용자가 브라우저에서 본인 카카오 계정으로 로그인에 성공했다 → 온보딩으로 이동
- 개발 DB 확인
  - 카카오 계정 1개(여러 번 로그인해도 중복 없음), 닉네임 · 확인된 이메일 저장
  - refreshToken 2개 중 1개 폐기(로그아웃 반영)
- 다시 로그인해도 온보딩이 계속 뜬다. 혼합 모드라 온보딩 완료가 목에만 저장되기 때문이고, 의도대로다(2단계-2에서 해결)
- 클라이언트 시크릿을 채팅으로 받았다. 배포 전에 콘솔에서 새로 발급한다

**남은 것 · 확인 필요**
- 혼합 모드(로그인만 실서버)에서는 온보딩 완료가 목에만 저장된다. 그래서 다시 로그인하면 실서버 기준으로 또 온보딩으로 간다. 2단계-2(취향 API)에서 해결된다
- 앱(웹뷰)에서 카카오 액세스 토큰을 넘기는 브리지는 아직 미결정이다(서버는 이미 받을 수 있다)
- 다음: 2단계-1c 구글 · 애플

## 2단계-1c · 구글 · 애플 로그인 (2026-10-16)

**결정 (사용자)**
- 구글: 서버와 웹 로그인을 만들고, 사용자가 Google Cloud 콘솔에서 OAuth 클라이언트를 만들어 실제 계정으로 확인한다
- 애플: 서버 코드만 짜 둔다. 프론트 버튼은 "(서비스 준비 중)"을 작게 쓰고 비활성화한다
  - 이유: 개발자 계정($99/년)이 필요하고, 애플은 돌아올 주소로 localhost를 받지 않는다(https만)

**서버**
- `jose` 6.2.12 추가 (ID 토큰 검증, 애플 client_secret 서명)
- `integrations/google/google-auth.client.ts`
  - 인가 코드 → ID 토큰(`oauth2.googleapis.com/token`)
  - ID 토큰 검증: 구글 공개키(JWKS) · 발급자 · aud(`GOOGLE_CLIENT_IDS`, 웹 · 앱 여러 개) · 만료
  - 이름과, 확인된 이메일만 쓴다
- `integrations/apple/apple-auth.client.ts`
  - ID 토큰 검증: 애플 JWKS · aud(Service ID 또는 Bundle ID). `email_verified`가 문자열 `"true"`여도 인정한다
  - client_secret: `.p8`로 ES256 서명한 JWT(iss=Team ID, sub=Service ID, 5분)
  - 코드 교환 → ID 토큰 + refresh token, 토큰 폐기(`/auth/revoke`)
- 오류 규칙은 카카오와 같다: 회사 쪽 4xx · 서명 · aud · 만료 → 401, 연결 실패 · 5xx · 공개키 못 받음 → 502
- `SocialVerifierService`
  - 세 회사 모두 토큰 · 코드 두 방식을 받는다
  - 회사 키가 없으면 400 "OO 로그인 설정이 필요해요."(예전 "아직 준비 중" 대신)
- 애플 이름: ID 토큰에 없어서 `POST /auth/login`에 `name`(선택)을 추가했다. 가입할 때만 쓴다
- 스키마: `User.socialRefreshToken` (마이그레이션 `social_refresh_token`)
  - 애플 코드 로그인 때 받은 refresh token을 저장한다
  - 탈퇴하면 애플 토큰을 폐기하고 값을 지운다(App Store 5.1.1(v)). 앱이 ID 토큰만 보내면 폐기할 토큰이 없다 → 앱도 코드를 보내는 것을 권장(API.md)
- 환경 변수: `GOOGLE_CLIENT_IDS` · `GOOGLE_CLIENT_SECRET`, `APPLE_SERVICE_ID` · `APPLE_BUNDLE_ID` · `APPLE_TEAM_ID` · `APPLE_KEY_ID` · `APPLE_PRIVATE_KEY`

**프론트**
- `lib/socialLogin.ts`: 카카오 전용이던 리다이렉트를 카카오 · 구글 공용으로 바꿨다
  - `startSocialLogin` · `takeSocialLoginState` · `usesSocialRedirect`
  - 구글은 `accounts.google.com/o/oauth2/v2/auth`, scope `openid email profile`, `prompt=select_account`
- 콜백 화면을 `/login/[provider]/callback` 하나로 합쳤다(`useSocialCallbackLogic`). 모르는 회사 이름이면 `/login`으로 보낸다
- `LoginRequest`: 코드 방식을 세 회사 모두로 넓히고 `name?`을 추가했다
- 애플 버튼: `UNAVAILABLE_PROVIDERS = ["apple"]` → 비활성화 + "(서비스 준비 중)"(12px)
- `.env.local`: `NEXT_PUBLIC_GOOGLE_CLIENT_ID=`(비어 있음, 콘솔 설정 후 채움)

**계획과 다르게 한 것**
- 구글 웹 로그인은 Google Identity Services 버튼(구글이 그려 주는 버튼) 대신 OAuth 인가 코드 방식을 썼다. 지금 디자인의 버튼을 그대로 쓰기 위해서다
- Prisma 7은 `migrate dev` 뒤 클라이언트를 자동으로 다시 만들지 않아 `prisma generate`를 따로 돌렸다(CONVENTIONS에 적음)

**확인한 것**
- 백엔드: `npm test` 35개, `npm run test:e2e` 12개, `npm run test:e2e:db` 34개 통과. lint 경고 0, build 통과
  - 단위(테스트에서 만든 RSA · EC 키)
    - 구글: 진짜 토큰, 앱 client ID, 미확인 이메일 제외, 다른 앱 · 발급자 · 위조 서명 · 만료 → 401
    - 애플: Service · Bundle ID, `"true"` 이메일 확인, 다른 앱 · 위조 → 401
    - 애플 client_secret: 헤더 · 클레임 확인, 받은 공개키로 서명 검증
    - 애플 서버 호출: 코드 교환 요청, 토큰 폐기, 4xx → 401 · 5xx → 502
  - DB e2e(구글 · 애플은 가짜)
    - 구글: 코드 가입(이름 · 이메일) → 토큰으로 같은 계정, 위조 401
    - 애플: 코드 가입 + 이름 + refresh token 저장, 다시 로그인해도 이름 그대로
    - 애플 탈퇴: 토큰 폐기 · 값 삭제, ID 토큰만으로 가입했으면 폐기 없이 탈퇴
- 프론트: `tsc` · `eslint` 에러 0
- Playwright 25개 통과
  - 애플 버튼(데스크톱 · 모바일): 비활성화, "(서비스 준비 중)", 높이 52px 한 줄
  - 구글
    - client ID가 없으면 이동하지 않고 안내
    - 콜백: 취소 → "Google 로그인을 취소했어요.", state 없음 → 서버 호출 없이 거절
    - 서버: 설정 전 400 안내
  - 모르는 회사 콜백 → `/login`
  - 카카오 회귀 13개 그대로 통과(새 공용 경로)

**실제 구글 계정 확인 (2026-10-16)**
- 사용자가 Google Cloud 콘솔에서 OAuth 클라이언트(웹)를 만들고 client ID · secret을 넣었다. 프론트와 백엔드의 client ID가 같은 것을 확인했다
- 틀린 코드로 미리 보내 보니 `invalid_grant (Malformed auth code)`가 나왔다 → 앱 인증(client ID · secret)은 통과
- 사용자가 본인 구글 계정으로 두 번 로그인했다
- 개발 DB 확인
  - 구글 계정 1개(중복 없음), 이름 · 확인된 이메일 저장
  - refreshToken 2개 모두 폐기(두 번 다 로그아웃)
  - 서버 오류 로그 없음

**남은 것 · 확인 필요**
- 애플 실제 확인: 개발자 계정과 https 주소(배포 또는 ngrok)가 생기면 한다
  - 웹 흐름(`response_mode=form_post`라 콜백이 POST로 온다)과 프론트 버튼 활성화는 그때 붙인다
- 다음: 2단계-2 내 정보 · 취향 · 위치 · 찜 API (반복되는 온보딩 해결)

## 2단계-2 · 내 정보 · 취향 · 위치 API (2026-10-16)

**결정 (사용자)**
- 찜은 2단계-3으로 옮긴다
  - `PUT /me/favorites/{placeId}`에는 본문이 없고, 카카오 로컬에는 "ID로 식당 한 곳 조회"가 없다
  - 그래서 서버가 식당 검색 결과로 돌려준 식당을 기억해 두었다가 찜할 때 쓴다. API는 지금 그대로 둔다
- 2단계-2는 내 정보 · 취향 · 위치만 한다

**서버**
- `modules/preferences`
  - `GET/PUT /me/preferences`
    - 처음엔 빈 값을 준다
    - 저장은 전체 교체이고, 공백 · 중복을 정리한다
    - 알레르기 · 음식 종류가 선택지에 없으면 400 + `fields`
    - `completeOnboarding`이면 `onboardingCompleted=true`
  - `GET /preferences/options`: 재료(`inOptions`) · 알레르기는 사전 순서대로, 음식 종류는 상수 8개(프론트 `MENU_CUISINES`와 같음)
    - 2단계-1a에서 남긴 "음식 종류를 테이블로 둘지 상수로 둘지"는 상수로 정했다
  - `GET /ingredients?q=`: 재료 사전에서 이름에 q가 들어간 것 최대 20개
  - `POST /preferences/preview`(공개): 노출 메뉴만 보고, 추천 3 · 제외 4
- `modules/preferences/taste-scoring.ts`: 제외 이유 · 매칭 %를 순수 함수로 뒀다(프론트 목 `previewTaste`와 같은 규칙)
  - 인기 순위는 최근 7일 추천 기록 수다. 2단계-3 추천이 이 함수를 그대로 쓴다
- `modules/locations`
  - `GET/POST/DELETE /me/locations`: 10개까지(넘으면 409 `CONFLICT`). 남의 위치나 없는 위치 삭제는 404
  - `GET /locations/search`(공개)
    - 카카오 주소 검색(동네 · 도로명)을 먼저, 이어서 키워드 검색(장소)
    - 중복을 빼고 최대 10개, Redis 10분 캐시
  - `GET /locations/reverse`(공개)
    - 좌표 → 법정동 이름(역삼동). 행정동 "역삼1동"보다 익숙하고 프론트 목과 같다
    - 100m 단위로 하루 캐시
- `integrations/kakao/kakao-local.client.ts`
  - 국내 밖 좌표는 카카오가 400 `code -2`로 준다 → 422 `OUT_OF_SERVICE_AREA`(실제 API로 확인)
  - 키 · 쿼터 · 장애는 502
- `RedisService.cached()`: Redis가 꺼져 있으면 캐시 없이 동작한다

**프론트**
- `NEXT_PUBLIC_API_REAL_AUTH` → `NEXT_PUBLIC_API_REAL=auth,taste,locations`
  - 기능 묶음 단위로 실서버로 보낸다. 2-3 이후 묶음을 늘린다
- 실서버 응답을 목에도 알린다
  - 로그인 상태(기존)
  - 내 취향을 읽거나 저장하면 목 취향도 맞춘다. 아직 목인 홈 추천의 personal · popular 모드가 같게 보이게 하려는 것이다
- **버그 수정**: 온보딩에서 고른 값이 사라졌다
  - 원인: 화면이 열릴 때 부른 기존 취향 응답이 사용자가 고른 뒤에 도착하면 폼을 빈 값으로 덮어썼다. 목은 응답이 빨라 드러나지 않았고, 실서버에서 Playwright로 찾았다
  - 수정: `useTasteForm.prefill()`. 사용자가 아직 아무것도 고르지 않았을 때만 불러온 값을 채운다. 취향 설정 화면은 불러오기가 끝날 때까지 로딩이라 영향이 없었다

**문서**
- API.md: 취향 저장 규칙(정리 · 선택지 검사 · 온보딩), 미리보기 계산, 위치 저장 10개 · 삭제 404 · 검색 순서 · 좌표→동네(법정동 · 422 · 캐시)
- 프론트 README: `NEXT_PUBLIC_API_REAL` 설명, "일부 기능만 실서버로 확인하기"
- CONVENTIONS: `RedisService.cached`, 취향 점수 위치, DB e2e에서 외부 키를 비우는 이유와 Redis 키 규칙

**계획과 다르게 한 것**
- DB e2e가 개발 `.env`의 실제 구글 키를 읽어 기존 테스트 하나가 깨졌다. `vitest.config.e2e-db.ts`에서 외부 서비스 키를 모두 빈 값으로 고정했다

**확인한 것**
- 백엔드
  - `npm test` 45개(취향 점수 7, 카카오 로컬 3 추가), `npm run test:e2e` 12개, `npm run test:e2e:db` 46개(취향 · 위치 12 추가)
  - lint 경고 0, build 통과
- 실제 카카오 API(curl): 좌표 → "역삼동", "역삼" 검색 → 역삼동 · 역삼1동 · 역삼2동 …, 도쿄 좌표 → 400 code -2(422로 바꿈)
- DB e2e 취향 · 위치
  - 취향
    - 선택지(취향 화면용 재료만), 재료 검색
    - 빈 취향 → 저장(정리) → 읽기 · `/me` 온보딩 완료
    - 맵기 null, completeOnboarding 없이 저장해도 온보딩 유지
    - 없는 알레르기 · 음식 종류 · 맵기 5 → 400 + fields
    - 비로그인 401
    - 미리보기: 제외 이유(고수 · 갑각류 알레르기 · 오이), % 순, 숨긴 메뉴 제외
  - 위치
    - 저장 · 목록 · 삭제, 남의 위치 404, 11번째 409, 좌표 범위 400
    - 검색 순서와 캐시(두 번째는 카카오를 부르지 않음)
    - 좌표 → 법정동, 국내 밖 422, 좌표 없음 400
- Playwright(백엔드 4000 + 프론트 3000)
  - 새 사용자 → 온보딩 선택지 실서버 → '오이' 선택이 응답 뒤에도 유지 → 저장
  - 서버에 `onboardingCompleted=true` · '오이' 저장 → 다시 로그인하면 `onboardingCompleted=true`
  - **반복 온보딩 해결**
  - 취향 화면 · 위치 설정 창 실서버, 카카오 로그인 회귀 11개 통과
  - 구글 "설정 전" 확인 2개는 이제 키를 넣어서 실제 로그인으로 넘어간다. 예상한 결과다

**남은 것 · 확인 필요**
- 미리보기 매칭 %가 지금은 모두 비슷하다(추천 기록이 없어 인기 순위 차이가 없음). 2단계-3에서 추천이 쌓이면 달라진다
- 이름 바꾸기 API는 아직 없다(소셜 임시 이름 "점심친구1234")
- 다음: 2단계-3
  - 식당 검색 · 상세
  - 추천 · 날씨(기상청)
  - 찜(검색 결과 기억)
  - 통합 검색

## 2단계-3a · 식당 검색 · 상세 · 찜 · 날씨 (2026-10-16)

2단계-3을 둘로 나눴다. 3a는 식당 · 찜 · 날씨, 3b는 추천 · 통합 검색(3a의 식당 검색 · 날씨를 그대로 쓴다).

**서버**
- 카카오 로컬 식당 검색(`KakaoLocalClient.searchRestaurants`)
  - 음식점(FD6)만, 반경 안에서 거리순, 15개씩 3쪽까지(최대 45)
  - 키워드가 없으면 카테고리 검색(근처 음식점 전체)
- `GET /restaurants`(공개)
  - 메뉴 검색
    - 키워드 검색 + 카테고리 검색("카테고리만 맞는 곳")
    - 광고: 노출 메뉴 · 세부 카테고리 · 종류가 맞고 광고 반경 안
    - 근거(`PlaceMenuEvidence` 리뷰 · 사장님 → 이름 → 키워드 → 카테고리)를 붙이고 API.md 단계로 정렬한다
      - 키워드 단계에서 카테고리가 다르면 뒤로, 카테고리만 맞는 곳은 5곳까지
    - 제보 3건 이상이고 확인된 근거가 없으면 뺀다
  - 자유 검색어는 광고 · 근거 없이 정렬만 한다
  - 반경 · 최소 별점 필터(광고도 걸리면 빠짐), 거리순 · 리뷰 많은 순
  - 커서 페이지, 광고 노출 수 집계
  - 좌표 없음 400 `LOCATION_REQUIRED`, 없는 메뉴 404
  - 카카오 결과는 (검색어, 약 100m 격자, 반경) 단위로 10분 캐시
- 식당 정보 기억(`PlaceCacheService`, Redis 7일)
  - 카카오에는 ID로 한 곳을 조회하는 API가 없다. 그래서 검색 결과로 돌려준 식당을 기억해 상세 · 찜에 쓴다
  - 식당 테이블은 만들지 않았다(기존 결정)
- `RestaurantViewService.build()`: 별점(`PlaceStats`) · 리뷰 수 · 찜 여부 · 광고 · 영업시간(진행 중 광고의 `hours` → `openNow`)을 쿼리 3번으로 붙인다. 추천 · 통합 검색도 이걸 쓴다
- `GET /restaurants/{placeId}`(공개)
  - 기억해 둔 정보 → 찜 → 광고 순으로 식당을 찾는다
  - 최근 리뷰 2개 · 별점 분포를 붙인다(`reviews/review-view.ts`, 2단계-4와 공용)
  - 선택 좌표가 있으면 거리를 채운다
- `POST /restaurants/{placeId}/click`(공개) 광고 클릭 수
- `POST /restaurants/{placeId}/menu-reports`: 중복이면 409. `PlaceMenuEvidence.reportCount`를 올린다
- `modules/favorites`
  - `PUT`: 멱등. 기억해 둔 정보로 저장하고, 없으면 404. `PlaceStats.favoriteCount`를 올린다
  - `DELETE`: 204, 집계를 내린다
  - `GET`: 최근 찜한 순, 음식 종류 필터, 좌표가 있으면 거리
- 음식 종류 이름: 카카오 2단계 카테고리 `아시아음식` → `아시안`(찜 필터 값과 맞춤)
- 기상청(`integrations/kma`, `modules/weather`)
  - 격자 변환 · 발표 시각은 프론트 스파이크 코드를 옮겼다
  - 현재(초단기실황 + 초단기예보 SKY)는 격자 · 발표시각별 1시간, 최고 · 최저(단기예보)는 격자 · 날짜별 하루 캐시
  - 최고 · 최저만 실패하면 null로 두고 현재 날씨는 준다
  - `GET /weather`(공개)
  - 키는 프론트 `.env.local`에서 옮겼다(`KMA_SERVICE_KEY` · `KMA_BASE_URL`, 값은 출력하지 않음)
- 공통
  - `common/cursor.ts`: 커서 페이지
  - 근거 문구의 을/를을 받침에 맞게 고른다("리뷰 87명이 국밥을 먹었어요"). 목은 항상 "를"이었다

**프론트**
- `NEXT_PUBLIC_API_REAL`에 `restaurants`(`/restaurants*` · `/me/favorites*`) · `weather` 묶음을 추가했다. `.env.local`은 `auth,taste,locations,restaurants,weather`
- 지도 상세를 부를 때 검색 기준점 좌표를 같이 보낸다(`getRestaurant(placeId, origin)`)
- **버그 수정**
  - 원인: 상세에 좌표를 넘길 때 현재 위치 객체를 통째로 쿼리로 보내 `name` · `source` · `label` · `savedId`까지 붙었다. 서버가 모르는 쿼리라 400으로 거절해, 상세가 "식당 정보를 불러오지 못했어요"로 실패했다(Playwright로 발견)
  - 수정: `getRestaurant` · `reverseGeocode` · `getWeather` 모두 `lat` · `lng`만 골라 보낸다

**확인한 것**
- 실제 API(curl)
  - 날씨: 역삼 24도 구름많음 · 최고 24 / 최저 14. 처음 1.2초, 캐시 후 0.003초
  - 순두부찌개 검색: 45곳. 이름 근거 2곳이 앞, 나머지는 카카오 키워드 근거(냉면집 · 갈비집도 섞여 있어 근거 등급이 필요함을 확인)
  - 좌표 없음 `LOCATION_REQUIRED`, 모르는 식당 404
- 백엔드: `npm test` 58개(식당 규칙 6, 날씨 · 격자 7 추가), `npm run test:e2e` 12개, `npm run test:e2e:db` 59개(식당 · 찜 · 날씨 13 추가). 두 번 연속 같은 결과, lint 경고 0, build 통과
- DB e2e(카카오 · 기상청은 가짜)
  - 메뉴 검색: 정렬 단계(광고 → 리뷰 → 이름 → 키워드 일치 → 불일치 → 카테고리 5곳)
    - 반경 밖 · 분식 · 제보 3건 제외
    - 광고 영업 중 · 노출 수
    - 별점 4.5 · 걷는 시간
  - 검색 옵션
    - 자유 검색어
    - 리뷰 순 · 최소 별점(광고 제외) · 반경 3000
    - 페이지 · 잘못된 커서 400
  - 오류: 좌표 없음 · 없는 메뉴 · 카카오 장애 502, 같은 검색은 캐시
  - 상세(리뷰 2개 · 분포 · KST · 거리 · 좌표 없음 0 · 404), 광고 클릭, 메뉴 제보(409 · 3건 숨김 · 비로그인 401)
  - 찜
    - 멱등 · 집계 · isFavorite(본인만) · 해제
    - 아시안 필터 · 본 적 없는 식당 404 · 비로그인 401
  - 날씨: 해석 · 캐시 · 장애 502 · 좌표 없음 400
- Playwright(실제 카카오 데이터) 6개 통과
  - 지도 목록이 실서버 · 첫 식당 "순두부와청국장 차병원점" · 근거 문구 표시
  - 상세가 좌표와 함께 호출됨(버그 수정 후)
  - 찜하기 → 찜 목록에 나옴(한식 · 628m)

**남은 것 · 확인 필요**
- 혼합 모드 주의: 홈 추천은 아직 목이다. 홈 카드의 식당(목 ID)을 찜하면 실서버가 모르는 식당이라 404가 난다. 2단계-3b에서 추천이 실서버로 넘어가면 해결된다
- 광고 입금 대기(pending)를 노출할지는 미결정이다(지금은 노출)
- `mainMenu` · `imageUrl`은 카카오에 없어 null이다
- 다음: 2단계-3b 추천(`GET /recommendations`) · 통합 검색(`GET /search`)

## 2단계-3a 보충 · 식당 이미지 (2026-10-16)

**질문 (사용자)**: 식당은 불러와지는데 이미지는 안 되는가?

**확인한 것**
- 카카오 로컬 API는 식당 사진을 주지 않는다. 카카오맵 앱의 사진은 웹페이지에만 있다
- 다른 방법
  - 크롤링: 약관 위반
  - 카카오 · 네이버 이미지 검색: 남의 사진이라 저작권 문제가 있고, 같은 이름의 다른 가게 사진이 걸리는 등 정확도가 낮다
  - Google Places 사진: 유료이고, 구글 지도가 아닌 지도와 함께 쓰는 것을 약관이 금지한다

**결정 (사용자)**
- 우리 사진만 쓴다: 가장 최근 리뷰 사진 → 광고 · 입점 식당 사진. 서버 연결은 2단계-4(리뷰 사진) · 2단계-5(광고 사진)에서 한다
- 사진이 없으면 음식 종류별 대체 이미지를 보여 준다

**만든 것 (프론트)**
- `FoodImage`에 `cuisine` 속성을 추가했다. 사진이 없고 종류를 알면 종류별 대체 이미지(옅은 색 배경 + lucide 아이콘)를 보여 준다
  - 한식 Soup, 중식 CookingPot, 일식 Fish, 양식 Pizza, 분식 Drumstick, 아시안 Wheat, 패스트푸드 Hamburger, 샐러드·건강식 Salad
  - 그 밖(퓨전요리 등)은 UtensilsCrossed
- 식당 행 · 카드 · 지도 상세 · 리뷰 쓰기 창에 적용했다. 메뉴 카드는 어드민이 올리는 메뉴 사진을 쓰므로 기존 자리표시를 그대로 둔다
- API.md: `imageUrl`을 채우는 규칙과 외부 사진을 쓰지 않는 이유를 적었다

**확인한 것**
- 프론트 `tsc` · `eslint` 에러 0
- 실제 카카오 데이터로 지도(데스크톱 목록 · 상세, 모바일 시트) 캡처
  - 분식 · 양식 · 아시안 · 한식 · 퓨전요리(기본)마다 색과 아이콘이 다르게 나온다

## 2단계-5a(앞당김) · 어드민 메뉴 · 광고 · 사진 업로드 (2026-10-16 ~ 2026-10-19)

**결정 (사용자)**
- 종류별 아이콘 대신 어드민에서 음식 사진을 직접 올린다. 대상은 메뉴 사진과 광고 식당 사진
- 지금 먼저 만든다(2-3b 추천 · 통합 검색보다 앞)
- 운영 저장소는 미정이다. S3 호환 코드로 만들고, 개발은 로컬 저장소를 쓴다

**계획과 다르게 한 것**
- **어드민 메뉴 · 광고 API를 통째로 앞당겼다**: 어드민은 목과 실서버를 섞을 수 없다(로그인 토큰이 서로 맞지 않음). 그래서 사진만 따로 붙일 수 없었다. 유저 관리 · 리뷰 신고는 2단계-5에 남긴다
- **MinIO → RustFS**: MinIO 이미지는 Docker Hub · quay.io 모두 받을 수 없었다(커뮤니티 이미지 배포 중단). 받을 수 있는 S3 호환 이미지(RustFS · SeaweedFS · LocalStack · S3Mock · Garage) 중 RustFS(Apache-2.0)를 골랐다
  - 버전은 digest로 고정했다(2026-10-03 빌드)
- **미리 서명된 업로드(presigned) 대신 서버 경유 업로드**: RustFS로 시험해 보니 두 가지 문제가 있었다
  - 서명한 형식(image/png)과 다른 형식(text/html)으로 올려도 받아들였다
  - CORS 응답에 허용 주소가 없어 브라우저가 바로 올릴 수 없었다
  - 그래서 어드민 사진은 브라우저 → 서버 → 저장소로 올린다. 서버가 파일 첫 바이트로 형식을 확인하므로 저장소 종류와 관계없이 안전하다. 사용자 리뷰 사진(2단계-4) 방식은 그때 다시 정한다
- 버킷 · 공개 읽기는 별도 컨테이너(`mc`) 대신 개발 서버가 켜질 때 S3 표준 API(버킷 정책)로 만든다

**서버**
- docker-compose `storage`(RustFS, 9000). 환경 변수 `S3_ENDPOINT` · `S3_REGION` · `S3_BUCKET` · `S3_ACCESS_KEY` · `S3_SECRET_KEY` · `S3_PUBLIC_URL` · `S3_FORCE_PATH_STYLE`
- `integrations/storage`
  - `detectImageType`: JPG · PNG · WEBP 시그니처. 이름만 이미지인 HTML은 거절한다
  - `StorageService.putImage`: 5MB 제한, 새 이름(무작위 24자) · 올바른 Content-Type · 1년 캐시
  - `assertOwnImage`: 저장할 주소가 우리 저장소에 실제로 있는 사진인지(HEAD) 확인한다
- `POST /admin/uploads/images`(multipart `file` · `purpose`) → `{ imageUrl }`, 감사 로그 `image.upload`
  - 413(multer 한도 초과)도 `VALIDATION_FAILED`로 바꾼다
- 어드민 메뉴(`modules/admin/menus`)
  - 목록: 7일 추천 수, 노출 먼저, `counts`, `q` · `cuisine` · `visible` · 페이지
  - 추가 · 수정(일부만, 사진 포함): 규칙과 문구는 프론트 목과 같다. 같은 이름이면 409
  - CSV 가져오기: 같은 이름은 덮어쓰되 기존 사진은 유지, 문제 줄만 건너뛴다
  - 재료 사전 GET · POST
- 어드민 광고(`modules/admin/sponsored`)
  - 요약 · 목록(상태 순) · 카카오 장소 검색(음식점만) · 등록 · 수정 · 재등록 · 취소
  - 상태(예약 · 진행 · 종료)는 KST 오늘과 기간으로 계산한다
  - 규칙: 반경 · 기간 · 우선순위 · 영업시간 · 없는 메뉴 · 사진 주소
- 스키마 `SponsoredPlace.imageUrl`(마이그레이션 `sponsored_image`)
- 식당 이미지 채우기 순서: 진행 중인 광고 식당 사진 → 메뉴 검색이면 그 메뉴 사진 → null(앱은 종류별 아이콘). 리뷰 사진은 2단계-4에서 맨 앞에 붙인다
- 감사 로그 기록: 메뉴 · 광고 생성/수정/가져오기/취소/재등록, 재료 추가

**프론트**
- `ImageUploadField`(어드민 공용)
  - 미리보기 · 올리기/바꾸기 · 빼기
  - 형식 · 5MB는 먼저 확인한다. 올리는 동안은 저장 버튼을 막는다
- 메뉴 편집 창에 "메뉴 사진"을 추가했다
  - **버그 수정**: 저장할 때 목록 행의 `id` · `recommendCount7d`까지 보내고 있었다. 목은 무시했지만 실서버는 400으로 거절한다 → 메뉴 칸만 보낸다
- 광고 편집 창에 "식당 사진"을 추가했다. 재등록하면 원래 사진을 이어받는다
  - **버그 수정 1**: 수정 · 재등록 때 `place`를 보내 실서버가 400 → 빼고 보낸다
  - **버그 수정 2**: 실제 카카오 카테고리는 "음식점 > 한식 > …"이라 종류를 못 찾아 노출 메뉴 후보가 비었다 → "음식점" 다음 단계로 판단한다
  - **버그 수정 3**: 광고 시작일 "오늘"을 UTC로 계산해 한국 0~9시에는 어제가 됐다 → 현지 날짜. 어드민 유저 CSV 파일 이름 날짜도 같이 고쳤다
- 목: `POST /admin/uploads/images`(브라우저 임시 주소), 광고 목 데이터 `imageUrl: null`
- `NEXT_PUBLIC_API_REAL`에 `admin` 묶음을 추가했다(어드민 로그인 · 메뉴 · 재료 · 광고 · 장소 · 사진)
  - 아직 목인 유저 관리 · 신고 화면은 실서버 어드민 토큰도 받는다(`requireAdmin`)
- 어드민 로그인 안내 문구: 실서버면 개발 모드에서만 개발 계정을 보여 준다

**확인한 것**
- 백엔드
  - `npm test` 60개(이미지 형식 2 추가), `npm run test:e2e` 12개, `npm run test:e2e:db` 73개(어드민 14 추가), lint 경고 0, build 통과
  - 처음 한 번은 Docker를 막 켠 직후라 사진 업로드 테스트 2개가 실패했고, 이후 세 번 연속 73개 모두 통과했다
  - 테스트끼리 재료 이름('고수풀')이 섞여 실패한 것은 테스트 데이터를 바꿔 고쳤다
- 어드민 DB e2e: 사진은 실제 RustFS 테스트 버킷(`lunchtime-test`)에 올리고 다시 받아 확인했다
  - 사진: PNG 업로드 → 공개 주소로 같은 바이트 · image/png, HTML 위장 · 5MB 초과 · 파일 없음 · 잘못된 purpose 400, 비로그인 401
  - 메뉴
    - 사진과 함께 추가, 409, 외부 · 지어낸 사진 주소 400, 규칙 5가지
    - 숨김 · 필터 · 7일 추천 정렬 · 페이지
    - CSV(새로 · 덮어쓰기 사진 유지 · 문제 줄 · 머리글 없음), 재료 사전
  - 광고
    - 장소 검색(음식점만), 등록 + 규칙 7가지
    - 식당 목록에 광고 사진 · 메뉴 사진(자유 검색어엔 메뉴 사진 없음)
    - 목록 · 요약 · 수정 · 취소 · 종료 후 수정 409 · 재등록 · 진행 중 재등록 409
  - 감사 로그
- Playwright(실서버 · 실제 카카오 · 실제 저장소) 10개 통과
  - 실서버 어드민 로그인(목 유저 관리 화면도 열림)
  - 메뉴 사진 올리기 → 저장소 주소 미리보기 → 저장(PATCH), GIF는 올리기 전에 안내
  - 광고: 카카오 장소 검색 "순두부와청국장 차병원점" → 노출 메뉴 후보에 한식 메뉴 → 식당 사진 → 등록
  - 사용자 지도: 광고 식당에 식당 사진, 나머지 식당에 메뉴 사진
- 확인용으로 개발 DB에 만든 시험 광고와 '얼큰 순두부찌개' 시험 사진은 지웠다(저장소의 파일은 남아 있음)

**남은 것 · 확인 필요**
- 운영 저장소(S3 · R2 등)와 CDN 주소는 배포 때 정한다. 지금 사진 주소에 `localhost:9000`이 들어 있으니 운영 DB로 옮길 때는 주소를 바꿔야 한다
- 메뉴 · 광고에서 빠지거나 바뀐 옛 사진 파일을 지우는 정리 작업은 없다(나중에 주기 작업으로)
- 어드민 accessToken은 30분이고 프론트 어드민은 재발급을 하지 않는다. 30분이 지나면 다시 로그인해야 한다(2단계-5에서 정리)
- 다음: 2단계-3b 추천 · 통합 검색

## 2단계-3b · 오늘의 추천 · 통합 검색 (2026-10-19)

**서버**
- `modules/recommendations`
  - `GET /recommendations`(공개)
  - `GET /search`(공개)
- `recommendation-rules.ts` (순수 함수): plan.md "추천 로직"을 옮겼다
  - 날씨 태그: 비 · 진눈깨비 rain, 눈 snow, 12도 이하 cold, 26도 이상 hot, 맑음 clear
  - 이유 태그 · 설명 문장, 인기 모드 문구
  - 같은 점수일 때의 순서 값: 날짜 · 사용자 · 메뉴의 해시. 하루 동안 같고 날마다 달라진다
- 추천 순서
  1. 동네 이름 · 날씨(실패하면 null) · 취향을 동시에 가져온다
  2. 후보를 고른다. 개인 모드는 제외 필터를 거친다
  3. 점수를 매긴다
     - 개인: 매칭 % + 날씨 +6 − 어제까지 3일 안에 추천받았으면 −15
     - 인기: 7일 추천 수 순위 → 날씨
  4. 점수 순으로 2-3a 식당 검색을 해서 근처 식당이 있는 메뉴 5개가 차면 멈춘다(최대 12번)
  5. 하나도 없으면 `today: null` · `suggestRadiusM: 3000`(이미 3000이면 null)
  - 오늘 받은 추천은 감점하지 않는다. 새로 고쳐도 오늘 추천이 그대로다. 기록은 하루 한 번
- 통합 검색: 메뉴(이름 · 키워드, 최대 5) + 그 메뉴를 파는 식당(근거 순) → 이름 검색 식당(중복 제외)
- `PreferencesService.popularityRanks()`를 공개해 추천 · 검색이 함께 쓴다

**실제 API로 찾은 버그 (고침)**
- **기상청 "값 없음"(-999)을 기온으로 씀**: 동해 바다 좌표에서 날씨가 -999도로 나왔다
  - 기상청은 관측값이 없으면 -999 · +900 같은 표시를 준다
  - 이제 |값| ≥ 90은 값 없음으로 본다. 현재 기온이 없으면 날씨 null, 최고 · 최저만 없으면 null
- **인기 순위 건너뜀**: 근처 식당이 없어 빠진 메뉴도 순위를 차지해 2, 3, 4, 6위가 됐다 → 실제로 보여 주는 순서로 1~5위

**테스트 정리**
- 테스트 파일끼리 섞이던 문제를 고쳤다. vitest는 파일을 실행 시간 순으로 돌려 순서가 바뀐다
  - 추천 테스트: 메뉴를 숨겼다가 되돌리지 않아 취향 미리보기 테스트가 깨졌다 → 끝나면 원래 노출 상태로 되돌린다
  - 어드민 메뉴 테스트: 메뉴 개수를 절대값으로 봐서, 다른 파일이 만든 메뉴에 따라 결과가 달라졌다 → '테스트 …' 이름으로 거르고 개수는 시작 때 대비로 본다
    - 2026-10-19 처음 전체를 돌렸을 때 실패한 2개("Docker 직후 저장소 준비"로 적었던 것)도 실제 원인은 이것이었다
  - 날씨 · 검색 캐시 키(격자 · 좌표)가 파일끼리 겹쳐 다른 파일의 가짜 날씨가 나왔다 → 파일마다 좌표대를 나눴다
    - admin 35.x, restaurants 36.x, recommendations 38.x, 날씨 실패 34.x

**프론트**
- `NEXT_PUBLIC_API_REAL`에 `recommendations`(`/recommendations` · `/search`)를 추가했다. 이제 리뷰 · 어드민 유저 관리 · 신고만 목이다
- 실서버 취향을 목 취향에 맞추던 동기화를 지웠다(홈 추천이 실서버라 필요 없음). 로그인 상태 동기화만 남겼다(목 리뷰 화면용)

**확인한 것**
- 실제 카카오 · 기상청(curl)
  - 비로그인: 인기 모드 "짬뽕 · 이 근처 인기 1위 · 주변 45곳", 대안 4개
  - test@: 개인 모드 "얼큰 순두부찌개 92% · 매운맛 좋아함 / 오이·고수 등 제외 / 주변 45곳". 다시 불러도 같은 추천
  - 동해: 날씨 null(수정 후) · 식당 없음 → 3km 안내
  - 해외 422, 좌표 없음 400
  - 검색 "순두부": 메뉴 1(98%, 45곳) · 식당 54곳(이름 근거 먼저)
- 백엔드
  - `npm test` 67개(추천 규칙 6, 날씨 값 없음 1 추가), `npm run test:e2e` 12개
  - `npm run test:e2e:db` 83개(추천 · 검색 10 추가), 세 번 연속 통과
  - lint 경고 0, build 통과
- 추천 · 검색 DB e2e(카카오 · 기상청 가짜)
  - 추천 모드: 비로그인 인기 모드(순위 1~5, 식당 없는 메뉴 제외), 취향 없는 로그인도 인기 모드
  - 개인 모드
    - 새우 · 고수 메뉴 제외
    - 이유 4개 · 날씨 문장 · 식당 3곳
    - 다시 불러도 같은 추천, 기록 1번, /me 추천 수 1
    - 다른 메뉴 추천
  - 어제 추천 감점
  - 실패 · 경계: 날씨 실패 → null · 날씨 이유 없음, 근처 식당 없음 → 3km 안내 / 3km면 안내 없음, 좌표 없음 400 · 국내 밖 422
  - 검색: 매칭 % · 근처 수 · 식당 근거 순, 비로그인 · 취향 걸림 null, type · 빈 검색어 · 좌표 없음
- Playwright(실서버 · 실제 데이터) 7개 통과
  - 비로그인 홈 인기 모드 · 취향 배너
  - [다른 메뉴 추천] → 얼큰 순두부찌개 → 짬뽕
  - 로그인 홈 개인 모드(매칭 98%)
  - **홈 카드 찜 → 204**: 2-3a의 "홈 카드 찜 404"가 해결됐다
  - 검색 결과 화면
- 카카오 로그인 회귀 11개 통과
- 개발 서버 `start:dev`(nest --watch)가 이 PC에서 파일 변경을 놓쳐 새 코드를 안 읽는 일이 두 번 있었다. 백엔드를 고친 뒤 확인할 때는 서버를 직접 재시작한다

**남은 것 · 확인 필요**
- 인기 순위는 아직 "우리 서비스 전체 7일 추천 수"다. 위치별(이 근처) 집계는 데이터가 쌓이면 검토한다
- 추천 한 번에 카카오 검색이 메뉴마다(최대 12번 × 키워드) 일어난다. 10분 캐시가 있지만 사용자가 늘면 비용을 다시 본다
- 시간대(점심 · 저녁) 구분은 아직 없다(plan.md 입력 항목)
- 다음: 2단계-4 리뷰 · 신고 · 리뷰 사진(식당 이미지 맨 앞 순서 포함)

## 2단계-4 · 리뷰 · 신고 · 리뷰 사진 (2026-10-19)

**결정**
- 리뷰 사진 업로드는 API.md 계약(`POST /uploads/review-photos` → `{ photoId, uploadUrl }` → 앱이 PUT)을 그대로 두고, `uploadUrl`을 우리 서버 주소로 만들었다
  - 주소에 사진 id와 만료(10분)를 HMAC으로 서명해 담는다. 로그인 헤더 없이 PUT 한 번만 된다
  - 서버가 파일 내용으로 JPG · PNG · WEBP, 5MB를 확인하고 저장소(`reviews/`)에 올린다. 어드민 사진과 같은 이유(RustFS가 presigned PUT의 형식을 막지 못함 · CORS)
  - 사진 한도를 API.md의 10MB에서 5MB로 맞췄다(어드민 사진과 같은 한도)
- 태그는 서버가 정한 7개 목록에서만 받는다. 메뉴는 직접 입력을 받는다(항목당 20자)
- 정지 사용자는 등록 · 수정 · 사진 주소 발급 · 신고가 막히고 삭제는 된다. 정지 기간이 지났으면 상태가 아직 suspended여도 쓸 수 있다
- 하루 한 개는 KST 날짜 기준, 삭제한 리뷰는 세지 않는다. 같은 사용자 · 식당 동시 등록은 Postgres advisory lock으로 줄 세운다
- 집계는 더하고 빼지 않고 다시 센다(별점 합 · 리뷰 수, 메뉴 근거 = 그 메뉴를 먹은 사람 수). 수정 · 삭제가 섞여도 어긋나지 않는다
- 식당 사진 순서: 가장 최근 리뷰의 첫 사진 → 광고 · 입점 사진 → 메뉴 사진 → null

**백엔드**
- `config/env.ts`: `API_PUBLIC_URL`(기본 `http://localhost:4000`). `.env` · `.env.example`에도 추가
- `integrations/storage`: 폴더 `reviews` 추가
- `modules/reviews/`
  - `review-rules.ts`: 입력 정리 · 규칙(`REVIEW_TOO_LONG` · `TOO_MANY_PHOTOS` · 태그 목록), 업로드 주소 서명 · 확인
  - `review-access.service.ts`: 쓸 수 있는 사용자인지(탈퇴 401, 정지 403 + until)
  - `reviews.service.ts`: 목록(정렬 4가지, DB에서 offset 페이지), 리뷰 쓰기 폼, 등록 · 수정 · 삭제(soft) · 신고, 사진 붙이기 · 떼기, 집계 다시 세기
  - `review-photos.service.ts`: 업로드 주소 발급, PUT 업로드(한 번만, 동시 업로드도 처음 것만)
  - `reviews.controller.ts`: 컨트롤러 3개(`restaurants/:placeId/…`, `me/reviews` · `reviews/:id`, `uploads/review-photos`). PUT 본문은 스트림으로 직접 읽고 6MB에서 끊는다
- `restaurant-view.service.ts`: 식당마다 최근 리뷰 사진을 쿼리 1번(`DISTINCT ON`)으로 붙인다

**프론트**
- `NEXT_PUBLIC_API_REAL`에 `reviews` 추가(리뷰 목록 · 쓰기 폼 · 사진 · 내 리뷰 · 수정 · 삭제 · 신고). `restaurants` 묶음에서 리뷰 경로를 뺐다
- 리뷰 쓰기: 사진 PUT 실패를 무시하던 것을 고쳐 "사진을 올리지 못했어요" 안내. 고를 때 JPG · PNG · WEBP · 5MB만 담는다
- MY 리뷰 카드 썸네일에 리뷰 첫 사진

**확인한 것**
- 백엔드: `npm test` 71개(리뷰 규칙 4 추가), `npm run test:e2e` 12개, `npm run test:e2e:db` 97개(리뷰 14 추가) 두 번 연속 통과, lint 경고 0, build 통과
- 리뷰 DB e2e(카카오 가짜, 사진은 테스트 버킷에 실제 업로드)
  - 사진: 발급 → PUT 204 → 다시 PUT 409, 서명 틀림 403, HTML 400, 6장 400, 올리지 않은 사진 · 남의 사진은 리뷰에 못 붙임
  - 등록: 별점 · 리뷰 수 · 메뉴 근거 · 식당 사진 반영, 하루 한 개 409 · 다음 날 가능, 500자 초과 · 없는 태그 · 별점 6 · 없는 식당 · 비로그인
  - 정지 사용자 403 + until, 기간 지나면 가능
  - 목록 정렬 4가지 · 페이지 · isMine, 상세 최근 2개 · 별점 분포, 쓰기 폼 메뉴 순서, 내 리뷰
  - 수정(남의 것 403, 보낸 항목만, 사진 떼면 식당 사진도 빠짐), 신고(내 것 403 · 사유 · 메모 200자 · 409), 삭제(목록 · 집계에서 빠지고 기록 유지, 같은 날 다시 쓰기 가능)
- Playwright(실서버 · 실제 카카오 식당) 21개 통과
  - 리뷰 쓰기 폼 → GIF 거절 → 사진 PUT → 등록, 상세 최근 리뷰, 하루 한 개 안내
  - 모두 보기의 리뷰 사진, 다시 열면 식당 사진 = 리뷰 사진
  - 다른 사용자 리뷰 신고 · 다시 신고 안내
  - MY 카드 사진 · 수정 · 삭제
- 확인용으로 개발 DB에 쓴 리뷰는 API로 지우고 확인용 사용자는 탈퇴시켰다

**남은 것 · 확인 필요**
- 리뷰에 붙이지 않은 사진 · 뗀 사진(저장소 파일)을 지우는 정리 작업이 없다. 운영 전에 만든다
- 사진 주소 발급 횟수 제한이 없다(요청 과다 제한 `RATE_LIMITED`와 같이 정한다)
- 신고 처리(어드민)는 2단계-5. 신고가 쌓인 리뷰를 자동으로 숨기지는 않는다
- 다음: 2단계-5 어드민 유저 관리 · 리뷰 신고 처리 · 어드민 토큰 갱신

## 2단계-4 보충 · 예시 이미지 표시 (2026-10-19)

**결정**
- 법적 분쟁을 피하려고, 이 식당의 실제 사진이 아닌 이미지에는 모든 화면에서 "예시"를 표시한다(사용자 결정)
  - 실제 사진: 리뷰 사진 · 광고(사장님 제공) 사진 → 표시 없음. "예시"라고 쓰면 사실과 달라서 뺐다
  - 예시: 메뉴 대표 사진(메뉴 검색 대체) · 종류별 일러스트 · 아이콘
  - 큰 사진(지도 상세, 찜 카드): 사진 오른쪽 아래에 작은 글씨 "예시 이미지로, 실제 식당 음식과 다를 수 있어요"
  - 썸네일(지도 · 근처 목록, 리뷰 쓰기 창): 왼쪽 위 "예시" 배지
  - 홈 · 취향의 메뉴 소개 카드는 특정 식당 사진이 아니라서 제외

**백엔드**
- `RestaurantViewService.build()`: `imageSource`(`review` · `sponsored` · `menu` · null)를 `imageUrl`과 같은 순서로 정한다(`pickImage`)
- 테스트: 리뷰 DB e2e(리뷰 사진 → review, 뗀 뒤 → null), 어드민 DB e2e(광고 사진 → sponsored, 메뉴 사진 → menu)

**프론트**
- `types/restaurant.ts` `imageSource`, 목에도 추가
- `FoodImage`: `exampleNotice`("caption" | "badge"), `isExampleImage(r)`, `EXAMPLE_IMAGE_NOTICE`
- `RestaurantDetailContent` · `RestaurantCard` = 문구, `RestaurantRow` · `WriteReviewModal` = 배지

**확인한 것**
- 백엔드 `npm test` 71, `npm run test:e2e:db` 97 통과, lint 경고 0
- Playwright 7개 통과: 목록 배지(사진 없는 식당 있음 · 리뷰 사진 식당 없음), 상세 문구(있음 · 없음), 찜 카드 문구, 모바일 목록 배지. 확인용 리뷰 · 찜은 지웠다
- 개발 서버: 이 PC의 PATH에 `%SystemRoot%\system32`가 풀리지 않은 글자로 들어 있어 `nest --watch`가 재시작할 때 `taskkill`을 못 찾고 죽었다. 이번에는 System32를 PATH 앞에 붙여 띄웠고 코드 변경 후 자동 재시작이 됐다
