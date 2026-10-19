import { randomBytes } from 'node:crypto';
import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AppException } from '../../common/errors/app.exception.js';
import { isDevelopment } from '../../config/dev-only.js';
import type { Env } from '../../config/env.js';
import { detectImageType, MAX_IMAGE_BYTES } from './image-type.js';

export type ImageFolder = 'menus' | 'sponsored' | 'reviews';

// 이미지 저장소 (S3 호환: 개발 RustFS, 운영 S3 · R2 등). 이미지는 공개 읽기 주소로 보여 준다
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;
  private readonly dev: boolean;

  constructor(config: ConfigService<Env, true>) {
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    this.client = new S3Client({
      region: config.get('S3_REGION', { infer: true }),
      ...(endpoint && { endpoint }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
    });
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.publicUrl = config
      .get('S3_PUBLIC_URL', { infer: true })
      .replace(/\/$/, '');
    this.dev = isDevelopment(config);
  }

  get configured() {
    return Boolean(this.bucket && this.publicUrl);
  }

  // 개발 환경: 버킷이 없으면 만들고 공개 읽기를 연다 (운영 버킷은 직접 설정)
  async onModuleInit() {
    if (!this.dev || !this.configured) return;
    try {
      await this.client
        .send(new HeadBucketCommand({ Bucket: this.bucket }))
        .catch(async () => {
          await this.client.send(
            new CreateBucketCommand({ Bucket: this.bucket }),
          );
        });
      await this.client.send(
        new PutBucketPolicyCommand({
          Bucket: this.bucket,
          Policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { AWS: ['*'] },
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${this.bucket}/*`],
              },
            ],
          }),
        }),
      );
    } catch (error) {
      this.logger.warn(`이미지 저장소 준비 실패: ${(error as Error).message}`);
    }
  }

  // 이미지 확인(jpg · png · webp, 5MB) 후 저장 → 공개 주소
  async putImage(folder: ImageFolder, data: Buffer): Promise<string> {
    if (!this.configured) {
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        '이미지 저장소 설정이 필요해요.',
      );
    }
    if (data.length > MAX_IMAGE_BYTES) {
      throw new AppException(
        'VALIDATION_FAILED',
        '사진은 5MB까지 올릴 수 있어요.',
        {
          fields: { file: '사진은 5MB까지 올릴 수 있어요.' },
        },
      );
    }
    const type = detectImageType(data);
    if (!type) {
      throw new AppException(
        'VALIDATION_FAILED',
        'JPG · PNG · WEBP 사진만 올릴 수 있어요.',
        {
          fields: { file: 'JPG · PNG · WEBP 사진만 올릴 수 있어요.' },
        },
      );
    }
    const key = `${folder}/${randomBytes(12).toString('hex')}.${type.ext}`;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data,
          ContentType: type.contentType,
          // 파일 이름이 매번 새로 생기므로 오래 캐시해도 된다
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (error) {
      this.logger.warn(`이미지 저장 실패: ${(error as Error).message}`);
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        '사진을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
      );
    }
    return `${this.publicUrl}/${key}`;
  }

  // 메뉴 · 광고에 저장하려는 이미지 주소가 우리 저장소에 실제로 있는 이미지인지 (다른 사이트 주소 · 지어낸 주소 거절)
  async assertOwnImage(url: string, field: string): Promise<void> {
    const prefix = `${this.publicUrl}/`;
    const fail = () => {
      throw new AppException('VALIDATION_FAILED', '사진을 다시 올려 주세요.', {
        fields: { [field]: '사진을 다시 올려 주세요.' },
      });
    };
    if (!this.configured || !url.startsWith(prefix)) fail();
    const key = url.slice(prefix.length);
    if (!/^(menus|sponsored)\/[a-f0-9]{24}\.(jpg|png|webp)$/.test(key)) fail();
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch {
      fail();
    }
  }
}

@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
