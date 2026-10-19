import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import { RecommendationsService } from './recommendations.service.js';

// 좌표는 선택으로 받고, 없으면 서비스가 400 LOCATION_REQUIRED
class CoordOptionalDto {
  @ApiPropertyOptional({ example: 37.5006 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ example: 127.0365 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}

export class RecommendationQueryDto extends CoordOptionalDto {
  @ApiPropertyOptional({ example: 1000, maximum: 3000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(3000)
  radiusM?: number;

  @ApiPropertyOptional({
    example: 'm_12,m_7',
    description: '[다른 메뉴 추천]: 이미 본 메뉴 빼고',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  excludeMenuIds?: string[];
}

export class SearchQueryDto extends CoordOptionalDto {
  @ApiPropertyOptional({ example: '순두부' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  q?: string;

  @ApiPropertyOptional({ enum: ['all', 'menu', 'restaurant'] })
  @IsOptional()
  @IsIn(['all', 'menu', 'restaurant'])
  type?: 'all' | 'menu' | 'restaurant';
}

@ApiTags('recommendations')
@Controller()
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Public()
  @Get('recommendations')
  @ApiOperation({
    summary: '오늘의 추천 1 + 다른 후보 4 (비로그인 · 취향 없음은 인기 모드)',
  })
  recommend(
    @Query() query: RecommendationQueryDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.recommendations.recommend(query, user?.id);
  }

  @Public()
  @Get('search')
  @ApiOperation({ summary: '통합 검색: 메뉴(매칭 % · 근처 식당 수) + 식당' })
  search(@Query() query: SearchQueryDto, @CurrentUser() user?: AuthUser) {
    return this.recommendations.search(query, user?.id);
  }
}
