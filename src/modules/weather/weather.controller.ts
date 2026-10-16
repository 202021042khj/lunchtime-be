import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators.js';
import { CoordQueryDto } from '../locations/locations.dto.js';
import { WeatherService } from './weather.service.js';

@ApiTags('weather')
@Controller('weather')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: '현재 기온 · 하늘 · 오늘 최고/최저 (기상청, 실패하면 502)',
  })
  get(@Query() query: CoordQueryDto) {
    return this.weather.current(query.lat, query.lng);
  }
}
