export type VerificationPurpose = 'signup' | 'reset';

// 메일 발송부. 실제 서비스(SES · Resend 등)는 이 클래스를 상속한 구현을 하나 추가하고
// mail.module.ts의 useClass만 바꾼다
export abstract class MailService {
  abstract sendVerificationCode(
    email: string,
    code: string,
    purpose: VerificationPurpose,
  ): Promise<void>;
}
