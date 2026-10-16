import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { AuthAdmin } from '../../../common/auth/auth.types.js';
import {
  AdminRoute,
  CurrentAdmin,
  Public,
} from '../../../common/auth/decorators.js';
import { AdminAuthService } from './admin-auth.service.js';

export class AdminLoginDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  @MaxLength(64)
  loginId: string;

  @ApiProperty({ example: 'admin1234' })
  @IsString()
  @MaxLength(128)
  password: string;

  @ApiProperty({
    example: '123456',
    description: '인증 앱 6자리 (개발 환경은 123456도 받음)',
  })
  @IsString()
  @MaxLength(6)
  otp: string;
}

export class AdminRefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

export class AdminLogoutDto {
  @ApiPropertyOptional({
    description: '없으면 이 운영자의 모든 refreshToken을 폐기',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

class AdminProfileDto {
  @ApiProperty() id: string;
  @ApiProperty() loginId: string;
  @ApiProperty() name: string;
}

class AdminLoginResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty({ type: AdminProfileDto }) admin: AdminProfileDto;
}

@ApiTags('admin · auth')
@AdminRoute()
@Controller('admin')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '어드민 로그인: 아이디 · 비밀번호 + OTP (5번 실패하면 15분 잠금)',
  })
  @ApiOkResponse({ type: AdminLoginResponseDto })
  login(@Body() body: AdminLoginDto, @Ip() ip: string) {
    return this.auth.login(body.loginId, body.password, body.otp, ip);
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '어드민 토큰 재발급 (refreshToken 회전, 12시간)' })
  refresh(@Body() body: AdminRefreshDto) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('admin')
  @ApiOperation({ summary: '어드민 로그아웃' })
  async logout(
    @CurrentAdmin() admin: AuthAdmin,
    @Body() body: AdminLogoutDto,
    @Ip() ip: string,
  ) {
    await this.auth.logout(admin.id, body?.refreshToken, ip);
  }

  @Get('me')
  @ApiBearerAuth('admin')
  @ApiOperation({ summary: '지금 로그인한 운영자' })
  @ApiOkResponse({ type: AdminProfileDto })
  me(@CurrentAdmin() admin: AuthAdmin) {
    return this.auth.me(admin.id);
  }
}
