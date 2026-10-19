import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../common/clock.js';
import { AppException } from '../../common/errors/app.exception.js';
import type { Env } from '../../config/env.js';
import { StorageService } from '../../integrations/storage/storage.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  REVIEW_LIMITS,
  signUpload,
  UPLOAD_URL_TTL_SEC,
  verifyUpload,
} from './review-rules.js';
import { ReviewAccess } from './review-access.service.js';

// 리뷰 사진: ① 업로드 주소 발급(로그인) → ② 앱이 그 주소에 파일을 PUT → ③ 리뷰 등록 때 photoId를 붙인다.
// ②는 우리 서버가 받아 파일 내용(jpg · png · webp, 5MB)을 확인한 뒤 저장소에 올린다
@Injectable()
export class ReviewPhotosService {
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: ReviewAccess,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('JWT_SECRET', { infer: true });
    this.baseUrl = config
      .get('API_PUBLIC_URL', { infer: true })
      .replace(/\/$/, '');
  }

  // POST /uploads/review-photos { count }
  async createSlots(userId: string, count: number) {
    if (count > REVIEW_LIMITS.photos) throw new AppException('TOO_MANY_PHOTOS');
    await this.access.assertCanWrite(userId);
    if (!this.storage.configured) {
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        '이미지 저장소 설정이 필요해요.',
      );
    }
    const exp =
      Math.floor(this.clock.now().getTime() / 1000) + UPLOAD_URL_TTL_SEC;
    const photos = await this.prisma.reviewPhoto.createManyAndReturn({
      data: Array.from({ length: count }, () => ({ userId, url: '' })),
      select: { id: true },
    });
    return {
      items: photos.map(({ id }) => ({
        photoId: id,
        uploadUrl: `${this.baseUrl}/v1/uploads/review-photos/${id}?exp=${exp}&sig=${signUpload(this.secret, id, exp)}`,
      })),
    };
  }

  // PUT /uploads/review-photos/{photoId}?exp=&sig= (본문 = 사진 파일). 한 주소에 한 번만 올린다
  async upload(photoId: string, exp: number, sig: string, data: Buffer) {
    const nowSec = Math.floor(this.clock.now().getTime() / 1000);
    if (!verifyUpload(this.secret, photoId, exp, sig, nowSec)) {
      throw new AppException(
        'FORBIDDEN',
        '업로드 주소가 만료됐어요. 사진을 다시 골라 주세요.',
      );
    }
    const photo = await this.prisma.reviewPhoto.findUnique({
      where: { id: photoId },
    });
    if (!photo) throw new AppException('NOT_FOUND', '사진을 찾을 수 없어요.');
    if (photo.url) throw new AppException('CONFLICT', '이미 올린 사진이에요.');
    const url = await this.storage.putImage('reviews', data);
    // 동시에 두 번 올려도 처음 것만 남긴다
    const { count } = await this.prisma.reviewPhoto.updateMany({
      where: { id: photoId, url: '' },
      data: { url },
    });
    if (!count) throw new AppException('CONFLICT', '이미 올린 사진이에요.');
  }
}
