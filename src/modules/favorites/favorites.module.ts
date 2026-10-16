import { Module } from '@nestjs/common';
import { RestaurantsModule } from '../restaurants/restaurants.module.js';
import { FavoritesController } from './favorites.controller.js';
import { FavoritesService } from './favorites.service.js';

@Module({
  imports: [RestaurantsModule],
  controllers: [FavoritesController],
  providers: [FavoritesService],
})
export class FavoritesModule {}
