import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/errors/app.exception.js';
import type { Env } from '../../config/env.js';
import type { KmaBase, KmaGrid } from './kma-grid.js';

// 단기예보는 응답이 1초 넘게 걸릴 때가 있다
const TIMEOUT_MS = 8000;

export interface KmaItem {
  category: string;
  // 실황
  obsrValue?: string;
  // 예보
  fcstDate?: string;
  fcstTime?: string;
  fcstValue?: string;
}

export type KmaOperation =
  'getUltraSrtNcst' | 'getUltraSrtFcst' | 'getVilageFcst';

const unavailable = () =>
  new AppException('UPSTREAM_UNAVAILABLE', '날씨 정보를 불러오지 못했어요.');

// 기상청 단기예보 조회서비스 (공공데이터포털). 해석 · 캐시는 WeatherService가 맡는다
@Injectable()
export class KmaClient {
  private readonly logger = new Logger(KmaClient.name);
  private readonly serviceKey: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    const raw = config.get('KMA_SERVICE_KEY', { infer: true });
    // 인코딩된 키(%2B 등)를 넣어도 URLSearchParams가 한 번만 인코딩하도록 먼저 푼다
    this.serviceKey = raw.includes('%') ? decodeURIComponent(raw) : raw;
    this.baseUrl = config.get('KMA_BASE_URL', { infer: true });
  }

  get configured() {
    return Boolean(this.serviceKey);
  }

  async fetch(
    op: KmaOperation,
    base: KmaBase,
    grid: KmaGrid,
  ): Promise<KmaItem[]> {
    const params = new URLSearchParams({
      serviceKey: this.serviceKey,
      pageNo: '1',
      numOfRows: '1000',
      dataType: 'JSON',
      ...base,
      nx: String(grid.nx),
      ny: String(grid.ny),
    });
    let text: string;
    try {
      const res = await fetch(`${this.baseUrl}/${op}?${params}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      text = await res.text();
    } catch (error) {
      this.logger.warn(`기상청 ${op} 요청 실패: ${(error as Error).message}`);
      throw unavailable();
    }
    // 키 오류 등은 JSON이 아니라 XML로 온다
    let body: {
      response?: {
        header?: { resultCode?: string; resultMsg?: string };
        body?: { items?: { item?: KmaItem[] } };
      };
    };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      const msg =
        /<returnAuthMsg>(.*?)<\/returnAuthMsg>/.exec(text)?.[1] ??
        text.slice(0, 200);
      this.logger.warn(`기상청 ${op} 오류: ${msg}`);
      throw unavailable();
    }
    const header = body.response?.header;
    if (header?.resultCode !== '00') {
      this.logger.warn(
        `기상청 ${op} ${header?.resultCode} ${header?.resultMsg}`,
      );
      throw unavailable();
    }
    return body.response?.body?.items?.item ?? [];
  }
}
