import { Global, Injectable, Module } from '@nestjs/common';

// 현재 시각. 만료 · 재전송 · 잠금 규칙을 테스트에서 시간을 옮겨 가며 확인하려고 주입받는다
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({
  providers: [Clock],
  exports: [Clock],
})
export class ClockModule {}
