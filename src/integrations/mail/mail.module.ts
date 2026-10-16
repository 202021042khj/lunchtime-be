import { Global, Module } from '@nestjs/common';
import { LogMailService } from './log-mail.service.js';
import { MailService } from './mail.service.js';

@Global()
@Module({
  providers: [{ provide: MailService, useClass: LogMailService }],
  exports: [MailService],
})
export class MailModule {}
