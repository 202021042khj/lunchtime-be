# lunchtime-be 구조 · 규칙

Nest CLI 기본 뼈대(ESM, vitest, oxlint) 위에 이 프로젝트에서 정한 규칙이다. 남의 템플릿 대신 여기 적힌 것을 기준으로 한다.

- **API 계약서는 `lunchtime-fe/API.md`다.** 경로 · 요청 · 응답 · 에러 코드를 여기서 새로 정하지 않는다. 바꿔야 하면 API.md를 먼저 고친다.
- 프론트 타입은 `/docs-json`(OpenAPI)과 맞춰 본다(2단계-6).

## 폴더

```
src/
  main.ts              서버 시작 (configureApp + listen)
  app.setup.ts         /v1 접두사, 검증 파이프, 에러 필터, CORS, Swagger — main과 e2e가 같이 쓴다
  app.module.ts
  config/env.ts        환경 변수 검사(zod). 틀리면 서버가 켜지지 않는다
  prisma/              PrismaService (전역)
  generated/prisma/    prisma generate 결과 (git 제외, npm install 때 자동 생성)
  common/
    errors/            ERROR_CODES(API.md 에러 코드 표) · AppException
    filters/           모든 실패를 { error: { code, message, fields?, until? } }로
    auth/              토큰 발급 · 검증(TokenService), 전역 AuthGuard, @Public · @AdminRoute · @CurrentUser · @CurrentAdmin
    validation.ts      class-validator 오류 → VALIDATION_FAILED + fields
    clock.ts           Clock (현재 시각, 테스트에서 시간을 옮기려고 주입)
    time.ts            toKstIso: 응답 시각은 +09:00
    cursor.ts          paginate(items, cursor, limit): API.md 커서 목록 (한 번에 모은 목록을 자를 때)
  integrations/        외부 서비스 연결. 비즈니스 규칙은 두지 않는다
    cache/             RedisService.cached(key, ttl, load): 캐시. Redis가 안 되면 캐시 없이 load()만 (캐시 장애로 API가 실패하지 않게)
    storage/           StorageService(S3 호환): 어드민 사진 저장(첫 바이트로 형식 확인 · 5MB) · 우리 저장소 주소인지 확인, 개발 환경은 버킷 · 공개 읽기 자동 생성
    mail/              MailService(추상) · LogMailService(개발: 서버 로그에 인증번호)
    kakao/             KakaoAuthClient(로그인), KakaoLocalClient(주소 · 키워드 검색, 좌표→동네. 국내 밖 좌표는 422)
    google/ apple/     GoogleAuthClient · AppleAuthClient (OIDC: 코드 교환 + ID 토큰 검증은 jose, 애플 client_secret JWT · 토큰 폐기)
    social-auth.module.ts  구글 · 애플 클라이언트 묶음
    kma/               KmaClient(기상청 단기예보) · kma-grid.ts(위경도 → 격자, 발표 시각)
  modules/             기능 모듈 (2단계-1부터)
    auth/              /auth/* (소셜 · 이메일), /me/password
    users/             /me
    preferences/       /me/preferences, /preferences/*, /ingredients
    locations/         /me/locations, /locations/*
    favorites/         /me/favorites
    restaurants/       /restaurants, /search, 메뉴 제보
    recommendations/   /recommendations, /weather
    reviews/           리뷰 · 신고 · 사진 업로드 · place_stats
    admin/
      auth/            /admin/auth/*, /admin/me
      users/ sponsored/ menus/ reports/
  health/              GET /health (DB · Redis)
prisma/
  schema.prisma        DB 스키마
  migrations/          prisma migrate dev가 만든다 (git에 올린다)
  seed.ts              개발용 데이터, seed-data.json = 프론트 목 데이터에서 뽑은 메뉴 · 재료 사전
test/                  e2e (supertest). 단위 테스트는 src 안 *.spec.ts
```

## 모듈 하나의 모양

```
modules/reviews/
  reviews.module.ts
  reviews.controller.ts        경로 · 인증 표시 · Swagger 설명만. 로직 없음
  reviews.service.ts           비즈니스 규칙 (하루 1개, place_stats 갱신 …)
  dto/create-review.dto.ts     요청: class-validator, 응답: Swagger용 클래스
  reviews.service.spec.ts      규칙이 있는 service는 단위 테스트
```

- Prisma는 service에서 바로 쓴다. 같은 쿼리를 여러 곳에서 쓰거나 복잡해지면 그때 `*.repository.ts`로 뺀다.
- 다른 모듈의 데이터가 필요하면 그 모듈 service를 export해서 쓴다. 다른 모듈 테이블을 직접 고치지 않는다(예: 리뷰 삭제 → place_stats 갱신은 reviews가 맡는다).
- 여러 테이블을 함께 바꾸면 `prisma.$transaction`으로 묶는다.
- 응답 모양은 API.md 그대로 만든다. DB 모델을 그대로 내보내지 않는다(예: `passwordHash`, `deletedAt`). 모델 → 응답 변환은 service 안 `toXxx()` 함수로 둔다.

## 경로 · 인증

- 모든 API는 `/v1` 아래다(API.md 기본 URL). `/health`, `/docs`, `/docs-json`만 예외.
- 전역 `AuthGuard`가 모든 경로를 지킨다.
  - 아무 표시 없음 → 로그인 필수(사용자 토큰)
  - `@Public()` → 비로그인 허용. 맞는 사용자 토큰이 오면 `@CurrentUser()`를 채운다. 틀리거나 만료된 토큰은 비로그인으로 본다
  - `@AdminRoute()`(어드민 컨트롤러 클래스에) → 어드민 토큰만. 사용자 토큰은 401
  - 어드민 로그인처럼 어드민 경로인데 공개인 것은 `@AdminRoute()` + `@Public()`
- 사용자 · 어드민 토큰은 비밀값(`JWT_SECRET` / `ADMIN_JWT_SECRET`)과 `aud`(user / admin)가 다르다. accessToken은 사용자 1시간, 어드민 30분.
- 식당: 우리 DB에 식당 테이블은 없다. 카카오 검색 결과를 `PlaceCacheService`(Redis, 7일)에 기억해 두고 상세 · 찜에 쓴다. 찜은 표시 정보를 `Favorite`에 함께 저장한다. 별점 · 리뷰 수 · 찜 · 광고 · 영업시간은 `RestaurantViewService.build()`가 한 번에 붙인다(추천 · 통합 검색도 이걸 쓴다). 근거 · 정렬 · 영업 중 규칙은 `restaurant-rules.ts` 순수 함수
- 취향 점수 · 제외 규칙은 `modules/preferences/taste-scoring.ts`의 순수 함수로 둔다. 미리보기와 추천(2단계-3)이 같이 쓴다
- 정지 · 탈퇴 확인은 가드가 아니라 해당 service가 한다(정지 사용자는 조회는 되고 리뷰 · 신고만 막힘 → `USER_SUSPENDED`).

## 에러

- service는 `throw new AppException('REVIEW_DAILY_LIMIT')`처럼 **코드로만** 던진다. 상태 코드와 기본 문구는 `ERROR_CODES`가 정한다.
- 추가 정보: `new AppException('USER_SUSPENDED', undefined, { until })`, 검증 실패는 `fields`.
- 새 코드를 넣으면 `ERROR_CODES`, API.md "에러 코드", 프론트 `types/common.ts`를 같이 고친다.
- 예상 못 한 오류는 500 `INTERNAL_ERROR`로 바뀌고, 내부 메시지는 응답에 넣지 않고 로그에만 남긴다.

## 시각

- 지금 시각은 `new Date()` 대신 `Clock.now()`를 쓴다(만료 · 재전송 · 잠금을 테스트에서 시간을 옮겨 확인한다).
- DB에는 UTC로 저장하고, 응답에 내보낼 때는 `toKstIso()`로 `+09:00` 표기를 쓴다(API.md).

## 메일

- 서비스는 `MailService`만 주입받는다. 실제 발송(SES · Resend 등)을 붙일 때는 `integrations/mail/`에 `MailService`를 상속한 클래스를 추가하고 `mail.module.ts`의 `useClass`만 바꾼다.
- 외부 API 클라이언트(`integrations/*`)는 전역 `fetch` + 타임아웃(5초)을 쓰고, 상대가 4xx면 우리 쪽 의미의 코드(예: 401), 연결 실패 · 5xx면 502 `UPSTREAM_UNAVAILABLE`로 바꾼다. 테스트는 단위에서 `fetch`를, e2e에서 클라이언트 자체를 가짜로 바꾼다
- 개발 전용 기능(어드민 OTP 고정값, `dev:` 소셜 토큰)은 `isDevelopment(config)`로 감싸 운영에서 켜지지 않게 한다.

## 설정 · 비밀값

- 환경 변수는 `config/env.ts` 스키마에 먼저 추가하고 `ConfigService<Env, true>`의 `get('KEY', { infer: true })`로 읽는다. `process.env`를 직접 읽지 않는다(시드 · prisma.config 제외).
- `.env`는 git에 올리지 않는다. 새 변수는 `.env.example`에도 적는다.

## DB

- 스키마를 바꾸면 `npm run db:migrate -- --name <무엇을>` → 마이그레이션 파일을 같이 커밋한다. Prisma 7은 마이그레이션 뒤 클라이언트를 자동으로 다시 만들지 않으니 `npx prisma generate`도 돌린다.
- id는 `cuid()` 문자열. 시드 메뉴만 프론트 목과 같은 id(`m_12` 등)를 쓴다.
- 식당 테이블은 없다. 식당은 카카오 `placeId`로 가리키고, 표시용 이름 · 좌표만 필요한 테이블에 같이 저장한다.
- 지우는 것: 리뷰는 `deletedAt`(기록 유지), 광고 취소는 `canceledAt`. 사용자 탈퇴는 `status: withdrawn`.

## 테스트

- `npm test`: 단위(`src/**/*.spec.ts`), `npm run test:e2e`: e2e(`test/*.e2e-spec.ts`).
- e2e는 `configureApp`을 그대로 써서 실제와 같은 접두사 · 필터 · 검증으로 돈다.
  - `npm run test:e2e` (`test/*.e2e-spec.ts`): DB 없이. `PrismaService` · `RedisService`를 가짜로 바꾼다
  - `npm run test:e2e:db` (`test/*.db-e2e-spec.ts`): docker-compose Postgres의 `lunchtime_test` DB를 쓴다. 시작할 때 DB가 없으면 만들고 `prisma migrate deploy` 후 테이블을 비운다(대상은 localhost의 lunchtime_test로 고정, 개발 DB는 건드리지 않음). `Clock` · `MailService`를 가짜로 바꿔 시간과 인증번호를 다룬다. 파일끼리는 차례로 돈다
  - `prisma migrate reset`은 쓰지 않는다(AI 도구가 실행하면 Prisma가 사용자 동의를 요구한다)
  - 외부 서비스 키(카카오 · 구글 · 애플)는 `vitest.config.e2e-db.ts`에서 빈 값으로 고정한다. 개발 `.env`에 넣은 실제 키가 테스트 결과를 바꾸지 않게 하려는 것이다
  - Redis는 개발 서버와 같이 쓰므로, 캐시를 확인하는 테스트는 실행마다 다른 키(검색어 · 좌표)를 쓴다

## 코드 스타일

- prettier(작은따옴표, trailing comma) + oxlint. 커밋 전에 `npm run format`, `npm run lint`.
- ESM이라 상대 경로 import에 `.js`를 붙인다(`./reviews.service.js`).
- 주석은 "왜"만 짧게, 한국어로.
