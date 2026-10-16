import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthCoreModule } from './common/auth/auth-core.module.js';
import { ClockModule } from './common/clock.js';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { CacheModule } from './integrations/cache/cache.module.js';
import { KakaoModule } from './integrations/kakao/kakao.module.js';
import { SocialAuthModule } from './integrations/social-auth.module.js';
import { MailModule } from './integrations/mail/mail.module.js';
import { StorageModule } from './integrations/storage/storage.service.js';
import { AdminAuditModule } from './modules/admin/audit/admin-audit.service.js';
import { AdminCatalogModule } from './modules/admin/admin-catalog.module.js';
import { AdminAuthModule } from './modules/admin/auth/admin-auth.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { FavoritesModule } from './modules/favorites/favorites.module.js';
import { LocationsModule } from './modules/locations/locations.module.js';
import { PreferencesModule } from './modules/preferences/preferences.module.js';
import { RestaurantsModule } from './modules/restaurants/restaurants.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { WeatherModule } from './modules/weather/weather.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    CacheModule,
    AuthCoreModule,
    ClockModule,
    MailModule,
    StorageModule,
    KakaoModule,
    SocialAuthModule,
    AdminAuditModule,
    // 기능 모듈 (docs/CONVENTIONS.md)
    AuthModule,
    UsersModule,
    PreferencesModule,
    LocationsModule,
    RestaurantsModule,
    FavoritesModule,
    WeatherModule,
    AdminAuthModule,
    AdminCatalogModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
