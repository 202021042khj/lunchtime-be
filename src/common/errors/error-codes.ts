import { HttpStatus } from '@nestjs/common';

// lunchtime-fe/API.md "에러 코드"와 1:1. 새 코드를 넣으면 API.md와 프론트 types/common.ts도 같이 고친다
export const ERROR_CODES = {
  VALIDATION_FAILED: {
    status: HttpStatus.BAD_REQUEST,
    message: '입력값을 확인해 주세요.',
  },
  REVIEW_TOO_LONG: {
    status: HttpStatus.BAD_REQUEST,
    message: '후기는 500자까지 쓸 수 있어요.',
  },
  TOO_MANY_PHOTOS: {
    status: HttpStatus.BAD_REQUEST,
    message: '사진은 5장까지 올릴 수 있어요.',
  },
  LOCATION_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: '위치를 먼저 설정해 주세요.',
  },
  INVALID_CODE: {
    status: HttpStatus.BAD_REQUEST,
    message: '인증번호가 맞지 않아요.',
  },
  CODE_EXPIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: '인증번호가 만료됐어요. 다시 받아 주세요.',
  },
  UNAUTHORIZED: {
    status: HttpStatus.UNAUTHORIZED,
    message: '로그인이 필요해요.',
  },
  INVALID_CREDENTIALS: {
    status: HttpStatus.UNAUTHORIZED,
    message: '아이디 또는 비밀번호가 맞지 않아요.',
  },
  FORBIDDEN: { status: HttpStatus.FORBIDDEN, message: '권한이 없어요.' },
  USER_SUSPENDED: {
    status: HttpStatus.FORBIDDEN,
    message: '이용이 정지된 계정이에요.',
  },
  NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: '찾을 수 없어요.' },
  REVIEW_DAILY_LIMIT: {
    status: HttpStatus.CONFLICT,
    message: '이 식당에는 오늘 이미 후기를 썼어요.',
  },
  ALREADY_REPORTED: {
    status: HttpStatus.CONFLICT,
    message: '이미 신고한 후기예요.',
  },
  ALREADY_REPORTED_MENU: {
    status: HttpStatus.CONFLICT,
    message: '이미 제보한 메뉴예요.',
  },
  EMAIL_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: '이미 가입된 이메일이에요.',
  },
  CONFLICT: {
    status: HttpStatus.CONFLICT,
    message: '지금 상태에서는 할 수 없어요.',
  },
  OUT_OF_SERVICE_AREA: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: '서비스 지역이 아니에요.',
  },
  RATE_LIMITED: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: '잠시 후 다시 시도해 주세요.',
  },
  INTERNAL_ERROR: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: '일시적인 오류가 생겼어요.',
  },
  UPSTREAM_UNAVAILABLE: {
    status: HttpStatus.BAD_GATEWAY,
    message: '외부 서비스 응답이 없어요.',
  },
  SERVICE_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: '서비스를 잠시 이용할 수 없어요.',
  },
} as const satisfies Record<string, { status: HttpStatus; message: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

// Nest 기본 예외(HttpException)를 상태 코드로 API.md 코드에 맞춘다
export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    case 502:
      return 'UPSTREAM_UNAVAILABLE';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}
