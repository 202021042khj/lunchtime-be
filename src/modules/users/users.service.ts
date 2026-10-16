import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { AppException } from '../../common/errors/app.exception.js';
import {
  checkPassword,
  hashPassword,
  verifyPassword,
} from '../../common/auth/password.js';
import { toKstIso } from '../../common/time.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { validationFailed } from '../auth/auth.service.js';
import { SocialVerifierService } from '../auth/social-verifier.service.js';
import { UserSessionService } from '../auth/user-session.service.js';

const WITHDRAWN_NAME = '탈퇴한 사용자';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: UserSessionService,
    private readonly social: SocialVerifierService,
    private readonly clock: Clock,
  ) {}

  // 토큰은 맞아도 탈퇴한 사용자면 401 (accessToken은 최대 1시간 남아 있을 수 있다)
  private async activeUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status === 'withdrawn')
      throw new AppException('UNAUTHORIZED');
    return user;
  }

  async getMe(userId: string) {
    const user = await this.activeUser(userId);
    const [reviewCount, favoriteCount, recommendationCount] = await Promise.all(
      [
        this.prisma.review.count({ where: { userId, deletedAt: null } }),
        this.prisma.favorite.count({ where: { userId } }),
        this.prisma.recommendationLog.count({ where: { userId } }),
        this.prisma.user.update({
          where: { id: userId },
          data: { lastActiveAt: this.clock.now() },
        }),
      ],
    );
    return {
      id: user.id,
      name: user.name,
      provider: user.provider,
      role: 'user' as const,
      onboardingCompleted: user.onboardingCompleted,
      createdAt: toKstIso(user.createdAt),
      stats: { reviewCount, favoriteCount, recommendationCount },
    };
  }

  // 탈퇴: 개인정보를 지우고 같은 이메일 · 소셜 계정으로 다시 가입할 수 있게 providerId를 비운다.
  // 리뷰는 "탈퇴한 사용자" 이름으로 남긴다
  async withdraw(userId: string) {
    const user = await this.activeUser(userId);
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const favorites = await tx.favorite.findMany({
        where: { userId },
        select: { placeId: true },
      });
      if (favorites.length) {
        await tx.placeStats.updateMany({
          where: {
            placeId: { in: favorites.map((f) => f.placeId) },
            favoriteCount: { gt: 0 },
          },
          data: { favoriteCount: { decrement: 1 } },
        });
      }
      await tx.favorite.deleteMany({ where: { userId } });
      await tx.savedLocation.deleteMany({ where: { userId } });
      await tx.userPreference.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: user.id },
        data: {
          status: 'withdrawn',
          withdrawnAt: now,
          providerId: `withdrawn:${user.id}`,
          email: null,
          passwordHash: null,
          socialRefreshToken: null,
          name: WITHDRAWN_NAME,
          suspendedUntil: null,
        },
      });
      await this.sessions.revokeAll(user.id, tx);
    });

    // 소셜 연결 끊기(지금은 카카오, 어드민 키가 있을 때). 실패해도 탈퇴는 이미 끝났으므로 로그만 남긴다
    try {
      await this.social.unlink(
        user.provider,
        user.providerId,
        user.socialRefreshToken,
      );
    } catch (error) {
      this.logger.warn(
        `소셜 연결 끊기 실패 (user ${user.id}): ${(error as Error).message}`,
      );
    }
  }

  // 이메일 계정만. 지금 기기의 로그인은 유지한다 (잊어서 바꾸는 재설정과 달리 본인이 바꾸는 것)
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.activeUser(userId);
    if (user.provider !== 'email') {
      throw new AppException(
        'VALIDATION_FAILED',
        '소셜 로그인 계정은 비밀번호가 없어요.',
      );
    }
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new AppException(
        'INVALID_CREDENTIALS',
        '현재 비밀번호가 맞지 않아요.',
      );
    }
    const ruleError = checkPassword(newPassword);
    if (ruleError) validationFailed('newPassword', ruleError);
    if (newPassword === currentPassword) {
      validationFailed(
        'newPassword',
        '지금 비밀번호와 다른 비밀번호를 입력해 주세요.',
      );
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });
  }
}
