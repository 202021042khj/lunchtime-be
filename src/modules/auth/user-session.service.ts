import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { AppException } from '../../common/errors/app.exception.js';
import { newOpaqueToken, sha256 } from '../../common/auth/opaque-token.js';
import { TokenService } from '../../common/auth/token.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

// API.md: refreshToken 30일
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// 사용자 accessToken + refreshToken 발급 · 회전 · 폐기
@Injectable()
export class UserSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
  ) {}

  async issue(
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<AuthTokens> {
    const refreshToken = newOpaqueToken();
    await tx.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(this.clock.now().getTime() + REFRESH_TTL_MS),
      },
    });
    return {
      accessToken: await this.tokens.signAccess('user', userId),
      refreshToken,
    };
  }

  // 회전: 옛 토큰을 폐기하고 새 쌍을 준다. 이미 폐기된 토큰이 다시 오면 탈취로 보고 모두 폐기
  async rotate(refreshToken: string): Promise<AuthTokens> {
    const now = this.clock.now();
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: { select: { status: true } } },
    });
    if (!row) throw new AppException('UNAUTHORIZED');
    if (row.revokedAt) {
      await this.revokeAll(row.userId);
      throw new AppException('UNAUTHORIZED');
    }
    if (row.expiresAt <= now || row.user.status === 'withdrawn') {
      throw new AppException('UNAUTHORIZED');
    }
    return this.prisma.$transaction(async (tx) => {
      // 같은 토큰으로 동시에 두 번 오면 한쪽만 성공하게 revokedAt이 비어 있을 때만 바꾼다
      const { count } = await tx.refreshToken.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (count === 0) throw new AppException('UNAUTHORIZED');
      return this.issue(row.userId, tx);
    });
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  async revokeAll(
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }
}
