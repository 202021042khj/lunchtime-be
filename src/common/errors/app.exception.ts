import { HttpException } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from './error-codes.js';

export interface AppErrorExtra {
  // VALIDATION_FAILED: 항목별 사유
  fields?: Record<string, string>;
  // USER_SUSPENDED: 정지 종료 시각 (무기한이면 null)
  until?: string | null;
}

// 서비스 코드는 이 예외만 던진다: throw new AppException('REVIEW_DAILY_LIMIT')
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly extra: AppErrorExtra = {},
  ) {
    super(message ?? ERROR_CODES[code].message, ERROR_CODES[code].status);
  }
}
