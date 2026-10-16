import { Module } from '@nestjs/common';
import { AdminMenusController } from './menus/admin-menus.controller.js';
import { AdminMenusService } from './menus/admin-menus.service.js';
import { AdminSponsoredController } from './sponsored/admin-sponsored.controller.js';
import { AdminSponsoredService } from './sponsored/admin-sponsored.service.js';
import { AdminUploadsController } from './uploads/admin-uploads.controller.js';

// 어드민 메뉴 관리 · 광고 식당 고정 · 사진 올리기 (유저 관리 · 리뷰 신고는 2단계-5)
@Module({
  controllers: [
    AdminMenusController,
    AdminSponsoredController,
    AdminUploadsController,
  ],
  providers: [AdminMenusService, AdminSponsoredService],
})
export class AdminCatalogModule {}
