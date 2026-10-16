import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { CurrentUser } from '../../common/auth/decorators.js';
import { UsersService } from './users.service.js';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  newPassword: string;
}

class UserStatsDto {
  @ApiProperty() reviewCount: number;
  @ApiProperty() favoriteCount: number;
  @ApiProperty() recommendationCount: number;
}

class MeDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['kakao', 'apple', 'google', 'email'] })
  provider: string;
  @ApiProperty({ enum: ['user'] }) role: string;
  @ApiProperty() onboardingCompleted: boolean;
  @ApiProperty() createdAt: string;
  @ApiProperty({ type: UserStatsDto }) stats: UserStatsDto;
}

@ApiTags('me')
@ApiBearerAuth('user')
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: '내 정보 + 요약 숫자' })
  @ApiOkResponse({ type: MeDto })
  getMe(@CurrentUser() user: AuthUser) {
    return this.users.getMe(user.id);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '회원 탈퇴 (리뷰는 "탈퇴한 사용자"로 남음)' })
  async withdraw(@CurrentUser() user: AuthUser) {
    await this.users.withdraw(user.id);
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '비밀번호 바꾸기 (이메일 계정만)' })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: ChangePasswordDto,
  ) {
    await this.users.changePassword(
      user.id,
      body.currentPassword,
      body.newPassword,
    );
  }
}
