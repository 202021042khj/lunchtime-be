import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const PURPOSES = ['signup', 'reset'] as const;
const SOCIAL_PROVIDERS = ['kakao', 'apple', 'google'] as const;
const EMAIL_MESSAGE = '이메일 형식이 맞지 않아요.';

// 비밀번호 · 이름의 상세 규칙(8~64자 등)은 프론트와 같은 문구로 서비스에서 검사한다
export class EmailCodeDto {
  @ApiProperty({ example: 'name@example.com' })
  @IsEmail({}, { message: EMAIL_MESSAGE })
  @MaxLength(254)
  email: string;

  @ApiProperty({ enum: PURPOSES })
  @IsIn(PURPOSES)
  purpose: (typeof PURPOSES)[number];
}

export class EmailVerifyDto extends EmailCodeDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: '인증번호 6자리를 입력해 주세요.' })
  code: string;
}

export class EmailSignupDto {
  @ApiProperty({ example: 'name@example.com' })
  @IsEmail({}, { message: EMAIL_MESSAGE })
  email: string;

  @ApiProperty({ example: 'lunch1234' })
  @IsString()
  @MaxLength(128)
  password: string;

  @ApiProperty({ example: '지민' })
  @IsString()
  @MaxLength(64)
  name: string;

  @ApiProperty()
  @IsString()
  verificationToken: string;
}

export class EmailLoginDto {
  @ApiProperty({ example: 'test@lunchtime.dev' })
  @IsEmail({}, { message: EMAIL_MESSAGE })
  email: string;

  @ApiProperty({ example: 'lunch1234' })
  @IsString()
  @MaxLength(128)
  password: string;
}

export class PasswordResetDto {
  @ApiProperty({ example: 'name@example.com' })
  @IsEmail({}, { message: EMAIL_MESSAGE })
  email: string;

  @ApiProperty({ example: 'newpass12' })
  @IsString()
  @MaxLength(128)
  password: string;

  @ApiProperty()
  @IsString()
  verificationToken: string;
}

export class SocialLoginDto {
  @ApiProperty({ enum: SOCIAL_PROVIDERS })
  @IsIn(SOCIAL_PROVIDERS)
  provider: (typeof SOCIAL_PROVIDERS)[number];

  // providerToken(앱) 또는 code + redirectUri(웹) 중 하나. 둘 다 없으면 서비스에서 400
  @ApiPropertyOptional({
    description:
      '앱(웹뷰): 카카오 access token, 구글 · 애플 id token. 개발 환경은 "dev:<아이디>"',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  providerToken?: string;

  @ApiPropertyOptional({
    description: '웹: 리다이렉트로 받은 인가 코드 (지금은 카카오만)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  code?: string;

  @ApiPropertyOptional({
    example: 'http://localhost:3000/login/kakao/callback',
    description: '인가 코드를 받을 때 쓴 redirect_uri (code와 함께)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  redirectUri?: string;

  @ApiPropertyOptional({
    description:
      'Apple 첫 로그인 때 받은 이름 (애플은 ID 토큰에 이름이 없다). 가입할 때만 쓴다',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

export class LogoutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

// ---------- 응답 (Swagger 표시용) ----------

export class EmailCodeResponseDto {
  @ApiProperty({ example: 600 }) expiresInSec: number;
  @ApiProperty({ example: 60 }) resendAfterSec: number;
}

export class EmailVerifyResponseDto {
  @ApiProperty() verificationToken: string;
}

export class AuthTokensDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
}

export class LoginUserDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['kakao', 'apple', 'google', 'email'] })
  provider: string;
  @ApiProperty({ enum: ['user'] }) role: string;
  @ApiProperty() onboardingCompleted: boolean;
}

export class LoginResponseDto extends AuthTokensDto {
  @ApiProperty() isNewUser: boolean;
  @ApiProperty({ type: LoginUserDto }) user: LoginUserDto;
}
