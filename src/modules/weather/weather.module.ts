import { Module } from '@nestjs/common';
import { KmaClient } from '../../integrations/kma/kma.client.js';
import { WeatherController } from './weather.controller.js';
import { WeatherService } from './weather.service.js';

@Module({
  controllers: [WeatherController],
  providers: [WeatherService, KmaClient],
  // 2단계-3b 추천이 날씨를 쓴다
  exports: [WeatherService],
})
export class WeatherModule {}
