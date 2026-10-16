import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppException } from '../errors/app.exception.js';
import { ERROR_CODES, codeForStatus } from '../errors/error-codes.js';

// 모든 실패 응답을 API.md 형식으로 만든다: { error: { code, message, fields?, until? } }
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      res.status(exception.getStatus()).json({
        error: {
          code: exception.code,
          message: exception.message,
          ...exception.extra,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = codeForStatus(status);
      if (status >= 500) this.logger.error(exception.message, exception.stack);
      res
        .status(status)
        .json({ error: { code, message: ERROR_CODES[code].message } });
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.message : String(exception),
      exception instanceof Error ? exception.stack : undefined,
    );
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: ERROR_CODES.INTERNAL_ERROR.message,
      },
    });
  }
}
