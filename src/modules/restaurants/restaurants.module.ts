import { Module } from '@nestjs/common';
import { PlaceCacheService } from './place-cache.service.js';
import { RestaurantViewService } from './restaurant-view.service.js';
import { RestaurantsController } from './restaurants.controller.js';
import { RestaurantsService } from './restaurants.service.js';
import { SponsoredPlacesService } from './sponsored-places.service.js';

@Module({
  controllers: [RestaurantsController],
  providers: [
    RestaurantsService,
    RestaurantViewService,
    PlaceCacheService,
    SponsoredPlacesService,
  ],
  // 찜 · 추천 · 통합 검색(2단계-3b)이 식당 검색 · 조립을 같이 쓴다
  exports: [RestaurantsService, RestaurantViewService, PlaceCacheService],
})
export class RestaurantsModule {}
