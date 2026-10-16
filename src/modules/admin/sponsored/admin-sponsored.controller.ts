import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { AuthAdmin } from '../../../common/auth/auth.types.js';
import { AdminRoute, CurrentAdmin } from '../../../common/auth/decorators.js';
import { AdminPageQueryDto } from '../common/admin-page.js';
import {
  AdminSponsoredService,
  type SponsoredStatus,
} from './admin-sponsored.service.js';

export class SponsoredPlaceDto {
  @ApiProperty() @IsString() @MaxLength(40) placeId: string;
  @ApiProperty() @IsString() @MaxLength(80) name: string;
  @ApiProperty() @IsString() @MaxLength(200) address: string;
  @ApiProperty() @IsNumber() lat: number;
  @ApiProperty() @IsNumber() lng: number;
  @ApiProperty({ example: '음식점 > 한식 > 찌개,전골' })
  @IsString()
  @MaxLength(100)
  category: string;
}

export class HoursDto {
  @ApiProperty({ example: '11:00' }) @IsString() open: string;
  @ApiProperty({ example: '21:00' }) @IsString() close: string;

  @ApiProperty({ nullable: true, example: ['15:00', '16:30'] })
  @ValidateIf((_, v) => v !== null)
  @IsArray()
  @IsString({ each: true })
  break: [string, string] | null;

  @ApiProperty({ example: ['sun'] })
  @IsArray()
  @IsIn(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], { each: true })
  closedDays: string[];
}

// 상세 규칙(반경 500 · 1000 · 2000 · 3000, 기간, 우선순위 1~99, 영업시간)은 서비스가 검사한다
export class SponsoredInputDto {
  @ApiProperty({ type: SponsoredPlaceDto })
  @ValidateNested()
  @Type(() => SponsoredPlaceDto)
  place: SponsoredPlaceDto;

  @ApiProperty({ example: ['m_12'] })
  @IsArray()
  @IsString({ each: true })
  targetMenuIds: string[];
  @ApiProperty({ example: ['찌개류'] })
  @IsArray()
  @IsString({ each: true })
  targetCategories: string[];
  @ApiProperty({ example: 1000 }) @IsInt() radiusM: number;
  @ApiProperty({ example: '2026-10-10' }) @IsString() startDate: string;
  @ApiProperty({ example: '2026-11-09' }) @IsString() endDate: string;

  @ApiProperty({ type: HoursDto, nullable: true })
  @ValidateIf((_, v) => v !== null)
  @ValidateNested()
  @Type(() => HoursDto)
  hours: HoursDto | null;

  @ApiProperty({ example: 1 }) @IsInt() priority: number;
  @ApiProperty({ example: 300000 }) @IsInt() feeKrw: number;
  @ApiProperty({ enum: ['pending', 'paid'] })
  @IsIn(['pending', 'paid'])
  paymentStatus: 'pending' | 'paid';

  @ApiPropertyOptional({
    nullable: true,
    description: '식당 사진 (POST /admin/uploads/images)',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  imageUrl?: string | null;
}

export class UpdateSponsoredDto extends PartialType(
  OmitType(SponsoredInputDto, ['place'] as const),
) {}
export class RenewSponsoredDto extends OmitType(SponsoredInputDto, [
  'place',
] as const) {}

export class SponsoredListQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'scheduled', 'ended'] })
  @IsOptional()
  @IsIn(['active', 'scheduled', 'ended'])
  status?: SponsoredStatus;
}

export class PlaceSearchQueryDto {
  @ApiPropertyOptional({ example: '순두부' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  q?: string;
  @ApiPropertyOptional()
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

@ApiTags('admin · sponsored')
@ApiBearerAuth('admin')
@AdminRoute()
@Controller('admin')
export class AdminSponsoredController {
  constructor(private readonly sponsored: AdminSponsoredService) {}

  @Get('sponsored/summary')
  @ApiOperation({
    summary: '진행 중 · 이번 달 광고 매출 · 평균 클릭률 · 입금 대기',
  })
  summary() {
    return this.sponsored.summary();
  }

  @Get('sponsored')
  @ApiOperation({ summary: '광고 목록 (진행 중 → 예약 → 종료, 우선순위 순)' })
  list(@Query() query: SponsoredListQueryDto) {
    return this.sponsored.list(query);
  }

  @Get('places/search')
  @ApiOperation({ summary: '카카오 장소 검색 (광고 등록용, 음식점만)' })
  searchPlaces(@Query() query: PlaceSearchQueryDto) {
    return this.sponsored.searchPlaces(query.q, query.lat, query.lng);
  }

  @Post('sponsored')
  @ApiOperation({ summary: '광고 고정 추가' })
  create(@CurrentAdmin() admin: AuthAdmin, @Body() body: SponsoredInputDto) {
    return this.sponsored.create(admin.id, body);
  }

  @Patch('sponsored/:id')
  @ApiOperation({
    summary: '수정 (기간 · 조건 · 결제 상태 · 사진). 종료된 광고는 409',
  })
  update(
    @CurrentAdmin() admin: AuthAdmin,
    @Param('id') id: string,
    @Body() body: UpdateSponsoredDto,
  ) {
    return this.sponsored.update(admin.id, id, body);
  }

  @Post('sponsored/:id/renew')
  @ApiOperation({ summary: '종료된 광고 재등록 (식당 복사, 새 광고)' })
  renew(
    @CurrentAdmin() admin: AuthAdmin,
    @Param('id') id: string,
    @Body() body: RenewSponsoredDto,
  ) {
    return this.sponsored.renew(admin.id, id, body);
  }

  @Delete('sponsored/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '광고 취소 (바로 종료, 기록 유지). 이미 종료면 409',
  })
  async cancel(@CurrentAdmin() admin: AuthAdmin, @Param('id') id: string) {
    await this.sponsored.cancel(admin.id, id);
  }
}
