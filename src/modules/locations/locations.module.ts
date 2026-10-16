import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller.js';
import { LocationsService } from './locations.service.js';

@Module({
  controllers: [LocationsController],
  providers: [LocationsService],
  // 2단계-3 추천 응답의 location(동네 이름)에 쓴다
  exports: [LocationsService],
})
export class LocationsModule {}
