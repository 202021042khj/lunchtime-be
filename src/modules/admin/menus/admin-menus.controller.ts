import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  PartialType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { AuthAdmin } from '../../../common/auth/auth.types.js';
import { AdminRoute, CurrentAdmin } from '../../../common/auth/decorators.js';
import { AppException } from '../../../common/errors/app.exception.js';
import { AdminPageQueryDto } from '../common/admin-page.js';
import { AdminMenusService } from './admin-menus.service.js';

// 상세 규칙(종류 · 재료 1개 이상 · 맵기 0~4 · 이름 중복)은 서비스가 프론트와 같은 문구로 검사한다
export class MenuInputDto {
  @ApiProperty({ example: '얼큰 순두부찌개' })
  @IsString()
  @MaxLength(40)
  name: string;
  @ApiProperty({ example: '한식' }) @IsString() @MaxLength(20) cuisine: string;
  @ApiProperty({ example: '찌개류' })
  @IsString()
  @MaxLength(20)
  category: string;

  @ApiProperty({
    nullable: true,
    description: 'POST /admin/uploads/images로 받은 주소',
  })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  imageUrl: string | null;

  @ApiProperty({ example: ['두부', '바지락'] })
  @IsArray()
  @IsString({ each: true })
  ingredients: string[];

  @ApiProperty({ example: ['매운맛', '국물'] })
  @IsArray()
  @IsString({ each: true })
  tastes: string[];

  @ApiProperty({ example: 3 }) @IsInt() spiceLevel: number;

  @ApiProperty({
    example: ['cold', 'rain'],
    description: '비어 있으면 상관없음',
  })
  @IsArray()
  @IsString({ each: true })
  weathers: string[];

  @ApiProperty({ example: '순두부찌개' })
  @IsString()
  @MaxLength(40)
  kakaoKeyword: string;
  @ApiProperty({ example: '찌개,전골' })
  @IsString()
  @MaxLength(40)
  kakaoCategory: string;
  @ApiProperty() @IsBoolean() visible: boolean;
}

export class UpdateMenuDto extends PartialType(MenuInputDto) {}

export class AdminMenuQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({ description: '메뉴 이름 · 재료' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  q?: string;

  @ApiPropertyOptional({ example: '한식' })
  @IsOptional()
  @IsString()
  cuisine?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false', true, false])
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  visible?: boolean;
}

export class IngredientInputDto {
  @ApiProperty({ example: '미나리' }) @IsString() @MaxLength(20) name: string;

  @ApiPropertyOptional({
    description: '취향 화면 "못 먹는 재료" 기본 선택지에 넣을지',
  })
  @IsOptional()
  @IsBoolean()
  inOptions?: boolean;
}

@ApiTags('admin · menus')
@ApiBearerAuth('admin')
@AdminRoute()
@Controller('admin')
export class AdminMenusController {
  constructor(private readonly menus: AdminMenusService) {}

  @Get('menus')
  @ApiOperation({
    summary: '메뉴 목록 (7일 추천 수, 노출 먼저) + 전체 · 숨김 개수',
  })
  list(@Query() query: AdminMenuQueryDto) {
    return this.menus.list(query);
  }

  @Post('menus')
  @ApiOperation({ summary: '메뉴 추가 (같은 이름이면 409)' })
  create(@CurrentAdmin() admin: AuthAdmin, @Body() body: MenuInputDto) {
    return this.menus.create(admin.id, body);
  }

  @Patch('menus/:id')
  @ApiOperation({ summary: '메뉴 수정 · 노출/숨김 · 사진' })
  update(
    @CurrentAdmin() admin: AuthAdmin,
    @Param('id') id: string,
    @Body() body: UpdateMenuDto,
  ) {
    return this.menus.update(admin.id, id, body);
  }

  @Post('menus/import')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'CSV 가져오기 (같은 이름은 덮어쓰기, 문제 줄만 건너뜀)',
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  importCsv(
    @CurrentAdmin() admin: AuthAdmin,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new AppException('VALIDATION_FAILED', 'CSV 파일을 골라 주세요.', {
        fields: { file: 'CSV 파일을 골라 주세요.' },
      });
    }
    return this.menus.importCsv(admin.id, file.buffer.toString('utf8'));
  }

  @Get('ingredients')
  @ApiOperation({ summary: '재료 · 알레르기 사전 + 메뉴에 쓰인 재료' })
  ingredients() {
    return this.menus.ingredients();
  }

  @Post('ingredients')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '재료 사전에 추가 · 선택지 여부 변경' })
  addIngredient(
    @CurrentAdmin() admin: AuthAdmin,
    @Body() body: IngredientInputDto,
  ) {
    return this.menus.addIngredient(
      admin.id,
      body.name,
      body.inOptions ?? false,
    );
  }
}
