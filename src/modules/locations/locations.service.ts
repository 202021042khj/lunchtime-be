import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import { RedisService } from '../../integrations/cache/redis.service.js';
import {
  KakaoLocalClient,
  type KakaoAddressDoc,
  type KakaoPlaceDoc,
} from '../../integrations/kakao/kakao-local.client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SavedLocationInputDto } from './locations.dto.js';

const MAX_SAVED = 10;
const SEARCH_LIMIT = 10;
// 동네 이름은 거의 안 바뀌고, 검색 결과는 장소가 바뀔 수 있어 짧게
const SEARCH_TTL_SEC = 10 * 60;
const REVERSE_TTL_SEC = 24 * 60 * 60;

export interface LocationSearchResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

const lastWord = (address: string) =>
  address.trim().split(/\s+/).pop() ?? address;

// 주소 검색 결과 → 동네 이름(법정동 → 행정동 → 주소 끝 단어). 도로명은 건물 이름이 있으면 그것
function fromAddress(doc: KakaoAddressDoc): LocationSearchResult {
  const name =
    doc.road_address?.building_name ||
    doc.address?.region_3depth_name ||
    doc.address?.region_3depth_h_name ||
    lastWord(doc.address_name);
  return {
    name,
    address: doc.address_name,
    lat: Number(doc.y),
    lng: Number(doc.x),
  };
}

const fromPlace = (doc: KakaoPlaceDoc): LocationSearchResult => ({
  name: doc.place_name,
  address: doc.road_address_name || doc.address_name,
  lat: Number(doc.y),
  lng: Number(doc.x),
});

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kakao: KakaoLocalClient,
    private readonly cache: RedisService,
  ) {}

  async list(userId: string) {
    const rows = await this.prisma.savedLocation.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return { items: rows.map(toSavedLocation) };
  }

  async add(userId: string, input: SavedLocationInputDto) {
    const count = await this.prisma.savedLocation.count({ where: { userId } });
    if (count >= MAX_SAVED) {
      throw new AppException(
        'CONFLICT',
        `위치는 ${MAX_SAVED}개까지 저장할 수 있어요.`,
      );
    }
    const row = await this.prisma.savedLocation.create({
      data: {
        userId,
        label: input.label.trim(),
        name: input.name.trim(),
        address: input.address.trim(),
        lat: input.lat,
        lng: input.lng,
      },
    });
    return toSavedLocation(row);
  }

  // 남의 위치를 지우려 하면 없는 것과 같게 404
  async remove(userId: string, id: string) {
    const { count } = await this.prisma.savedLocation.deleteMany({
      where: { id, userId },
    });
    if (count === 0)
      throw new AppException('NOT_FOUND', '저장한 위치를 찾을 수 없어요.');
  }

  // 동네 · 도로명 · 건물명 검색: 주소 검색(동네)을 먼저, 이어서 장소 키워드 검색
  async search(
    q: string | undefined,
  ): Promise<{ items: LocationSearchResult[] }> {
    const query = q?.trim();
    if (!query) return { items: [] };
    const items = await this.cache.cached(
      `loc:search:${query}`,
      SEARCH_TTL_SEC,
      async () => {
        const [addresses, places] = await Promise.all([
          this.kakao.searchAddress(query, SEARCH_LIMIT),
          this.kakao.searchKeyword(query, SEARCH_LIMIT),
        ]);
        const seen = new Set<string>();
        return [...addresses.map(fromAddress), ...places.map(fromPlace)]
          .filter((r) => {
            const key = `${r.name}|${r.address}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, SEARCH_LIMIT);
      },
    );
    return { items };
  }

  // 좌표 → 동네 이름 (법정동, 예: 역삼동). 100m 단위로 묶어 캐시한다
  async reverse(lat: number, lng: number) {
    const key = `loc:reverse:${lat.toFixed(3)},${lng.toFixed(3)}`;
    const name = await this.cache.cached(key, REVERSE_TTL_SEC, async () => {
      const regions = await this.kakao.coordToRegion(lat, lng);
      const legal = regions.find((r) => r.region_type === 'B');
      const admin = regions.find((r) => r.region_type === 'H');
      const region = legal ?? admin;
      if (!region)
        throw new AppException(
          'OUT_OF_SERVICE_AREA',
          '국내 위치만 쓸 수 있어요.',
        );
      return region.region_3depth_name || lastWord(region.address_name);
    });
    return { name, lat, lng };
  }
}

function toSavedLocation(row: {
  id: string;
  label: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}) {
  return {
    id: row.id,
    label: row.label,
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
  };
}
