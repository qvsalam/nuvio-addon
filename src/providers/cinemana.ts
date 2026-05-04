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

const CINEMANA_API = 'https://cinemana.shabakaty.com/api/android/';

interface CinemanaSearchResult {
  nb: string;
  en_title?: string;
  ar_title?: string;
  title?: string;
  year?: string;
  kind?: string;
}

interface CinemanaEpisode {
  nb: string;
  episodeNummer?: string;
  episodeNumber?: string;
}

interface CinemanaSeason {
  season?: string;
  seasonNumber?: string;
  episodes?: CinemanaEpisode[];
}

interface CinemanaFile {
  videoUrl?: string;
  url?: string;
  transcoddedFile?: string;
  resolution?: string | number;
  quality?: string | number;
}

export class CinemanaProvider extends BaseProvider {
  readonly id = 'cinemana-iraq';
  readonly name = 'Cinemana';
  readonly supportedTypes: MediaType[] = ['movie', 'tv'];
  readonly formats: StreamFormat[] = ['mp4'];
  readonly contentLanguage: ContentLanguage[] = ['ar', 'en'];

  async scrape(
    tmdbInfo: TMDBMultiLangInfo,
    request: StreamRequest
  ): Promise<Stream[]> {
    const type = request.mediaType === 'movie' ? 'movies' : 'series';
    const isAnime = this.detectAnime(tmdbInfo);

    return this.searchTitles(
      tmdbInfo.allTitles,
      type,
      request.season,
      request.episode,
      tmdbInfo.year,
      isAnime
    );
  }

  private detectAnime(tmdbInfo: TMDBMultiLangInfo): boolean {
    const animeKeywords = ['anime', 'أنمي', 'انمي', 'animation'];
    return tmdbInfo.allTitles.some((t) =>
      animeKeywords.some((k) => t.toLowerCase().includes(k))
    );
  }

  private async searchTitles(
    titles: string[],
    type: string,
    season?: number,
    episode?: number,
    year?: number,
    isAnime?: boolean
  ): Promise<Stream[]> {
    const searchType = isAnime ? 'anime' : type;

    for (const title of titles) {
      const results = await fetchJSON<CinemanaSearchResult[]>(
        `${CINEMANA_API}AdvancedSearch?videoTitle=${encodeURIComponent(title)}&type=${searchType}`
      );

      if (!results?.length) {
        if (isAnime && searchType === 'anime') {
          const fallback = await fetchJSON<CinemanaSearchResult[]>(
            `${CINEMANA_API}AdvancedSearch?videoTitle=${encodeURIComponent(title)}&type=${type}`
          );
          if (fallback?.length) {
            return this.processResults(fallback, title, type, season, episode, year);
          }
        }
        continue;
      }

      return this.processResults(results, title, type, season, episode, year);
    }
    return [];
  }

  private async processResults(
    results: CinemanaSearchResult[],
    searchTitle: string,
    type: string,
    season?: number,
    episode?: number,
    year?: number
  ): Promise<Stream[]> {
    let candidates = results;

    if (year) {
      const yearFiltered = candidates.filter(
        (r) => r.year && parseInt(r.year, 10) === year
      );
      if (yearFiltered.length > 0) candidates = yearFiltered;
    }

    const ranked = candidates
      .map((r) => ({
        result: r,
        score: Math.max(
          similarity(searchTitle, r.en_title ?? ''),
          similarity(searchTitle, r.ar_title ?? ''),
          similarity(searchTitle, r.title ?? '')
        ),
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0]?.result;
    if (!best) return [];

    const nb = best.nb;
    if (type === 'series' && season && episode) {
      return this.getTVFiles(nb, season, episode);
    }
    return this.getFiles(nb);
  }

  private async getTVFiles(
    showNb: string,
    sNum: number,
    eNum: number
  ): Promise<Stream[]> {
    try {
      const seasons = await fetchJSON<CinemanaSeason[]>(
        `${CINEMANA_API}videoSeason/id/${showNb}`
      );
      if (!seasons?.length) return this.getFiles(showNb);

      let seasonData: CinemanaSeason | null = null;
      for (let i = 0; i < seasons.length; i++) {
        const s = seasons[i];
        const sn =
          parseInt(s.season ?? '', 10) ||
          parseInt(s.seasonNumber ?? '', 10) ||
          i + 1;
        if (sn === sNum) {
          seasonData = s;
          break;
        }
      }
      if (!seasonData && seasons.length >= sNum) seasonData = seasons[sNum - 1];
      if (!seasonData) return [];

      const episodes = seasonData.episodes ?? [];
      if (episodes.length === 0) return this.getFiles(showNb);

      let epNb: string | null = null;
      for (let j = 0; j < episodes.length; j++) {
        const ep = episodes[j];
        const en =
          parseInt(ep.episodeNummer ?? '', 10) ||
          parseInt(ep.episodeNumber ?? '', 10) ||
          j + 1;
        if (en === eNum) {
          epNb = ep.nb;
          break;
        }
      }
      if (!epNb && episodes.length >= eNum) epNb = episodes[eNum - 1].nb;
      if (!epNb) return [];

      return this.getFiles(epNb);
    } catch {
      return this.getFiles(showNb);
    }
  }

  private async getFiles(nb: string): Promise<Stream[]> {
    const files = await fetchJSON<CinemanaFile[]>(
      `${CINEMANA_API}transcoddedFiles/id/${nb}`
    );

    const streams: Stream[] = [];
    const seen = new Set<string>();

    for (const f of files) {
      const url = f.videoUrl || f.url || f.transcoddedFile || '';
      let q: QualityLabel;
      const rawQ = f.resolution || f.quality || 'HD';
      if (typeof rawQ === 'number') {
        q = `${rawQ}p` as QualityLabel;
      } else {
        q = rawQ.replace(/\s/g, '') as QualityLabel;
      }

      if (url && !seen.has(url)) {
        seen.add(url);
        streams.push({
          name: this.name,
          title: `${this.name} ${q}`,
          url,
          quality: q,
          format: 'mp4',
        });
      }
    }

    return sortByQuality(streams);
  }
}
