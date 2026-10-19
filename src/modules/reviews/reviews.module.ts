import { Module } from '@nestjs/common';
import { RestaurantsModule } from '../restaurants/restaurants.module.js';
import { ReviewAccess } from './review-access.service.js';
import { ReviewPhotosService } from './review-photos.service.js';
import {
  RestaurantReviewsController,
  ReviewPhotosController,
  ReviewsController,
} from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

@Module({
  imports: [RestaurantsModule],
  controllers: [
    RestaurantReviewsController,
    ReviewsController,
    ReviewPhotosController,
  ],
  providers: [ReviewsService, ReviewPhotosService, ReviewAccess],
})
export class ReviewsModule {}
