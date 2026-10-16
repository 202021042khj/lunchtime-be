import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth.types.js';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import {
  IngredientQueryDto,
  PreferencesDto,
  SavePreferencesDto,
} from './preferences.dto.js';
import { PreferencesService } from './preferences.service.js';

@ApiTags('preferences')
@Controller()
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get('me/preferences')
  @ApiBearerAuth('user')
  @ApiOperation({ summary: '내 취향 (없으면 빈 값)' })
  get(@CurrentUser() user: AuthUser) {
    return this.preferences.get(user.id);
  }

  @Put('me/preferences')
  @ApiBearerAuth('user')
  @ApiOperation({
    summary: '내 취향 저장 (전체 교체). completeOnboarding이면 온보딩 완료',
  })
  save(@CurrentUser() user: AuthUser, @Body() body: SavePreferencesDto) {
    const { completeOnboarding, ...prefs } = body;
    return this.preferences.save(user.id, prefs, completeOnboarding === true);
  }

  @Public()
  @Get('preferences/options')
  @ApiOperation({ summary: '재료 · 알레르기 · 음식 종류 선택지' })
  options() {
    return this.preferences.options();
  }

  @Public()
  @Get('ingredients')
  @ApiOperation({ summary: '재료 사전 검색 ("목록에 없는 재료")' })
  searchIngredients(@Query() query: IngredientQueryDto) {
    return this.preferences.searchIngredients(query.q);
  }

  @Public()
  @Post('preferences/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '저장 전 취향으로 추천 미리보기 (추천 3 · 제외 4)' })
  preview(@Body() body: PreferencesDto) {
    return this.preferences.preview(body);
  }
}
