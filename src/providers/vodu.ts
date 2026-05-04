import type {
  Stream,
  StreamRequest,
  TMDBMultiLangInfo,
  QualityLabel,
  ContentLanguage,
  StreamFormat,
  MediaType,
  Subtitle,
} from '../types/index.js';
import { BaseProvider } from './base-provider.js';
import { fetchText } from '../utils/fetch.js';
import { parseQuality, sortByQuality } from '../utils/quality.js';
import { similarity } from '../utils/similarity.js';
import { getRandomUserAgent } from '../utils/fetch.js';
import { extractSubtitlesFromHTML, detectHardsub } from '../subtitles/index.js';

const VODU_BASE = 'https://movie.vodu.me';

export class VoduProvider extends BaseProvider {
  readonly id = 'vodu-iraq';
  readonly name = 'VODU';
  readonly supportedTypes: MediaType[] = ['movie', 'tv'];
  readonly formats: StreamFormat[] = ['mp4', 'm3u8'];
  readonly contentLanguage: ContentLanguage[] = ['ar', 'en'];

  async scrape(
    tmdbInfo: TMDBMultiLangInfo,
    request: StreamRequest
  ): Promise<Stream[]> {
    const { allTitles, year } = tmdbInfo;
    const streams = await this.searchTitles(
      allTitles,
      request.mediaType,
      request.season,
      request.episode,
      year
    );
    return streams;
  }

  private async searchTitles(
    titles: string[],
    mediaType: MediaType,
    season?: number,
    episode?: number,
    year?: number
  ): Promise<Stream[]> {
    for (const title of titles) {
      const html = await fetchText(
        `${VODU_BASE}/index.php?do=list&title=${encodeURIComponent(title)}`,
        { headers: { 'User-Agent': getRandomUserAgent() } }
      );

      const links = this.extractLinks(html);
      if (links.length === 0) continue;

      const filteredLinks = year
        ? links.filter((l) => !year || l.includes(String(year)) || links.length <= 3)
        : links;

      const streams = await this.tryLinks(
        filteredLinks.length > 0 ? filteredLinks : links,
        mediaType,
        season,
        episode,
        title
      );
      if (streams.length > 0) return streams;
    }
    return [];
  }

  private extractLinks(html: string): string[] {
    const links: string[] = [];
    const re = /href=["']([^"']*do=view[^"']*)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      let href = m[1].replace(/&amp;/g, '&');
      if (!href.startsWith('http')) {
        href = `${VODU_BASE}/${href.replace(/^\//, '')}`;
      }
      if (!links.includes(href)) links.push(href);
    }
    return links;
  }

  private async tryLinks(
    links: string[],
    mediaType: MediaType,
    season?: number,
    episode?: number,
    _searchTitle?: string
  ): Promise<Stream[]> {
    for (const link of links) {
      try {
        const html = await fetchText(link, {
          headers: { 'User-Agent': getRandomUserAgent() },
        });

        const allUrls = this.extractVideoUrls(html);

        let streams: Stream[];
        if (mediaType === 'tv' && season && episode) {
          streams = this.filterEpisode(allUrls, season, episode, html);
        } else {
          streams = this.filterMovieUrls(allUrls, html);
        }

        if (streams.length > 0) {
          const subs = extractSubtitlesFromHTML(html);
          if (subs.length > 0) {
            for (const s of streams) {
              s.subtitles = subs;
            }
          }
          for (const s of streams) {
            if (detectHardsub(s.url)) {
              const hardSub: Subtitle = {
                language: 'ar',
                format: 'srt',
                url: s.url,
                isHardsub: true,
              };
              s.subtitles = [...(s.subtitles ?? []), hardSub];
            }
          }
          return streams;
        }
      } catch {
        continue;
      }
    }
    return [];
  }

  private filterEpisode(
    allUrls: string[],
    sNum: number,
    eNum: number,
    html: string
  ): Stream[] {
    const sStr = sNum < 10 ? `0${sNum}` : `${sNum}`;
    const eStr = eNum < 10 ? `0${eNum}` : `${eNum}`;
    const pats = [
      `S${sStr}E${eStr}`,
      `s${sStr}e${eStr}`,
      `S${sNum}E${eNum}`,
      `s${sNum}e${eNum}`,
    ];

    const streams: Stream[] = [];
    const seen = new Set<string>();

    for (const url of allUrls) {
      if (this.isSkip(url) || seen.has(url)) continue;
      const upper = url.toUpperCase();
      if (pats.some((p) => upper.includes(p.toUpperCase()))) {
        seen.add(url);
        streams.push(this.makeStream(url));
      }
    }

    if (streams.length === 0) {
      const epPats = [
        `_E${eStr}_`, `_E${eStr}-`, `_E${eStr}.`,
        `_E${eNum}_`, `_E${eNum}-`, `_E${eNum}.`,
        `E${eStr}_`, `E${eStr}-`, `_${eStr}_`,
      ];
      for (const url of allUrls) {
        if (this.isSkip(url) || seen.has(url)) continue;
        const upper = url.toUpperCase();
        if (epPats.some((p) => upper.includes(p.toUpperCase()))) {
          seen.add(url);
          streams.push(this.makeStream(url));
        }
      }
    }

    this.addVariants(streams, html);
    return sortByQuality(streams);
  }

  private filterMovieUrls(allUrls: string[], html: string): Stream[] {
    const streams: Stream[] = [];
    const seen = new Set<string>();

    for (const url of allUrls) {
      if (this.isSkip(url) || seen.has(url)) continue;
      seen.add(url);
      streams.push(this.makeStream(url));
    }

    this.addVariants(streams, html);
    return sortByQuality(streams);
  }

  private extractVideoUrls(html: string): string[] {
    const urls: string[] = [];
    const patterns = [
      /["'](https?:\/\/[^"'\s]*:8888\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi,
      /<(?:source|video)[^>]*src=["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/gi,
      /(?:file|src|url|videoUrl|source)\s*[:=]\s*["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi,
      /"(https?:\\\/\\\/[^"]*\.(?:mp4|m3u8)[^"]*)"/g,
      /["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)(?:\?[^"'\s]*)?)/gi,
    ];

    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        const u = m[1].replace(/\\\//g, '/').replace(/&amp;/g, '&');
        if (!urls.includes(u)) urls.push(u);
      }
    }
    return urls;
  }

  private isSkip(url: string): boolean {
    return (
      /-t\.(mp4|m3u8)/i.test(url) ||
      /_t\.(mp4|m3u8)/i.test(url) ||
      /thumb|trailer|preview|poster/i.test(url)
    );
  }

  private makeStream(url: string): Stream {
    const q = parseQuality(url);
    return {
      name: this.name,
      title: `${this.name} ${q}`,
      url,
      quality: q,
      format: /\.m3u8/i.test(url) ? 'm3u8' : 'mp4',
    };
  }

  private addVariants(streams: Stream[], html: string): void {
    let has720 = false;
    let baseUrl: string | null = null;
    for (const s of streams) {
      if (s.quality === '720p') has720 = true;
      if (!baseUrl && /-(?:360|1080)\./i.test(s.url)) baseUrl = s.url;
    }
    if (!has720 && baseUrl && html.includes('720')) {
      const u = baseUrl.replace(/-(?:360|1080)\./i, '-720.');
      streams.push({
        name: this.name,
        title: `${this.name} 720p`,
        url: u,
        quality: '720p' as QualityLabel,
        format: 'mp4',
      });
    }
  }
}

export function matchesByYear(
  _candidates: Array<{ title: string; year?: number }>,
  targetYear?: number
): Array<{ title: string; year?: number }> {
  if (!targetYear) return _candidates;
  const exact = _candidates.filter((c) => c.year === targetYear);
  return exact.length > 0 ? exact : _candidates;
}

export function rankBySimilarity(
  query: string,
  candidates: string[]
): Array<{ title: string; score: number }> {
  return candidates
    .map((t) => ({ title: t, score: similarity(query, t) }))
    .sort((a, b) => b.score - a.score);
}
