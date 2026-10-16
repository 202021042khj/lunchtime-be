import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

// API.md Preferences. 알레르기 · 음식 종류가 선택지에 있는지는 서비스에서 확인한다
export class PreferencesDto {
  @ApiProperty({ example: ['오이', '고수'] })
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  dislikedIngredients: string[];

  @ApiProperty({ example: ['갑각류 (새우·게)'] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  allergies: string[];

  @ApiProperty({
    nullable: true,
    minimum: 0,
    maximum: 4,
    example: 3,
    description: '건너뛰면 null',
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(0)
  @Max(4)
  spiceLevel: number | null;

  @ApiProperty({ example: ['한식', '일식'] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  favoriteCuisines: string[];
}

export class SavePreferencesDto extends PreferencesDto {
  @ApiPropertyOptional({ description: '온보딩 끝 · "나중에 할게요"에서 true' })
  @IsOptional()
  @IsBoolean()
  completeOnboarding?: boolean;
}

export class IngredientQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  q?: string;
}
