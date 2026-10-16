import { Injectable } from '@nestjs/common';
import { RedisService } from '../../integrations/cache/redis.service.js';
import type { KakaoPlaceDoc } from '../../integrations/kakao/kakao-local.client.js';

// 식당 표시 정보. 우리 DB에 식당 테이블은 두지 않고(API.md), 카카오 검색 결과를 잠깐 기억해 둔다
export interface Place {
  placeId: string;
  name: string;
  // 음식 종류 (한식 · 아시안 …). 카카오 2단계 카테고리를 우리 이름으로 바꾼 것
  category: string;
  categoryPath: string;
  address: string;
  phone: string | null;
  lat: number;
  lng: number;
  kakaoMapUrl: string;
}

// 카카오 2단계 카테고리 → 우리 음식 종류 이름 (취향 · 찜 필터와 같은 값)
const CATEGORY_NAMES: Record<string, string> = {
  아시아음식: '아시안',
  샐러드: '샐러드·건강식',
};

export function cuisineOf(categoryPath: string): string {
  const parts = categoryPath.split('>').map((p) => p.trim());
  const second = parts[1] ?? parts[0] ?? '';
  return CATEGORY_NAMES[second] ?? second;
}

export const kakaoMapUrl = (placeId: string) =>
  `https://place.map.kakao.com/${placeId}`;

export function placeFromKakao(doc: KakaoPlaceDoc): Place {
  return {
    placeId: doc.id,
    name: doc.place_name,
    category: cuisineOf(doc.category_name),
    categoryPath: doc.category_name,
    address: doc.road_address_name || doc.address_name,
    phone: doc.phone || null,
    lat: Number(doc.y),
    lng: Number(doc.x),
    kakaoMapUrl: kakaoMapUrl(doc.id),
  };
}

// 카카오에는 "ID로 식당 한 곳 조회"가 없어서, 검색 결과로 돌려준 식당을 7일 동안 기억해
// 상세 · 찜에 쓴다. Redis가 꺼져 있으면 기억하지 못한다(찜한 식당은 Favorite에 따로 저장)
const TTL_SEC = 7 * 24 * 60 * 60;
const key = (placeId: string) => `place:${placeId}`;

@Injectable()
export class PlaceCacheService {
  constructor(private readonly redis: RedisService) {}

  async remember(places: Place[]): Promise<void> {
    if (!places.length) return;
    try {
      const pipeline = this.redis.client.pipeline();
      for (const p of places)
        pipeline.set(key(p.placeId), JSON.stringify(p), 'EX', TTL_SEC);
      await pipeline.exec();
    } catch {
      // 기억하지 못해도 목록은 그대로 돌려준다
    }
  }

  async get(placeId: string): Promise<Place | null> {
    try {
      const raw = await this.redis.client.get(key(placeId));
      return raw ? (JSON.parse(raw) as Place) : null;
    } catch {
      return null;
    }
  }
}
