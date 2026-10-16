import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/errors/app.exception.js';
import type { Env } from '../../config/env.js';

const LOCAL = 'https://dapi.kakao.com/v2/local';
const TIMEOUT_MS = 5000;

export interface KakaoPlaceDoc {
  id: string;
  place_name: string;
  category_name: string;
  address_name: string;
  road_address_name: string;
  phone: string;
  x: string;
  y: string;
  place_url: string;
  distance?: string;
}

export interface KakaoAddressDoc {
  address_name: string;
  x: string;
  y: string;
  address: { region_3depth_name: string; region_3depth_h_name: string } | null;
  road_address: { building_name: string; region_3depth_name: string } | null;
}

export interface KakaoRegionDoc {
  // B: 법정동, H: 행정동
  region_type: 'B' | 'H';
  address_name: string;
  region_3depth_name: string;
}

// 카카오 로컬 REST API (REST 키 · KakaoAK). 위치 검색 · 좌표→동네, 식당 검색(2단계-3)
@Injectable()
export class KakaoLocalClient {
  private readonly logger = new Logger(KakaoLocalClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  // 국내 밖 좌표는 422, 우리 키 · 쿼터 문제(401 · 403 · 429)나 카카오 장애는 502
  private async get<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const url = `${LOCAL}${path}?${new URLSearchParams(params)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `KakaoAK ${this.config.get('KAKAO_REST_KEY', { infer: true })}`,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(
        `카카오 로컬 요청 실패 ${path}: ${(error as Error).message}`,
      );
      throw new AppException(
        'UPSTREAM_UNAVAILABLE',
        '카카오 응답이 없어요. 잠시 후 다시 시도해 주세요.',
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 국내가 아닌 좌표: 400 { code: -2, msg: "...not in the service area" }
      if (res.status === 400 && /"code"\s*:\s*-2\b/.test(body)) {
        throw new AppException(
          'OUT_OF_SERVICE_AREA',
          '국내 위치만 쓸 수 있어요.',
        );
      }
      this.logger.warn(
        `카카오 로컬 ${res.status} ${path}: ${body.slice(0, 200)}`,
      );
      throw new AppException(
        'UPSTREAM_UNAVAILABLE',
        '카카오 응답이 없어요. 잠시 후 다시 시도해 주세요.',
      );
    }
    return (await res.json()) as T;
  }

  async searchKeyword(query: string, size = 10): Promise<KakaoPlaceDoc[]> {
    const res = await this.get<{ documents: KakaoPlaceDoc[] }>(
      '/search/keyword.json',
      {
        query,
        size: String(size),
      },
    );
    return res.documents;
  }

  async searchAddress(query: string, size = 10): Promise<KakaoAddressDoc[]> {
    const res = await this.get<{ documents: KakaoAddressDoc[] }>(
      '/search/address.json',
      {
        query,
        size: String(size),
      },
    );
    return res.documents;
  }

  async coordToRegion(lat: number, lng: number): Promise<KakaoRegionDoc[]> {
    const res = await this.get<{ documents: KakaoRegionDoc[] }>(
      '/geo/coord2regioncode.json',
      {
        x: String(lng),
        y: String(lat),
      },
    );
    return res.documents;
  }
}
