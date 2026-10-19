import { Module } from '@nestjs/common';
import { LocationsModule } from '../locations/locations.module.js';
import { PreferencesModule } from '../preferences/preferences.module.js';
import { RestaurantsModule } from '../restaurants/restaurants.module.js';
import { WeatherModule } from '../weather/weather.module.js';
import { RecommendationsController } from './recommendations.controller.js';
import { RecommendationsService } from './recommendations.service.js';

// 오늘의 추천 · 통합 검색 (취향 · 날씨 · 식당 검색을 합친다)
@Module({
  imports: [
    PreferencesModule,
    RestaurantsModule,
    WeatherModule,
    LocationsModule,
  ],
  controllers: [RecommendationsController],
  providers: [RecommendationsService],
})
export class RecommendationsModule {}
