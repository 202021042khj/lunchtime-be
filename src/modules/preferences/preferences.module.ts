import { Module } from '@nestjs/common';
import { PreferencesController } from './preferences.controller.js';
import { PreferencesService } from './preferences.service.js';

@Module({
  controllers: [PreferencesController],
  providers: [PreferencesService],
  // 2단계-3 추천이 취향을 읽는다
  exports: [PreferencesService],
})
export class PreferencesModule {}
