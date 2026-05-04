import type {
  Stream,
  StreamRequest,
  TMDBMultiLangInfo,
  QualityLabel,
  ContentLanguage,
  StreamFormat,
  MediaType,
} from '../types/index.js';
import { BaseProvider } from './base-provider.js';
import { fetchJSON } from '../utils/fetch.js';
import { sortByQuality } from '../utils/quality.js';
import { similarity } from '../utils/similarity.js';

const CB_API = 'https://cinema.albox.co/api/v4/';

interface CBSearchResult {
  id: string;
  type: string;
  title?: string;
  year?: number;
}

interface CBSearchResponse {
  results?: CBSearchResult[];
}

interface CBEpisode {
  id: string;
  card_type?: string;
}

interface CBSection {
  data?: CBEpisode[];
}

interface CBDetail {
  post_info?: { episode_id?: string };
  sections?: CBSection[];
}

interface CBVideo {
  url?: string;
  quality?: string | number;
}

interface CBPlayerResponse {
  videos?: CBVideo[];
}

export class CinemaBoxProvider extends BaseProvider {
  readonly id = 'cinemabox-iraq';
  readonly name = 'CinemaBox';
  readonly supportedTypes: MediaType[] = ['movie', 'tv'];
  readonly formats: StreamFormat[] = ['mp4'];
  readonly contentLanguage: ContentLanguage[] = ['ar', 'en'];

  async scrape(
    tmdbInfo: TMDBMultiLangInfo,
    request: StreamRequest
  ): Promise<Stream[]> {
    return this.searchTitles(
      tmdbInfo.allTitles,
      request.mediaType,
      request.season,
      request.episode,
      tmdbInfo.year
    );
  }

  private async searchTitles(
    titles: string[],
    mediaType: MediaType,
    season?: number,
    episode?: number,
    year?: number
  ): Promise<Stream[]> {
    for (const title of titles) {
      const data = await fetchJSON<CBSearchResponse>(
        `${CB_API}search?q=${encodeURIComponent(title)}`
      );

      if (!data.results?.length) continue;

      const targetType = mediaType === 'movie' ? 'MOVIE' : 'SERIES';
      let candidates = data.results.filter((r) => r.type === targetType);
      if (candidates.length === 0) candidates = data.results;

      if (year) {
        const yearFiltered = candidates.filter((c) => c.year === year);
        if (yearFiltered.length > 0) candidates = yearFiltered;
      }

      const ranked = candidates
        .map((c) => ({
          result: c,
          score: similarity(title, c.title ?? ''),
        }))
        .sort((a, b) => b.score - a.score);

      const match = ranked[0]?.result;
      if (!match) continue;

      const detail = await fetchJSON<CBDetail>(
        `${CB_API}shows/shows/dynamic/${match.id}`
      );
      if (!detail.post_info) continue;

      if (mediaType === 'movie') {
        const epId = detail.post_info.episode_id;
        if (!epId) continue;
        return this.getPlayerStreams(epId);
      }

      return this.getTVStreams(
        detail,
        match.id,
        season ?? 1,
        episode ?? 1
      );
    }
    return [];
  }

  private async getTVStreams(
    detail: CBDetail,
    _showId: string,
    _sNum: number,
    eNum: number
  ): Promise<Stream[]> {
    const sections = detail.sections ?? [];
    let seasonItems: CBEpisode[] = [];
    for (const sec of sections) {
      if (sec.data?.length && sec.data[0].card_type === 'episode') {
        seasonItems = sec.data;
        break;
      }
    }

    if (seasonItems.length > 0 && eNum <= seasonItems.length) {
      const ep = seasonItems[eNum - 1];
      if (ep?.id) return this.getPlayerStreams(ep.id);
    }

    if (detail.post_info?.episode_id) {
      return this.getPlayerStreams(detail.post_info.episode_id);
    }
    return [];
  }

  private async getPlayerStreams(episodeId: string): Promise<Stream[]> {
    const data = await fetchJSON<CBPlayerResponse>(
      `${CB_API}shows/episodes/player/${episodeId}`
    );

    const streams: Stream[] = [];
    const seen = new Set<string>();

    for (const v of data.videos ?? []) {
      if (!v.url || seen.has(v.url)) continue;
      seen.add(v.url);

      let q: QualityLabel;
      if (typeof v.quality === 'number') {
        q = `${v.quality}p` as QualityLabel;
      } else {
        q = (v.quality as QualityLabel) ?? 'HD';
      }

      streams.push({
        name: this.name,
        title: `${this.name} ${q}`,
        url: v.url,
        quality: q,
        format: 'mp4',
      });
    }

    if (streams.length === 0) {
      const text = JSON.stringify(data);
      const re = /(https?:\/\/cloud[0-9]*\.albox\.co\/episodes\/[^"'\s,\]]+\.mp4)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (!seen.has(m[1])) {
          seen.add(m[1]);
          streams.push({
            name: this.name,
            title: `${this.name} HD`,
            url: m[1],
            quality: 'HD',
            format: 'mp4',
          });
        }
      }
    }

    return sortByQuality(streams);
  }
}
