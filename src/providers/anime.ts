import type {
  Stream,
  StreamRequest,
  TMDBMultiLangInfo,
  ContentLanguage,
  StreamFormat,
  MediaType,
  QualityLabel,
} from '../types/index.js';
import { BaseProvider } from './base-provider.js';
import { fetchJSON, fetchText } from '../utils/fetch.js';
import { sortByQuality } from '../utils/quality.js';
import { similarity } from '../utils/similarity.js';

const ANILIST_API = 'https://graphql.anilist.co';
const MAL_API = 'https://api.jikan.moe/v4';
const GOGO_BASE = 'https://gogoanime3.co';

interface AniListMedia {
  title?: {
    romaji?: string;
    english?: string;
    native?: string;
  };
  idMal?: number;
  episodes?: number;
  format?: string;
}

interface AniListResponse {
  data?: {
    Media?: AniListMedia;
  };
}

interface MALAnime {
  mal_id: number;
  title?: string;
  title_english?: string;
  title_japanese?: string;
}

interface MALSearchResponse {
  data?: MALAnime[];
}

export class AnimeProvider extends BaseProvider {
  readonly id = 'anime-provider';
  readonly name = 'Anime';
  readonly supportedTypes: MediaType[] = ['tv', 'movie'];
  readonly formats: StreamFormat[] = ['mp4', 'm3u8'];
  readonly contentLanguage: ContentLanguage[] = ['ar', 'en'];

  async scrape(
    tmdbInfo: TMDBMultiLangInfo,
    request: StreamRequest
  ): Promise<Stream[]> {
    const titles = [...tmdbInfo.allTitles];

    if (request.anilistId) {
      const anilistTitles = await this.fetchAniListTitles(request.anilistId);
      titles.push(...anilistTitles.filter((t) => !titles.includes(t)));
    }

    if (request.malId) {
      const malTitles = await this.fetchMALTitles(request.malId);
      titles.push(...malTitles.filter((t) => !titles.includes(t)));
    }

    if (!request.anilistId && !request.malId && titles.length > 0) {
      const malResults = await this.searchMAL(titles[0]);
      if (malResults.length > 0) {
        titles.push(...malResults.filter((t) => !titles.includes(t)));
      }
    }

    return this.searchGogoAnime(titles, request.episode);
  }

  private async fetchAniListTitles(anilistId: string): Promise<string[]> {
    try {
      const query = `
        query ($id: Int) {
          Media(id: $id, type: ANIME) {
            title { romaji english native }
            idMal
          }
        }
      `;
      const data = await fetchJSON<AniListResponse>(ANILIST_API, {
        headers: { 'Content-Type': 'application/json' },
      });

      // AniList uses POST but we simplify by using the REST-like approach
      void data;
      const resp = await fetch(ANILIST_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: { id: parseInt(anilistId, 10) },
        }),
      });
      const result = (await resp.json()) as AniListResponse;
      const media = result.data?.Media;
      if (!media?.title) return [];

      const titles: string[] = [];
      if (media.title.english) titles.push(media.title.english);
      if (media.title.romaji) titles.push(media.title.romaji);
      if (media.title.native) titles.push(media.title.native);
      return titles;
    } catch {
      return [];
    }
  }

  private async fetchMALTitles(malId: string): Promise<string[]> {
    try {
      const data = await fetchJSON<{ data?: MALAnime }>(
        `${MAL_API}/anime/${malId}`
      );
      if (!data.data) return [];

      const titles: string[] = [];
      if (data.data.title) titles.push(data.data.title);
      if (data.data.title_english) titles.push(data.data.title_english);
      if (data.data.title_japanese) titles.push(data.data.title_japanese);
      return titles;
    } catch {
      return [];
    }
  }

  private async searchMAL(title: string): Promise<string[]> {
    try {
      const data = await fetchJSON<MALSearchResponse>(
        `${MAL_API}/anime?q=${encodeURIComponent(title)}&limit=5`
      );
      if (!data.data?.length) return [];

      const ranked = data.data
        .map((a) => ({
          anime: a,
          score: similarity(title, a.title ?? ''),
        }))
        .sort((a, b) => b.score - a.score);

      const best = ranked[0]?.anime;
      if (!best) return [];

      const titles: string[] = [];
      if (best.title) titles.push(best.title);
      if (best.title_english) titles.push(best.title_english);
      return titles;
    } catch {
      return [];
    }
  }

  private async searchGogoAnime(
    titles: string[],
    episode?: number
  ): Promise<Stream[]> {
    for (const title of titles) {
      try {
        const slug = title
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-');

        const epNum = episode ?? 1;
        const epUrl = `${GOGO_BASE}/${slug}-episode-${epNum}`;

        const html = await fetchText(epUrl);
        const streams = this.extractStreams(html);
        if (streams.length > 0) return streams;

        const searchHtml = await fetchText(
          `${GOGO_BASE}/search.html?keyword=${encodeURIComponent(title)}`
        );
        const links = this.extractAnimeLinks(searchHtml);

        for (const link of links) {
          const epLink = `${GOGO_BASE}${link}-episode-${epNum}`;
          try {
            const epHtml = await fetchText(epLink);
            const epStreams = this.extractStreams(epHtml);
            if (epStreams.length > 0) return epStreams;
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }
    return [];
  }

  private extractStreams(html: string): Stream[] {
    const streams: Stream[] = [];
    const seen = new Set<string>();

    const patterns = [
      /["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi,
      /data-video=["'](https?:\/\/[^"']+)/gi,
      /file:\s*["'](https?:\/\/[^"']+)/gi,
    ];

    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        const url = m[1].replace(/\\\//g, '/');
        if (seen.has(url)) continue;
        seen.add(url);

        const q: QualityLabel = /1080/i.test(url)
          ? '1080p'
          : /720/i.test(url)
            ? '720p'
            : /480/i.test(url)
              ? '480p'
              : /360/i.test(url)
                ? '360p'
                : 'HD';

        streams.push({
          name: this.name,
          title: `${this.name} ${q}`,
          url,
          quality: q,
          format: /\.m3u8/i.test(url) ? 'm3u8' : 'mp4',
        });
      }
    }

    return sortByQuality(streams);
  }

  private extractAnimeLinks(html: string): string[] {
    const links: string[] = [];
    const re = /href="\/category\/([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      links.push(`/${m[1]}`);
    }
    return links;
  }
}
