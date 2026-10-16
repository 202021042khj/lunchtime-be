import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { AuthAdmin } from '../../../common/auth/auth.types.js';
import { AdminRoute, CurrentAdmin } from '../../../common/auth/decorators.js';
import { AppException } from '../../../common/errors/app.exception.js';
import { MAX_IMAGE_BYTES } from '../../../integrations/storage/image-type.js';
import { StorageService } from '../../../integrations/storage/storage.service.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';

const PURPOSES = ['menu', 'sponsored'] as const;

export class ImageUploadDto {
  @ApiProperty({ enum: PURPOSES, description: '메뉴 사진 · 광고 식당 사진' })
  @IsIn(PURPOSES)
  purpose: (typeof PURPOSES)[number];
}

// 어드민 사진: 브라우저 → 서버 → 저장소. 서버가 파일 내용으로 형식(jpg · png · webp)과 크기(5MB)를 확인한다.
// 받은 imageUrl을 메뉴 · 광고 저장 때 같이 보낸다
@ApiTags('admin · uploads')
@ApiBearerAuth('admin')
@AdminRoute()
@Controller('admin/uploads')
export class AdminUploadsController {
  constructor(
    private readonly storage: StorageService,
    private readonly audit: AdminAuditService,
  ) {}

  @Post('images')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: '사진 올리기 (multipart: file, purpose) → { imageUrl }',
  })
  // 5MB를 조금 넘는 것까지는 받아서 친절한 문구로 거절하고, 그보다 크면 multer가 끊는다
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES + 1024 * 1024 },
    }),
  )
  async upload(
    @CurrentAdmin() admin: AuthAdmin,
    @Body() body: ImageUploadDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new AppException('VALIDATION_FAILED', '사진 파일을 골라 주세요.', {
        fields: { file: '사진 파일을 골라 주세요.' },
      });
    }
    const imageUrl = await this.storage.putImage(
      body.purpose === 'menu' ? 'menus' : 'sponsored',
      file.buffer,
    );
    await this.audit.record({
      adminId: admin.id,
      action: 'image.upload',
      targetType: body.purpose,
      detail: { imageUrl, bytes: file.size },
    });
    return { imageUrl };
  }
}
