import {
  Body,
  Controller,
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
  MenuReportDto,
  OptionalCoordQueryDto,
  RestaurantQueryDto,
} from './restaurants.dto.js';
import { RestaurantsService } from './restaurants.service.js';

@ApiTags('restaurants')
@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary:
      '근처 식당 검색 (카카오 + 별점 · 찜 · 광고). menuId면 근거 순서로 정렬',
  })
  list(@Query() query: RestaurantQueryDto, @CurrentUser() user?: AuthUser) {
    return this.restaurants.list(query, user?.id);
  }

  @Public()
  @Get(':placeId')
  @ApiOperation({
    summary:
      '식당 상세 + 최근 리뷰 2개 + 별점 분포 (lat · lng를 주면 거리 계산)',
  })
  detail(
    @Param('placeId') placeId: string,
    @Query() query: OptionalCoordQueryDto,
    @CurrentUser() user?: AuthUser,
  ) {
    const origin =
      query.lat !== undefined && query.lng !== undefined
        ? { lat: query.lat, lng: query.lng }
        : null;
    return this.restaurants.detail(placeId, origin, user?.id);
  }

  @Public()
  @Post(':placeId/click')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '광고 식당 클릭 집계' })
  async click(@Param('placeId') placeId: string) {
    await this.restaurants.click(placeId);
  }

  @Post(':placeId/menu-reports')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('user')
  @ApiOperation({
    summary: '"이 메뉴 안 팔아요" 제보 (같은 식당 · 메뉴는 한 번)',
  })
  async reportMenu(
    @CurrentUser() user: AuthUser,
    @Param('placeId') placeId: string,
    @Body() body: MenuReportDto,
  ) {
    await this.restaurants.reportMenu(user.id, placeId, body.menuId);
  }
}
