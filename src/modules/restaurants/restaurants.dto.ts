import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// 좌표는 선택으로 받고, 없으면 서비스가 400 LOCATION_REQUIRED (API.md: 앱은 위치 설정으로 안내)
export class RestaurantQueryDto {
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

  @ApiPropertyOptional({
    example: 'm_12',
    description: '메뉴 마스터의 키워드 · 카테고리로 검색. 없으면 q',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  menuId?: string;

  @ApiPropertyOptional({ example: '순두부', description: '자유 검색어' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  q?: string;

  @ApiPropertyOptional({ example: 1000, maximum: 3000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(3000)
  radiusM?: number;

  @ApiPropertyOptional({ example: 4.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ enum: ['distance', 'reviews'] })
  @IsOptional()
  @IsIn(['distance', 'reviews'])
  sort?: 'distance' | 'reviews';

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

export class OptionalCoordQueryDto {
  @ApiPropertyOptional({
    description: '주면 거리(distanceM · walkMinutes)를 채운다',
  })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}

export class MenuReportDto {
  @ApiProperty({ example: 'm_12' })
  @IsString()
  @MaxLength(40)
  menuId: string;
}
