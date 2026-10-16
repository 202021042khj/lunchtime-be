import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { AppException } from '../../common/errors/app.exception.js';
import {
  newNumericCode,
  newOpaqueToken,
  sha256,
} from '../../common/auth/opaque-token.js';
import { MailService } from '../../integrations/mail/mail.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  EmailCodePurpose,
  Prisma,
} from '../../generated/prisma/client.js';

// API.md 이메일 인증 규칙
export const CODE_TTL_SEC = 600;
export const RESEND_AFTER_SEC = 60;
const MAX_ATTEMPTS = 5;
// 인증을 마친 뒤 가입 · 재설정을 끝내야 하는 시간
const VERIFIED_TOKEN_TTL_MS = 30 * 60 * 1000;

const codeHash = (email: string, code: string) => sha256(`${email}:${code}`);

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly clock: Clock,
  ) {}

  // 가입 여부 확인(EMAIL_TAKEN · 없는 계정 숨기기)은 호출하는 쪽이 먼저 한다.
  // send=false면 같은 응답을 주되 메일은 보내지 않는다 (가입하지 않은 이메일의 재설정 요청)
  async sendCode(email: string, purpose: EmailCodePurpose, send: boolean) {
    const now = this.clock.now();
    const latest = await this.prisma.emailVerification.findFirst({
      where: { email, purpose },
      orderBy: { createdAt: 'desc' },
    });
    if (
      latest &&
      now.getTime() - latest.createdAt.getTime() < RESEND_AFTER_SEC * 1000
    ) {
      throw new AppException('RATE_LIMITED', '잠시 후 다시 받아 주세요.');
    }
    const code = newNumericCode();
    // 메일을 보내지 않는 경우에도 기록은 남겨 재전송 간격을 똑같이 적용한다
    await this.prisma.emailVerification.create({
      data: {
        email,
        purpose,
        codeHash: send ? codeHash(email, code) : sha256(newOpaqueToken()),
        expiresAt: new Date(now.getTime() + CODE_TTL_SEC * 1000),
        createdAt: now,
      },
    });
    if (send) await this.mail.sendVerificationCode(email, code, purpose);
    return { expiresInSec: CODE_TTL_SEC, resendAfterSec: RESEND_AFTER_SEC };
  }

  async verifyCode(email: string, purpose: EmailCodePurpose, code: string) {
    const now = this.clock.now();
    const latest = await this.prisma.emailVerification.findFirst({
      where: { email, purpose },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest || latest.attempts >= MAX_ATTEMPTS) {
      throw new AppException('CODE_EXPIRED', '인증번호를 다시 받아 주세요.');
    }
    if (latest.expiresAt <= now) {
      throw new AppException(
        'CODE_EXPIRED',
        '인증번호 시간이 지났어요. 다시 받아 주세요.',
      );
    }
    if (latest.codeHash !== codeHash(email, code)) {
      await this.prisma.emailVerification.update({
        where: { id: latest.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppException('INVALID_CODE', '인증번호가 맞지 않아요.');
    }
    const verificationToken = newOpaqueToken();
    await this.prisma.emailVerification.update({
      where: { id: latest.id },
      data: { verifiedAt: now, verificationToken: sha256(verificationToken) },
    });
    return { verificationToken };
  }

  // 가입 · 재설정 트랜잭션 안에서 부른다. 한 번 쓰면 다시 못 쓴다
  async consumeToken(
    tx: Prisma.TransactionClient,
    email: string,
    purpose: EmailCodePurpose,
    verificationToken: string,
  ) {
    const now = this.clock.now();
    const row = await tx.emailVerification.findUnique({
      where: { verificationToken: sha256(verificationToken) },
    });
    const valid =
      row &&
      row.email === email &&
      row.purpose === purpose &&
      !row.usedAt &&
      row.verifiedAt &&
      now.getTime() - row.verifiedAt.getTime() < VERIFIED_TOKEN_TTL_MS;
    if (!valid)
      throw new AppException('INVALID_CODE', '이메일 인증을 다시 해 주세요.');
    const { count } = await tx.emailVerification.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (count === 0)
      throw new AppException('INVALID_CODE', '이메일 인증을 다시 해 주세요.');
  }
}
