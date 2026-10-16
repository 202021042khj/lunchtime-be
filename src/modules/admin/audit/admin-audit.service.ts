import { Global, Injectable, Module } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

export interface AuditEntry {
  // 로그인 실패처럼 운영자를 특정할 수 없으면 null
  adminId: string | null;
  // 예: admin.login, admin.login_failed, user.suspend, sponsored.create
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: Prisma.InputJsonValue;
  ip?: string;
}

// API.md: 어드민의 모든 변경과 로그인 성공 · 실패를 남긴다 (누가, 언제, 무엇을)
@Injectable()
export class AdminAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async record(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma) {
    await tx.adminAuditLog.create({
      data: { ...entry, createdAt: this.clock.now() },
    });
  }
}

@Global()
@Module({
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AdminAuditModule {}
