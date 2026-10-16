import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SavedLocationInputDto {
  @ApiProperty({ example: '회사' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  label: string;

  @ApiProperty({ example: '역삼동', description: '동네' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  name: string;

  @ApiProperty({ example: '서울 강남구 테헤란로 123' })
  @IsString()
  @MaxLength(100)
  address: string;

  @ApiProperty({ example: 37.5006 })
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: 127.0365 })
  @IsLongitude()
  lng: number;
}

export class LocationSearchQueryDto {
  @ApiPropertyOptional({ example: '역삼' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  q?: string;
}

export class CoordQueryDto {
  @ApiProperty({ example: 37.5006 })
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: 127.0365 })
  @Type(() => Number)
  @IsLongitude()
  lng: number;
}
