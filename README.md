# lunchtime-be

lunchtime(점심 메뉴 추천) 백엔드 API. NestJS + PostgreSQL + Prisma.

- 프론트: `../lunchtime-fe` (Next.js)
- API 계약서: `../lunchtime-fe/API.md`
- 구조 · 규칙: [docs/CONVENTIONS.md](docs/CONVENTIONS.md)
- 단계별 기록: [log.md](log.md)

## 준비물

- Node.js 24, npm 11
- Docker Desktop (PostgreSQL 17 · Redis 7을 docker-compose로 띄운다)

## 처음 실행

```bash
npm install                 # prisma generate도 같이 돈다
cp .env.example .env        # JWT_SECRET · ADMIN_JWT_SECRET은 32자 이상, 서로 다르게
npm run db:up               # Postgres(5432) · Redis(6379)
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
| `npm run lint` / `npm run format` | oxlint / prettier |
| `npm run db:up` / `npm run db:down` | docker-compose 켜기 / 끄기 (데이터는 볼륨에 남음) |
| `npm run db:migrate` | 스키마 변경 → 마이그레이션 만들고 반영 |
| `npm run db:seed` | 개발용 데이터 넣기 (여러 번 해도 같음) |
| `npm run db:studio` | Prisma Studio (DB를 표로 보기) |

## 개발용 계정 (seed)

| 구분 | 값 |
| --- | --- |
| 이메일 계정 | `test@lunchtime.dev` / `lunch1234` |
| 어드민 | `admin` / `admin1234` + OTP. OTP는 인증 앱(Google Authenticator 등)에 비밀값 `JBSWY3DPEHPK3PXP`를 등록해서 나온 6자리 |

## 환경 변수

| 이름 | 설명 |
| --- | --- |
| `PORT` | 기본 4000 |
| `CORS_ORIGIN` | 프론트 주소, 쉼표로 여러 개 (기본 `http://localhost:3000`) |
| `DATABASE_URL` | `postgresql://lunchtime:lunchtime@localhost:5432/lunchtime?schema=public` |
| `REDIS_URL` | `redis://localhost:6379` |
| `JWT_SECRET` / `ADMIN_JWT_SECRET` | 사용자 / 어드민 토큰 서명. 32자 이상, 서로 달라야 함 |
| `KAKAO_REST_KEY` / `KMA_SERVICE_KEY` | 카카오 로컬 · 기상청 (2단계-3부터) |

값이 틀리면 서버가 켜지지 않고 어떤 항목이 틀렸는지 보여 준다.
