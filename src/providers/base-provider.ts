import type {
  Stream,
  Subtitle,
  StreamRequest,
  ProviderResult,
  HealthCheckResult,
  MediaType,
  TMDBMultiLangInfo,
  ContentLanguage,
  StreamFormat,
} from '../types/index.js';
import { fetchTMDBInfo, fetchIMDBFallback } from '../utils/tmdb.js';
import { searchCache } from '../utils/cache.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { searchOpenSubtitles, searchSubscene } from '../subtitles/index.js';

export abstract class BaseProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly supportedTypes: MediaType[];
  abstract readonly formats: StreamFormat[];
  abstract readonly contentLanguage: ContentLanguage[];

  protected rateLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });

  async getStreams(request: StreamRequest): Promise<ProviderResult> {
    const startTime = Date.now();

    const cacheKey = `provider:${this.id}:${request.tmdbId}:${request.mediaType}:${request.season}:${request.episode}`;
    const cached = searchCache.get<ProviderResult>(cacheKey);
    if (cached) return { ...cached, responseTimeMs: 0 };

    try {
      await this.rateLimiter.acquire();

      let tmdbInfo = await fetchTMDBInfo(request.tmdbId, request.mediaType);

      if (tmdbInfo.allTitles.length === 0 && request.imdbId) {
        const fallback = await fetchIMDBFallback(request.imdbId, request.mediaType);
        if (fallback) tmdbInfo = fallback;
      }

      if (tmdbInfo.allTitles.length === 0) {
        return this.errorResult('No titles found from TMDB', startTime);
      }

      const streams = await this.scrape(tmdbInfo, request);

      let subtitles: Subtitle[] = [];
      if (tmdbInfo.imdbId) {
        subtitles = await searchOpenSubtitles(
          tmdbInfo.imdbId,
          request.season,
          request.episode
        );
      }
      if (subtitles.length === 0 && tmdbInfo.allTitles.length > 0) {
        subtitles = await searchSubscene(tmdbInfo.allTitles[0]);
      }

      const result: ProviderResult = {
        providerId: this.id,
        providerName: this.name,
        streams,
        subtitles,
        responseTimeMs: Date.now() - startTime,
      };

      searchCache.set(cacheKey, result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.errorResult(msg, startTime);
    }
  }

  abstract scrape(
    tmdbInfo: TMDBMultiLangInfo,
    request: StreamRequest
  ): Promise<Stream[]>;

  async checkHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const result = await this.getStreams({
        tmdbId: '550',
        mediaType: 'movie',
      });

      return {
        providerId: this.id,
        healthy: result.streams.length > 0 || !result.error,
        responseTimeMs: Date.now() - startTime,
        timestamp: Date.now(),
      };
    } catch (err) {
      return {
        providerId: this.id,
        healthy: false,
        responseTimeMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      };
    }
  }

  private errorResult(error: string, startTime: number): ProviderResult {
    return {
      providerId: this.id,
      providerName: this.name,
      streams: [],
      subtitles: [],
      error,
      responseTimeMs: Date.now() - startTime,
    };
  }
}
