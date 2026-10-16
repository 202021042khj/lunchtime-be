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
