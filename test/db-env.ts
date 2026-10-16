// DB e2e 전용 DB. 개발 DB(lunchtime)와 섞이지 않게 lunchtime_test를 쓴다
export const TEST_DB_NAME = 'lunchtime_test';
const SERVER = 'postgresql://lunchtime:lunchtime@localhost:5432';
export const TEST_DATABASE_URL = `${SERVER}/${TEST_DB_NAME}?schema=public`;
// 테스트 DB를 만들 때 접속하는 관리용 DB
export const ADMIN_DATABASE_URL = `${SERVER}/postgres`;
