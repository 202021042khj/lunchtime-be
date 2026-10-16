import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env.js';

// 카카오 검색 · 날씨 캐시에 쓴다 (2단계-2부터).
// Redis가 꺼져 있어도 서버는 켜지고, 명령은 바로 실패한다
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private lastErrorLoggedAt = 0;
  readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 1000, 10_000),
    });
    // 끊겨 있는 동안 재시도마다 에러가 나므로 30초에 한 번만 남긴다
    this.client.on('error', (err: Error & { code?: string }) => {
      if (Date.now() - this.lastErrorLoggedAt < 30_000) return;
      this.lastErrorLoggedAt = Date.now();
      this.logger.warn(
        `Redis 연결 실패: ${err.message || err.code || err.name}`,
      );
    });
    this.client.connect().catch(() => undefined);
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  // 캐시: 있으면 꺼내고, 없으면 load()로 만들어 ttl초 동안 둔다.
  // Redis가 안 되면 캐시 없이 load()만 한다 (캐시 장애로 API가 실패하지 않게)
  async cached<T>(
    key: string,
    ttlSec: number,
    load: () => Promise<T>,
  ): Promise<T> {
    try {
      const hit = await this.client.get(key);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch {
      // 캐시 없이 진행
    }
    const value = await load();
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSec);
    } catch {
      // 다음 요청 때 다시 만든다
    }
    return value;
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }
}
