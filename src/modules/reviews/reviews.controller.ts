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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString } from 'class-validator';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import { AppException } from '../../common/errors/app.exception.js';
import { MAX_IMAGE_BYTES } from '../../integrations/storage/image-type.js';
import { ReviewPhotosService } from './review-photos.service.js';
import {
  PhotoSlotsDto,
  ReviewInputDto,
  ReviewListQueryDto,
  ReviewPageQueryDto,
  ReviewPatchDto,
  ReviewReportDto,
} from './reviews.dto.js';
import { ReviewsService } from './reviews.service.js';

@ApiTags('reviews')
@Controller('restaurants/:placeId')
export class RestaurantReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get('reviews')
  @ApiOperation({
    summary: '식당 리뷰 목록 (recent · rating_desc · rating_asc · photo)',
  })
  list(
    @Param('placeId') placeId: string,
    @Query() query: ReviewListQueryDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.reviews.list(placeId, query, user?.id);
  }

  @Public()
  @Get('review-form')
  @ApiOperation({ summary: '리뷰 쓰기용 메뉴 목록 · 좋았던 점 태그' })
  form(@Param('placeId') placeId: string, @CurrentUser() user?: AuthUser) {
    return this.reviews.form(placeId, user?.id);
  }

  @Post('reviews')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('user')
  @ApiOperation({ summary: '리뷰 등록 (같은 식당은 하루 한 개)' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('placeId') placeId: string,
    @Body() body: ReviewInputDto,
  ) {
    return this.reviews.create(user.id, placeId, body);
  }
}

@ApiTags('reviews')
@ApiBearerAuth('user')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('me/reviews')
  @ApiOperation({ summary: '내 리뷰 (최신순)' })
  mine(@CurrentUser() user: AuthUser, @Query() query: ReviewPageQueryDto) {
    return this.reviews.mine(user.id, query);
  }

  @Patch('reviews/:id')
  @ApiOperation({ summary: '내 리뷰 수정 (보낸 항목만)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ReviewPatchDto,
  ) {
    return this.reviews.update(user.id, id, body);
  }

  @Delete('reviews/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '내 리뷰 삭제' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.reviews.remove(user.id, id);
  }

  @Post('reviews/:id/reports')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '리뷰 신고 (같은 리뷰는 한 번)' })
  async report(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ReviewReportDto,
  ) {
    await this.reviews.report(user.id, id, body);
  }
}

export class UploadSignatureDto {
  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  exp: number;

  @ApiPropertyOptional()
  @IsString()
  sig: string;
}

// 요청 본문(사진 파일)을 그대로 읽는다. 5MB를 조금 넘는 것까지는 받아서 친절한 문구로 거절하고, 그보다 크면 끊는다
function readBody(req: Request, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        req.removeAllListeners('data');
        reject(
          new AppException(
            'VALIDATION_FAILED',
            '사진은 5MB까지 올릴 수 있어요.',
            { fields: { file: '사진은 5MB까지 올릴 수 있어요.' } },
          ),
        );
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

@ApiTags('reviews')
@Controller('uploads/review-photos')
export class ReviewPhotosController {
  constructor(private readonly photos: ReviewPhotosService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('user')
  @ApiOperation({
    summary:
      '리뷰 사진 업로드 주소 발급 (최대 5장) → { items: [{ photoId, uploadUrl }] }',
  })
  create(@CurrentUser() user: AuthUser, @Body() body: PhotoSlotsDto) {
    return this.photos.createSlots(user.id, body.count);
  }

  // 발급받은 uploadUrl. 로그인 헤더 대신 주소의 서명(10분)으로 확인한다
  @Public()
  @Put(':photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '사진 파일 올리기 (본문 = jpg · png · webp, 5MB)' })
  async upload(
    @Param('photoId') photoId: string,
    @Query() query: UploadSignatureDto,
    @Req() req: Request,
  ) {
    const data = await readBody(req, MAX_IMAGE_BYTES + 1024 * 1024);
    await this.photos.upload(photoId, query.exp, query.sig, data);
  }
}
