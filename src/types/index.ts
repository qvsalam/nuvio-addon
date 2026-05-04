export type MediaType = 'movie' | 'tv';

export type SubtitleFormat = 'vtt' | 'srt' | 'ass';

export type StreamFormat = 'mp4' | 'm3u8';

export type QualityLabel =
  | '2160p'
  | '1080p'
  | '720p'
  | '480p'
  | '360p'
  | '240p'
  | 'HLS'
  | 'HD'
  | 'Unknown';

export type ContentLanguage = 'ar' | 'en';

export interface Subtitle {
  language: ContentLanguage;
  format: SubtitleFormat;
  url: string;
  isHardsub: boolean;
}

export interface Stream {
  name: string;
  title: string;
  url: string;
  quality: QualityLabel;
  format?: StreamFormat;
  subtitles?: Subtitle[];
}

export interface StreamRequest {
  tmdbId: string;
  imdbId?: string;
  mediaType: MediaType;
  season?: number;
  episode?: number;
  year?: number;
  anilistId?: string;
  malId?: string;
}

export interface TMDBInfo {
  title?: string;
  original_title?: string;
  name?: string;
  original_name?: string;
  id?: number;
  imdb_id?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
}

export interface TMDBMultiLangInfo {
  enTitles: string[];
  arTitles: string[];
  allTitles: string[];
  imdbId?: string;
  year?: number;
}

export interface ProviderResult {
  providerId: string;
  providerName: string;
  streams: Stream[];
  subtitles: Subtitle[];
  error?: string;
  responseTimeMs: number;
}

export interface SearchResult {
  results: ProviderResult[];
  cached: boolean;
  totalStreams: number;
  timestamp: number;
}

export interface ProviderManifestEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  supportedTypes: MediaType[];
  filename: string;
  enabled: boolean;
  formats: StreamFormat[];
  logo: string;
  contentLanguage: ContentLanguage[];
  status?: ProviderStatus;
}

export interface ProviderStatus {
  healthy: boolean;
  lastChecked: number;
  successRate: number;
  errorCount: number;
  totalRequests: number;
  averageResponseMs: number;
}

export interface HealthCheckResult {
  providerId: string;
  healthy: boolean;
  responseTimeMs: number;
  error?: string;
  timestamp: number;
}

export interface AnalyticsEntry {
  providerId: string;
  timestamp: number;
  success: boolean;
  streamCount: number;
  averageQuality: QualityLabel;
  responseTimeMs: number;
  error?: string;
  mediaType: MediaType;
}

export interface WeeklyReport {
  generatedAt: number;
  periodStart: number;
  periodEnd: number;
  providers: ProviderReport[];
  totalStreamsServed: number;
  overallSuccessRate: number;
}

export interface ProviderReport {
  providerId: string;
  providerName: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  averageResponseMs: number;
  averageQuality: QualityLabel;
  streamCount: number;
}

export interface CacheEntry<T> {
  data: T;
  expiry: number;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
}

export interface Manifest {
  name: string;
  version: string;
  scrapers: ProviderManifestEntry[];
}
