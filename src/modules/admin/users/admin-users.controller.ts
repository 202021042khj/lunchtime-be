import {
  Body,
  Controller,
  Get,
  Header,
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
  IntersectionType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { AuthAdmin } from '../../../common/auth/auth.types.js';
import { AdminRoute, CurrentAdmin } from '../../../common/auth/decorators.js';
import { AdminPageQueryDto } from '../common/admin-page.js';
import { AdminUsersService } from './admin-users.service.js';

const STATUSES = ['active', 'suspended', 'withdrawn'] as const;

export class AdminUsersFilterDto {
  @ApiPropertyOptional({ description: '이름 · 이메일 일부' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}

export class AdminUsersQueryDto extends IntersectionType(
  AdminPageQueryDto,
  AdminUsersFilterDto,
) {}

export class SuspendUserDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: '정지 일수. 없거나 null이면 무기한',
    example: 7,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number | null;

  @ApiProperty({ maxLength: 200, description: '사용자에게도 보여 준다' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: '정지 사유를 적어 주세요.' })
  @MaxLength(200, { message: '정지 사유는 200자까지 쓸 수 있어요.' })
  reason: string;
}

@ApiTags('admin · users')
@ApiBearerAuth('admin')
@AdminRoute()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get('summary')
  @ApiOperation({ summary: '전체 · 이번 주 신규 · 오늘 활성 · 정지 수' })
  summary() {
    return this.users.summary();
  }

  @Get()
  @ApiOperation({ summary: '유저 목록 (최근 가입 순, 이메일은 가림)' })
  list(@Query() query: AdminUsersQueryDto) {
    return this.users.list({ q: query.q, status: query.status }, query);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'CSV 내려받기 (목록과 같은 조건, 최대 1만 줄)' })
  exportCsv(@Query() query: AdminUsersFilterDto) {
    return this.users.exportCsv(query);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '이용 정지 (days 없으면 무기한)' })
  suspend(
    @CurrentAdmin() admin: AuthAdmin,
    @Param('id') id: string,
    @Body() body: SuspendUserDto,
  ) {
    return this.users.suspend(admin.id, id, body.days ?? null, body.reason);
  }

  @Post(':id/unsuspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '정지 해제' })
  unsuspend(@CurrentAdmin() admin: AuthAdmin, @Param('id') id: string) {
    return this.users.unsuspend(admin.id, id);
  }
}
