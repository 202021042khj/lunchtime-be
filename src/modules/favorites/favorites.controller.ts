import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { CurrentUser } from '../../common/auth/decorators.js';
import { OptionalCoordQueryDto } from '../restaurants/restaurants.dto.js';
import { FavoritesService } from './favorites.service.js';

export class FavoritesQueryDto extends OptionalCoordQueryDto {
  @ApiPropertyOptional({
    example: '한식',
    description: '음식 종류. 없으면 전체',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cuisine?: string;

  @ApiPropertyOptional({ enum: ['recent'] })
  @IsOptional()
  @IsIn(['recent'])
  sort?: 'recent';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ example: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

@ApiTags('favorites')
@ApiBearerAuth('user')
@Controller('me/favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @ApiOperation({
    summary: '찜한 식당 (최근 찜한 순). lat · lng를 주면 거리 계산',
  })
  list(@CurrentUser() user: AuthUser, @Query() query: FavoritesQueryDto) {
    const origin =
      query.lat !== undefined && query.lng !== undefined
        ? { lat: query.lat, lng: query.lng }
        : null;
    return this.favorites.list(user.id, {
      origin,
      cuisine: query.cuisine,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Put(':placeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '찜하기 (여러 번 불러도 한 번만)' })
  async add(@CurrentUser() user: AuthUser, @Param('placeId') placeId: string) {
    await this.favorites.add(user.id, placeId);
  }

  @Delete(':placeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '찜 해제' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('placeId') placeId: string,
  ) {
    await this.favorites.remove(user.id, placeId);
  }
}
