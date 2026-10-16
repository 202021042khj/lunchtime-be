import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import {
  CoordQueryDto,
  LocationSearchQueryDto,
  SavedLocationInputDto,
} from './locations.dto.js';
import { LocationsService } from './locations.service.js';

@ApiTags('locations')
@Controller()
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('me/locations')
  @ApiBearerAuth('user')
  @ApiOperation({ summary: '저장한 위치 목록' })
  list(@CurrentUser() user: AuthUser) {
    return this.locations.list(user.id);
  }

  @Post('me/locations')
  @ApiBearerAuth('user')
  @ApiOperation({ summary: '위치 저장 (최대 10개)' })
  add(@CurrentUser() user: AuthUser, @Body() body: SavedLocationInputDto) {
    return this.locations.add(user.id, body);
  }

  @Delete('me/locations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('user')
  @ApiOperation({ summary: '저장한 위치 삭제' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.locations.remove(user.id, id);
  }

  @Public()
  @Get('locations/search')
  @ApiOperation({ summary: '동네 · 도로명 · 건물명 검색 (카카오)' })
  search(@Query() query: LocationSearchQueryDto) {
    return this.locations.search(query.q);
  }

  @Public()
  @Get('locations/reverse')
  @ApiOperation({ summary: '좌표 → 동네 이름 (국내만, 아니면 422)' })
  reverse(@Query() query: CoordQueryDto) {
    return this.locations.reverse(query.lat, query.lng);
  }
}
