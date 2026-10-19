import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { AppException } from '../../common/errors/app.exception.js';
import { toKstIso } from '../../common/time.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// 리뷰 · 사진 · 신고를 쓸 수 있는 사용자인지. 정지 중이면 403 USER_SUSPENDED + until(무기한이면 null)
@Injectable()
export class ReviewAccess {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async assertCanWrite(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        status: true,
        suspendedUntil: true,
        suspendReason: true,
      },
    });
    if (!user || user.status === 'withdrawn') {
      throw new AppException('UNAUTHORIZED');
    }
    // 정지 기간이 끝났으면 상태가 아직 suspended여도 쓸 수 있다
    if (
      user.status === 'suspended' &&
      (!user.suspendedUntil || user.suspendedUntil > this.clock.now())
    ) {
      // API.md: 정지 사유는 사용자에게도 보여 준다
      const message = user.suspendReason
        ? `이용이 정지된 계정이에요. (사유: ${user.suspendReason})`
        : undefined;
      throw new AppException('USER_SUSPENDED', message, {
        until: user.suspendedUntil ? toKstIso(user.suspendedUntil) : null,
      });
    }
    return user;
  }
}
