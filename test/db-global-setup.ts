import { execSync } from 'node:child_process';
import pg from 'pg';
import {
  ADMIN_DATABASE_URL,
  TEST_DATABASE_URL,
  TEST_DB_NAME,
} from './db-env.js';

// 테스트 DB 준비: 없으면 만들고, 마이그레이션을 적용하고(데이터를 지우지 않는 deploy), 테이블을 비운다.
// 비우는 대상은 localhost의 lunchtime_test로 고정한다 (개발 DB와 다른 DB는 절대 건드리지 않음)
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  if (url.hostname !== 'localhost' || url.pathname !== `/${TEST_DB_NAME}`) {
    throw new Error(`테스트 DB 주소가 아닙니다: ${TEST_DATABASE_URL}`);
  }

  const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  const exists = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [TEST_DB_NAME],
  );
  if (exists.rowCount === 0)
    await admin.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
  await admin.end();

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });

  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  const { rows } = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  if (rows.length) {
    await db.query(
      `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`,
    );
  }
  await db.end();
}
