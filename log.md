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
