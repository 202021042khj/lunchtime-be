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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import type { AuthAdmin } from '../../../common/auth/auth.types.js';
import { AdminRoute, CurrentAdmin } from '../../../common/auth/decorators.js';
import { AdminPageQueryDto } from '../common/admin-page.js';
import { AdminReportsService } from './admin-reports.service.js';

const STATUSES = ['pending', 'resolved'] as const;

export class AdminReportsQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({ enum: STATUSES, description: '없으면 전체' })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}

export class ResolveReportDto {
  @ApiProperty({ enum: ['dismiss', 'delete'] })
  @IsIn(['dismiss', 'delete'], { message: '처리 방법을 골라 주세요.' })
  action: 'dismiss' | 'delete';

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: '작성자도 함께 정지할 일수',
    example: 7,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(3650)
  suspendAuthorDays?: number | null;
}

@ApiTags('admin · reports')
@ApiBearerAuth('admin')
@AdminRoute()
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly reports: AdminReportsService) {}

  @Get('summary')
  @ApiOperation({
    summary: '처리 대기 · 오늘 접수 · 이번 달 처리 · 삭제 비율',
  })
  summary() {
    return this.reports.summary();
  }

  @Get()
  @ApiOperation({ summary: '리뷰 단위로 묶은 신고 목록 (최근 신고 순)' })
  list(@Query() query: AdminReportsQueryDto) {
    return this.reports.list(query.status, query);
  }

  @Get(':reviewId')
  @ApiOperation({ summary: '신고 상세 (ReportGroup)' })
  detail(@Param('reviewId') reviewId: string) {
    return this.reports.detail(reviewId);
  }

  @Post(':reviewId/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '처리: 기각 · 리뷰 삭제 (+ 작성자 정지). 바뀐 ReportGroup',
  })
  resolve(
    @CurrentAdmin() admin: AuthAdmin,
    @Param('reviewId') reviewId: string,
    @Body() body: ResolveReportDto,
  ) {
    return this.reports.resolve(
      admin.id,
      reviewId,
      body.action,
      body.suspendAuthorDays ?? null,
    );
  }
}
