import { Injectable, Logger } from '@nestjs/common';
import { MailService, type VerificationPurpose } from './mail.service.js';

const PURPOSE_LABEL: Record<VerificationPurpose, string> = {
  signup: '가입',
  reset: '비밀번호 재설정',
};

// 개발용: 메일을 보내지 않고 인증번호를 서버 로그에 남긴다 (발송 서비스 미결정)
@Injectable()
export class LogMailService extends MailService {
  private readonly logger = new Logger('Mail');

  sendVerificationCode(
    email: string,
    code: string,
    purpose: VerificationPurpose,
  ) {
    this.logger.log(`[${PURPOSE_LABEL[purpose]} 인증번호] ${email} → ${code}`);
    return Promise.resolve();
  }
}
