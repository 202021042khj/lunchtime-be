import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../../common/clock.js';
import { AppException } from '../../../common/errors/app.exception.js';
import { newOpaqueToken, sha256 } from '../../../common/auth/opaque-token.js';
import { verifyPassword } from '../../../common/auth/password.js';
import { TokenService } from '../../../common/auth/token.service.js';
import { verifyTotp } from '../../../common/auth/totp.js';
import { isDevelopment } from '../../../config/dev-only.js';
import type { Env } from '../../../config/env.js';
import type { AdminUser, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';

const MAX_LOGIN_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
// 어드민은 짧게: accessToken 30분(TokenService), refreshToken 12시간
const REFRESH_TTL_MS = 12 * 60 * 60 * 1000;

const toProfile = (admin: AdminUser) => ({
  id: admin.id,
  loginId: admin.loginId,
  name: admin.name,
});

@Injectable()
export class AdminAuthService {
  // 개발 환경에서만 받는 OTP 고정값 (프론트 목 · 테스트와 같은 123456)
  private readonly devOtp: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AdminAuditService,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    const code = config.get('ADMIN_OTP_DEV_CODE', { infer: true });
    this.devOtp = isDevelopment(config) && code ? code : null;
  }

  private otpMatches(admin: AdminUser, otp: string) {
    if (this.devOtp && otp === this.devOtp) return true;
    return verifyTotp(admin.otpSecret, otp, this.clock.now().getTime());
  }

  private async issue(
    adminId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const refreshToken = newOpaqueToken();
    await tx.adminRefreshToken.create({
      data: {
        adminId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(this.clock.now().getTime() + REFRESH_TTL_MS),
      },
    });
    return {
      accessToken: await this.tokens.signAccess('admin', adminId),
      refreshToken,
    };
  }

  // 아이디 · 비밀번호 · OTP 중 무엇이 틀렸는지 알려 주지 않는다
  async login(loginId: string, password: string, otp: string, ip?: string) {
    const now = this.clock.now();
    const admin = await this.prisma.adminUser.findUnique({
      where: { loginId },
    });

    if (admin?.lockedUntil && admin.lockedUntil > now) {
      await this.audit.record({
        adminId: admin.id,
        action: 'admin.login_locked',
        ip,
      });
      throw new AppException(
        'RATE_LIMITED',
        '로그인을 여러 번 실패했어요. 잠시 후 다시 시도해 주세요.',
      );
    }

    const ok =
      admin &&
      (await verifyPassword(admin.passwordHash, password)) &&
      this.otpMatches(admin, otp);
    if (!ok) {
      if (admin) {
        const failures = admin.failedLoginCount + 1;
        await this.prisma.adminUser.update({
          where: { id: admin.id },
          data:
            failures >= MAX_LOGIN_FAILURES
              ? {
                  failedLoginCount: 0,
                  lockedUntil: new Date(now.getTime() + LOCK_MS),
                }
              : { failedLoginCount: failures },
        });
      }
      await this.audit.record({
        adminId: null,
        action: 'admin.login_failed',
        detail: { loginId },
        ip,
      });
      throw new AppException(
        'INVALID_CREDENTIALS',
        '아이디, 비밀번호 또는 OTP가 맞지 않아요.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.adminUser.update({
        where: { id: admin.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      });
      await this.audit.record(
        { adminId: admin.id, action: 'admin.login', ip },
        tx,
      );
      return { ...(await this.issue(admin.id, tx)), admin: toProfile(updated) };
    });
  }

  // 회전 방식. 이미 폐기된 토큰이 다시 오면 그 운영자의 토큰을 모두 폐기한다
  async refresh(refreshToken: string) {
    const now = this.clock.now();
    const row = await this.prisma.adminRefreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (!row) throw new AppException('UNAUTHORIZED');
    if (row.revokedAt) {
      await this.revokeAll(row.adminId);
      throw new AppException('UNAUTHORIZED');
    }
    if (row.expiresAt <= now) throw new AppException('UNAUTHORIZED');
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.adminRefreshToken.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (count === 0) throw new AppException('UNAUTHORIZED');
      return this.issue(row.adminId, tx);
    });
  }

  // 프론트 어드민은 refreshToken 없이 부른다 → 그 운영자의 토큰을 모두 폐기
  async logout(adminId: string, refreshToken: string | undefined, ip?: string) {
    if (refreshToken) {
      await this.prisma.adminRefreshToken.updateMany({
        where: { adminId, tokenHash: sha256(refreshToken), revokedAt: null },
        data: { revokedAt: this.clock.now() },
      });
    } else {
      await this.revokeAll(adminId);
    }
    await this.audit.record({ adminId, action: 'admin.logout', ip });
  }

  private async revokeAll(adminId: string) {
    await this.prisma.adminRefreshToken.updateMany({
      where: { adminId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  async me(adminId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
    });
    if (!admin) throw new AppException('UNAUTHORIZED');
    return toProfile(admin);
  }
}
