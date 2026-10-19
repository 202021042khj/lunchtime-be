import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

// 개수 · 글자 수(REVIEW_TOO_LONG · TOO_MANY_PHOTOS)는 API.md 에러 코드로 답하려고 서비스(review-rules)에서 확인한다
export class ReviewInputDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 4 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ type: [String], example: ['순두부찌개'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  menus?: string[];

  @ApiPropertyOptional({ type: [String], example: ['국물이 진해요'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  // 500자 초과는 REVIEW_TOO_LONG. 터무니없이 긴 값만 여기서 끊는다
  @MaxLength(5000)
  content?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: '사진 업로드 API가 준 photoId (최대 5)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoIds?: string[];
}

export class ReviewPatchDto extends PartialType(ReviewInputDto) {}

const SORTS = ['recent', 'rating_desc', 'rating_asc', 'photo'] as const;
export type ReviewSort = (typeof SORTS)[number];

export class ReviewPageQueryDto {
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

export class ReviewListQueryDto extends ReviewPageQueryDto {
  @ApiPropertyOptional({ enum: SORTS })
  @IsOptional()
  @IsIn(SORTS)
  sort?: ReviewSort;
}

const REASONS = ['abuse', 'ad', 'false_info', 'irrelevant'] as const;

export class ReviewReportDto {
  @ApiProperty({ enum: REASONS })
  @IsIn(REASONS, { message: '신고 사유를 골라 주세요.' })
  reason: (typeof REASONS)[number];

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200, { message: '메모는 200자까지 쓸 수 있어요.' })
  memo?: string | null;
}

export class PhotoSlotsDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 2 })
  // 5장 초과는 TOO_MANY_PHOTOS (서비스에서)
  @IsInt()
  @Min(1)
  count: number;
}
