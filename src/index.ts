import type { StreamRequest, SearchResult, ProviderResult } from './types/index.js';
import { VoduProvider } from './providers/vodu.js';
import { CinemaBoxProvider } from './providers/cinemabox.js';
import { CinemanaProvider } from './providers/cinemana.js';
import { AnimeProvider } from './providers/anime.js';
import { BaseProvider } from './providers/base-provider.js';
import { searchCache } from './utils/cache.js';
import { AnalyticsLogger } from './analytics/logger.js';
import { HealthMonitor } from './health/monitor.js';

export { BaseProvider } from './providers/base-provider.js';
export { VoduProvider } from './providers/vodu.js';
export { CinemaBoxProvider } from './providers/cinemabox.js';
export { CinemanaProvider } from './providers/cinemana.js';
export { AnimeProvider } from './providers/anime.js';
export { HealthMonitor } from './health/monitor.js';
export { AnalyticsLogger } from './analytics/logger.js';
export { generateWeeklyReport } from './analytics/report.js';
export { Cache, searchCache } from './utils/cache.js';
export type * from './types/index.js';

const providers: BaseProvider[] = [
  new VoduProvider(),
  new CinemaBoxProvider(),
  new CinemanaProvider(),
  new AnimeProvider(),
];

const analytics = new AnalyticsLogger();

export async function search(request: StreamRequest): Promise<SearchResult> {
  const cacheKey = searchCache.buildKey([
    'search',
    request.tmdbId,
    request.mediaType,
    request.season,
    request.episode,
  ]);

  const cached = searchCache.get<SearchResult>(cacheKey);
  if (cached) return { ...cached, cached: true };

  const results: ProviderResult[] = await Promise.all(
    providers
      .filter((p) => p.supportedTypes.includes(request.mediaType))
      .map((p) => p.getStreams(request))
  );

  for (const result of results) {
    analytics.log(result, request.mediaType);
  }

  const totalStreams = results.reduce((sum, r) => sum + r.streams.length, 0);

  const searchResult: SearchResult = {
    results,
    cached: false,
    totalStreams,
    timestamp: Date.now(),
  };

  searchCache.set(cacheKey, searchResult);
  return searchResult;
}

export function getProviders(): BaseProvider[] {
  return [...providers];
}

export function getHealthMonitor(): HealthMonitor {
  return new HealthMonitor(providers);
}

export function getAnalyticsLogger(): AnalyticsLogger {
  return analytics;
}
