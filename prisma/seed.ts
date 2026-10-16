// 개발용 기본 데이터. `npx prisma db seed`로 넣는다. 여러 번 실행해도 같은 결과(upsert)
// 메뉴 · 재료 사전은 프론트 목 데이터(lunchtime-fe/lib/api/mock)에서 뽑은 seed-data.json을 쓴다
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import {
  PrismaClient,
  type MenuWeather,
} from '../src/generated/prisma/client.js';

interface SeedData {
  menus: {
    id: string;
    name: string;
    cuisine: string;
    category: string;
    imageUrl: string | null;
    ingredients: string[];
    tastes: string[];
    spiceLevel: number;
    weathers: MenuWeather[];
    kakaoKeyword: string;
    kakaoCategory: string;
    visible: boolean;
  }[];
  options: { ingredients: string[]; allergies: string[]; cuisines: string[] };
  dictionary: string[];
  allergens: Record<string, string[]>;
  preferences: {
    dislikedIngredients: string[];
    allergies: string[];
    spiceLevel: number | null;
    favoriteCuisines: string[];
  };
}

// 프론트 목과 같은 테스트 계정
const TEST_EMAIL = {
  email: 'test@lunchtime.dev',
  password: 'lunch1234',
  name: '지민',
};
// 어드민 OTP는 TOTP라 고정 숫자가 아니다. 인증 앱에 아래 비밀값을 등록해서 쓴다 (개발용)
const DEV_ADMIN = {
  loginId: 'admin',
  password: 'admin1234',
  name: '운영자',
  otpSecret: 'JBSWY3DPEHPK3PXP',
};

const data = JSON.parse(
  readFileSync(new URL('./seed-data.json', import.meta.url), 'utf8'),
) as SeedData;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] }),
});

async function main() {
  for (const menu of data.menus) {
    await prisma.menu.upsert({
      where: { id: menu.id },
      create: menu,
      update: menu,
    });
  }

  const optionSet = new Set(data.options.ingredients);
  const ingredients = [
    ...new Set([...data.options.ingredients, ...data.dictionary]),
  ];
  for (const [i, name] of ingredients.entries()) {
    const row = { inOptions: optionSet.has(name), sortOrder: i };
    await prisma.ingredient.upsert({
      where: { name },
      create: { name, ...row },
      update: row,
    });
  }

  for (const [i, name] of data.options.allergies.entries()) {
    const row = { ingredients: data.allergens[name] ?? [], sortOrder: i };
    await prisma.allergy.upsert({
      where: { name },
      create: { name, ...row },
      update: row,
    });
  }

  const passwordHash = await argon2.hash(TEST_EMAIL.password);
  const user = await prisma.user.upsert({
    where: {
      provider_providerId: { provider: 'email', providerId: TEST_EMAIL.email },
    },
    create: {
      provider: 'email',
      providerId: TEST_EMAIL.email,
      email: TEST_EMAIL.email,
      passwordHash,
      name: TEST_EMAIL.name,
      onboardingCompleted: true,
    },
    update: { passwordHash },
  });
  await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data.preferences },
    update: data.preferences,
  });

  const adminHash = await argon2.hash(DEV_ADMIN.password);
  await prisma.adminUser.upsert({
    where: { loginId: DEV_ADMIN.loginId },
    create: {
      loginId: DEV_ADMIN.loginId,
      passwordHash: adminHash,
      name: DEV_ADMIN.name,
      otpSecret: DEV_ADMIN.otpSecret,
    },
    update: { passwordHash: adminHash, otpSecret: DEV_ADMIN.otpSecret },
  });

  console.log(
    `seed 완료: 메뉴 ${data.menus.length}, 재료 ${ingredients.length}, 알레르기 ${data.options.allergies.length}, ` +
      `사용자 ${TEST_EMAIL.email}, 어드민 ${DEV_ADMIN.loginId} (OTP 비밀값 ${DEV_ADMIN.otpSecret})`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
