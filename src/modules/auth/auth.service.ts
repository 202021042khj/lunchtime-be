import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { AppException } from '../../common/errors/app.exception.js';
import {
  checkName,
  checkPassword,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from '../../common/auth/password.js';
import { Prisma, type User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmailVerificationService } from './email-verification.service.js';
import {
  SocialVerifierService,
  type SocialCredential,
  type SocialProvider,
} from './social-verifier.service.js';
import { UserSessionService, type AuthTokens } from './user-session.service.js';
import type { EmailCodeDto, EmailVerifyDto } from './dto/auth.dto.js';

const MAX_LOGIN_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

export interface LoginResponse extends AuthTokens {
  isNewUser: boolean;
  user: Pick<User, 'id' | 'name' | 'provider' | 'onboardingCompleted'> & {
    role: 'user';
  };
}

export function validationFailed(field: string, message: string): never {
  throw new AppException('VALIDATION_FAILED', message, {
    fields: { [field]: message },
  });
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: UserSessionService,
    private readonly verification: EmailVerificationService,
    private readonly social: SocialVerifierService,
    private readonly clock: Clock,
  ) {}

  private findEmailUser(
    email: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    return tx.user.findUnique({
      where: { provider_providerId: { provider: 'email', providerId: email } },
    });
  }

  private toLoginResponse(
    user: User,
    isNewUser: boolean,
    tokens: AuthTokens,
  ): LoginResponse {
    return {
      ...tokens,
      isNewUser,
      user: {
        id: user.id,
        name: user.name,
        provider: user.provider,
        role: 'user',
        onboardingCompleted: user.onboardingCompleted,
      },
    };
  }

  // ---------- 이메일 인증번호 ----------

  async sendEmailCode({ email: raw, purpose }: EmailCodeDto) {
    const email = normalizeEmail(raw);
    const exists = Boolean(await this.findEmailUser(email));
    if (purpose === 'signup' && exists) throw new AppException('EMAIL_TAKEN');
    // 재설정: 가입하지 않은 이메일이어도 같은 응답 (계정 존재 여부를 숨김)
    return this.verification.sendCode(
      email,
      purpose,
      purpose === 'signup' || exists,
    );
  }

  verifyEmailCode({ email, purpose, code }: EmailVerifyDto) {
    return this.verification.verifyCode(normalizeEmail(email), purpose, code);
  }

  // ---------- 이메일 가입 · 로그인 · 재설정 ----------

  async signup(input: {
    email: string;
    password: string;
    name: string;
    verificationToken: string;
  }): Promise<LoginResponse> {
    const email = normalizeEmail(input.email);
    const name = input.name.trim();
    const passwordError = checkPassword(input.password);
    if (passwordError) validationFailed('password', passwordError);
    const nameError = checkName(name);
    if (nameError) validationFailed('name', nameError);
    const passwordHash = await hashPassword(input.password);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.verification.consumeToken(
          tx,
          email,
          'signup',
          input.verificationToken,
        );
        if (await this.findEmailUser(email, tx))
          throw new AppException('EMAIL_TAKEN');
        const user = await tx.user.create({
          data: {
            provider: 'email',
            providerId: email,
            email,
            passwordHash,
            name,
            lastActiveAt: this.clock.now(),
          },
        });
        return this.toLoginResponse(
          user,
          true,
          await this.sessions.issue(user.id, tx),
        );
      });
    } catch (error) {
      // 같은 이메일로 동시에 가입하면 unique 제약에 걸린다
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppException('EMAIL_TAKEN');
      }
      throw error;
    }
  }

  async login(rawEmail: string, password: string): Promise<LoginResponse> {
    const email = normalizeEmail(rawEmail);
    const now = this.clock.now();
    const user = await this.findEmailUser(email);

    if (user?.lockedUntil && user.lockedUntil > now) {
      throw new AppException(
        'RATE_LIMITED',
        '로그인을 여러 번 실패했어요. 잠시 후 다시 시도해 주세요.',
      );
    }
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      if (user) {
        const failures = user.failedLoginCount + 1;
        await this.prisma.user.update({
          where: { id: user.id },
          data:
            failures >= MAX_LOGIN_FAILURES
              ? {
                  failedLoginCount: 0,
                  lockedUntil: new Date(now.getTime() + LOCK_MS),
                }
              : { failedLoginCount: failures },
        });
      }
      throw new AppException(
        'INVALID_CREDENTIALS',
        '이메일 또는 비밀번호가 맞지 않아요.',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastActiveAt: now },
    });
    return this.toLoginResponse(
      updated,
      false,
      await this.sessions.issue(user.id),
    );
  }

  async resetPassword(input: {
    email: string;
    password: string;
    verificationToken: string;
  }) {
    const email = normalizeEmail(input.email);
    const passwordError = checkPassword(input.password);
    if (passwordError) validationFailed('password', passwordError);
    const passwordHash = await hashPassword(input.password);

    await this.prisma.$transaction(async (tx) => {
      await this.verification.consumeToken(
        tx,
        email,
        'reset',
        input.verificationToken,
      );
      const user = await this.findEmailUser(email, tx);
      if (!user)
        throw new AppException('INVALID_CODE', '이메일 인증을 다시 해 주세요.');
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
      // 비밀번호를 잊어 재설정했으므로 다른 기기 로그인도 모두 끊는다
      await this.sessions.revokeAll(user.id, tx);
    });
  }

  // ---------- 소셜 ----------

  async socialLogin(
    provider: SocialProvider,
    input: {
      providerToken?: string;
      code?: string;
      redirectUri?: string;
      // 애플은 이름을 ID 토큰에 넣지 않고 첫 로그인 때 앱에만 준다 → 앱이 같이 보낸다
      name?: string;
    },
  ): Promise<LoginResponse> {
    let credential: SocialCredential;
    if (input.providerToken) {
      credential = { providerToken: input.providerToken };
    } else if (input.code && input.redirectUri) {
      credential = { code: input.code, redirectUri: input.redirectUri };
    } else {
      throw new AppException(
        'VALIDATION_FAILED',
        'providerToken 또는 code와 redirectUri를 보내 주세요.',
      );
    }
    const profile = await this.social.verify(provider, credential);
    const now = this.clock.now();
    const existing = await this.prisma.user.findUnique({
      where: {
        provider_providerId: { provider, providerId: profile.providerId },
      },
    });
    if (existing) {
      const user = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          lastActiveAt: now,
          // 새로 받은 회사 쪽 토큰이 있으면 바꿔 둔다 (탈퇴 때 폐기용)
          ...(profile.refreshToken && {
            socialRefreshToken: profile.refreshToken,
          }),
        },
      });
      return this.toLoginResponse(
        user,
        false,
        await this.sessions.issue(user.id),
      );
    }

    // 이름을 못 받았거나 규칙(2~12자)에 맞지 않으면 임시 이름을 붙인다 (MY에서 바꿀 수 있게 2단계-2)
    const name = (profile.name ?? input.name)?.trim().slice(0, 12);
    const user = await this.prisma.user.create({
      data: {
        provider,
        providerId: profile.providerId,
        email: profile.email ? normalizeEmail(profile.email) : null,
        socialRefreshToken: profile.refreshToken,
        name:
          name && name.length >= 2
            ? name
            : `점심친구${Math.floor(1000 + Math.random() * 9000)}`,
        lastActiveAt: now,
      },
    });
    return this.toLoginResponse(user, true, await this.sessions.issue(user.id));
  }

  // ---------- 토큰 ----------

  refresh(refreshToken: string) {
    return this.sessions.rotate(refreshToken);
  }

  async logout(refreshToken: string | undefined) {
    if (refreshToken) await this.sessions.revoke(refreshToken);
  }
}
