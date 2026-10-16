import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppException } from './errors/app.exception.js';

// class-validator 오류를 VALIDATION_FAILED + fields { "항목": "사유" }로 바꾼다
function collectFields(
  errors: ValidationError[],
  parent = '',
  fields: Record<string, string> = {},
): Record<string, string> {
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const first = error.constraints && Object.values(error.constraints)[0];
    if (first && !(path in fields)) fields[path] = first;
    if (error.children?.length) collectFields(error.children, path, fields);
  }
  return fields;
}

export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new AppException('VALIDATION_FAILED', undefined, {
        fields: collectFields(errors),
      }),
  });
}
