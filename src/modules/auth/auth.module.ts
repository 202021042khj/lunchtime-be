import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EmailVerificationService } from './email-verification.service.js';
import { SocialVerifierService } from './social-verifier.service.js';
import { UserSessionService } from './user-session.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    UserSessionService,
    EmailVerificationService,
    SocialVerifierService,
  ],
  exports: [UserSessionService, SocialVerifierService],
})
export class AuthModule {}
