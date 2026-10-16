import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { AppException } from '../../common/errors/app.exception.js';
import { RedisService } from '../../integrations/cache/redis.service.js';
import {
  dailyBase,
  kstDate,
  ncstBase,
  toGrid,
  ultraFcstBase,
} from '../../integrations/kma/kma-grid.js';
import { KmaClient, type KmaItem } from '../../integrations/kma/kma.client.js';

// 프론트 types/weather.ts. 강수형태(PTY)가 있으면 그 값, 없으면 하늘상태(SKY)
export type WeatherCondition =
  'clear' | 'cloudy' | 'overcast' | 'rain' | 'sleet' | 'snow';

export interface Weather {
  tempC: number;
  condition: WeatherCondition;
  label: string;
  highC: number | null;
  lowC: number | null;
}

const SKY: Record<string, [WeatherCondition, string]> = {
  '1': ['clear', '맑음'],
  '3': ['cloudy', '구름많음'],
  '4': ['overcast', '흐림'],
};
const PTY: Record<string, [WeatherCondition, string]> = {
  '1': ['rain', '비'],
  '2': ['sleet', '비/눈'],
  '3': ['snow', '눈'],
  '5': ['rain', '빗방울'],
  '6': ['sleet', '빗방울눈날림'],
  '7': ['snow', '눈날림'],
};

// API.md: 현재 날씨(초단기실황 · 초단기예보)는 격자별 1시간, 최고/최저(단기예보)는 격자별 하루 캐시
const NOW_TTL_SEC = 60 * 60;
const DAILY_TTL_SEC = 24 * 60 * 60;

interface NowWeather {
  tempC: number;
  condition: WeatherCondition;
  label: string;
}

// 현재 기온 · 하늘 + 오늘 최고/최저를 합친다. 순수 함수 (테스트용으로 내보냄)
export function parseNow(ncst: KmaItem[], ultra: KmaItem[]): NowWeather {
  const obs = Object.fromEntries(ncst.map((i) => [i.category, i.obsrValue]));
  const sky = ultra
    .filter((i) => i.category === 'SKY')
    .sort((a, b) =>
      `${a.fcstDate}${a.fcstTime}`.localeCompare(`${b.fcstDate}${b.fcstTime}`),
    )[0]?.fcstValue;
  const pty = obs.PTY && obs.PTY !== '0' ? PTY[obs.PTY] : undefined;
  const [condition, label] = pty ?? SKY[sky ?? ''] ?? ['cloudy', '구름많음'];
  const temp = Number(obs.T1H);
  if (!Number.isFinite(temp))
    throw new AppException(
      'UPSTREAM_UNAVAILABLE',
      '날씨 정보를 불러오지 못했어요.',
    );
  return { tempC: Math.round(temp), condition, label };
}

export function parseDaily(
  daily: KmaItem[],
  today: string,
): { highC: number | null; lowC: number | null } {
  const pick = (category: string) => {
    const value = daily.find(
      (i) => i.category === category && i.fcstDate === today,
    )?.fcstValue;
    return value != null && Number.isFinite(Number(value))
      ? Math.round(Number(value))
      : null;
  };
  return { highC: pick('TMX'), lowC: pick('TMN') };
}

@Injectable()
export class WeatherService {
  constructor(
    private readonly kma: KmaClient,
    private readonly cache: RedisService,
    private readonly clock: Clock,
  ) {}

  // 실패하면 502 UPSTREAM_UNAVAILABLE. 추천은 이걸 잡아 weather: null로 계속한다 (2단계-3b)
  async current(lat: number, lng: number): Promise<Weather> {
    if (!this.kma.configured) {
      throw new AppException(
        'UPSTREAM_UNAVAILABLE',
        '날씨 정보를 불러오지 못했어요.',
      );
    }
    const now = this.clock.now();
    const grid = toGrid(lat, lng);
    const ncst = ncstBase(now);
    const nowKey = `weather:now:${grid.nx},${grid.ny}:${ncst.base_date}${ncst.base_time}`;
    const today = kstDate(now);
    const dailyKey = `weather:daily:${grid.nx},${grid.ny}:${today}`;

    const [current, daily] = await Promise.all([
      this.cache.cached(nowKey, NOW_TTL_SEC, async () => {
        const [obs, ultra] = await Promise.all([
          this.kma.fetch('getUltraSrtNcst', ncst, grid),
          this.kma.fetch('getUltraSrtFcst', ultraFcstBase(now), grid),
        ]);
        return parseNow(obs, ultra);
      }),
      // 최고/최저는 없어도 현재 날씨는 보여 준다
      this.cache
        .cached(dailyKey, DAILY_TTL_SEC, async () =>
          parseDaily(
            await this.kma.fetch('getVilageFcst', dailyBase(now), grid),
            today,
          ),
        )
        .catch(() => ({ highC: null, lowC: null })),
    ]);
    return { ...current, ...daily };
  }
}
