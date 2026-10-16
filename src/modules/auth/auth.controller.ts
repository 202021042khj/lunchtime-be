import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators.js';
import { AuthService } from './auth.service.js';
import {
  AuthTokensDto,
  EmailCodeDto,
  EmailCodeResponseDto,
  EmailLoginDto,
  EmailSignupDto,
  EmailVerifyDto,
  EmailVerifyResponseDto,
  LoginResponseDto,
  LogoutDto,
  PasswordResetDto,
  RefreshDto,
  SocialLoginDto,
} from './dto/auth.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '소셜 로그인 · 가입 (처음이면 자동 가입)' })
  @ApiOkResponse({ type: LoginResponseDto })
  socialLogin(@Body() body: SocialLoginDto) {
    return this.auth.socialLogin(body.provider, body);
  }

  @Public()
  @Post('email/code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '이메일 인증번호 보내기 (10분 유효, 재전송 60초 뒤)',
  })
  @ApiOkResponse({ type: EmailCodeResponseDto })
  sendEmailCode(@Body() body: EmailCodeDto) {
    return this.auth.sendEmailCode(body);
  }

  @Public()
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '인증번호 확인 → verificationToken (30분, 한 번만)',
  })
  @ApiOkResponse({ type: EmailVerifyResponseDto })
  verifyEmailCode(@Body() body: EmailVerifyDto) {
    return this.auth.verifyEmailCode(body);
  }

  @Public()
  @Post('email/signup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '이메일 가입' })
  @ApiOkResponse({ type: LoginResponseDto })
  signup(@Body() body: EmailSignupDto) {
    return this.auth.signup(body);
  }

  @Public()
  @Post('email/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '이메일 로그인 (5번 연속 실패하면 15분 잠금)' })
  @ApiOkResponse({ type: LoginResponseDto })
  login(@Body() body: EmailLoginDto) {
    return this.auth.login(body.email, body.password);
  }

  @Public()
  @Post('email/password-reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '비밀번호 재설정 (모든 기기 로그아웃)' })
  async resetPassword(@Body() body: PasswordResetDto) {
    await this.auth.resetPassword(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '토큰 재발급 (refreshToken 회전)' })
  @ApiOkResponse({ type: AuthTokensDto })
  refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body.refreshToken);
  }

  // accessToken이 만료된 뒤에도 로그아웃할 수 있게 공개로 둔다. refreshToken을 가진 쪽만 그 토큰을 폐기할 수 있다
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '로그아웃 (refreshToken 폐기)' })
  async logout(@Body() body: LogoutDto) {
    await this.auth.logout(body.refreshToken);
  }
}
