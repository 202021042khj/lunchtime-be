import { Module } from '@nestjs/common';
import { ReviewsModule } from '../reviews/reviews.module.js';
import { AdminReportsController } from './reports/admin-reports.controller.js';
import { AdminReportsService } from './reports/admin-reports.service.js';
import { AdminUsersController } from './users/admin-users.controller.js';
import { AdminUsersService } from './users/admin-users.service.js';

// 어드민 유저 관리 · 리뷰 신고 처리
@Module({
  imports: [ReviewsModule],
  controllers: [AdminUsersController, AdminReportsController],
  providers: [AdminUsersService, AdminReportsService],
})
export class AdminModerationModule {}
