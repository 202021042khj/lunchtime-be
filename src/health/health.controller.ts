import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/auth/decorators.js';
import { RedisService } from '../integrations/cache/redis.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// 운영 확인용이라 API.md 에러 형식 대신 무엇이 down인지 그대로 돌려준다
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '서버 · DB · Redis 상태 (하나라도 down이면 503)' })
  async check(@Res({ passthrough: true }) res: Response) {
    const [db, redis] = await Promise.all([this.pingDb(), this.redis.ping()]);
    const ok = db && redis;
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: ok ? 'ok' : 'degraded',
      checks: { db: db ? 'up' : 'down', redis: redis ? 'up' : 'down' },
    };
  }

  private async pingDb(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
