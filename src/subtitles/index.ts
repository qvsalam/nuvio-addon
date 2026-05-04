import type { Subtitle, ContentLanguage, SubtitleFormat } from '../types/index.js';
import { fetchJSON, fetchText } from '../utils/fetch.js';

const OPENSUBTITLES_API = 'https://api.opensubtitles.com/api/v1';
const SUBSCENE_SEARCH = 'https://subscene.com/subtitles/searchbytitle';

export function detectHardsub(url: string): boolean {
  const hardsubPatterns = [
    /hardsub/i,
    /embedded/i,
    /burned/i,
    /hardcoded/i,
    /\.ar\./i,
    /\.en\./i,
    /_ar_/i,
    /_en_/i,
    /\barabic\b/i,
  ];
  return hardsubPatterns.some((p) => p.test(url));
}

export function detectSubtitleFormat(url: string): SubtitleFormat {
  if (/\.vtt/i.test(url)) return 'vtt';
  if (/\.ass/i.test(url)) return 'ass';
  return 'srt';
}

export function detectSubtitleLanguage(url: string, text?: string): ContentLanguage {
  if (/[\u0600-\u06FF]/.test(text ?? '')) return 'ar';
  if (/[_.\-/]ar[_.\-/]/i.test(url) || /arabic/i.test(url)) return 'ar';
  return 'en';
}

export function extractSubtitlesFromHTML(html: string): Subtitle[] {
  const subtitles: Subtitle[] = [];
  const seen = new Set<string>();

  const patterns = [
    /["'](https?:\/\/[^"'\s]+\.(?:vtt|srt|ass)[^"'\s]*)/gi,
    /src=["'](https?:\/\/[^"']+\.(?:vtt|srt|ass)[^"']*)/gi,
    /<track[^>]*src=["']([^"']+)["'][^>]*/gi,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const url = m[1].replace(/\\\//g, '/').replace(/&amp;/g, '&');
      if (seen.has(url)) continue;
      seen.add(url);

      const format = detectSubtitleFormat(url);
      const language = detectSubtitleLanguage(url);

      subtitles.push({
        language,
        format,
        url,
        isHardsub: false,
      });
    }
  }

  return subtitles;
}

export async function searchOpenSubtitles(
  imdbId: string,
  _season?: number,
  _episode?: number
): Promise<Subtitle[]> {
  try {
    const params = new URLSearchParams({ imdb_id: imdbId });
    if (_season) params.set('season_number', String(_season));
    if (_episode) params.set('episode_number', String(_episode));
    params.set('languages', 'ar,en');

    const data = await fetchJSON<{
      data?: Array<{
        attributes?: {
          language?: string;
          files?: Array<{ file_id?: number }>;
          format?: string;
        };
      }>;
    }>(`${OPENSUBTITLES_API}/subtitles?${params.toString()}`, {
      headers: { 'Api-Key': getOpenSubtitlesKey() },
    });

    if (!data.data) return [];

    return data.data
      .filter((item) => item.attributes?.files?.length)
      .map((item) => {
        const attr = item.attributes!;
        const lang = attr.language === 'ar' ? 'ar' : 'en';
        const format = (attr.format as SubtitleFormat) || 'srt';
        const fileId = attr.files![0].file_id;

        return {
          language: lang as ContentLanguage,
          format,
          url: `${OPENSUBTITLES_API}/download/${fileId}`,
          isHardsub: false,
        };
      });
  } catch {
    return [];
  }
}

export async function searchSubscene(title: string): Promise<Subtitle[]> {
  try {
    const html = await fetchText(
      `${SUBSCENE_SEARCH}?query=${encodeURIComponent(title)}`
    );

    const subtitles: Subtitle[] = [];
    const re = /href="(\/subtitles\/[^"]+\/(arabic|english)[^"]*)"/gi;
    let m: RegExpExecArray | null;

    while ((m = re.exec(html)) !== null) {
      const lang: ContentLanguage = m[2].toLowerCase() === 'arabic' ? 'ar' : 'en';
      subtitles.push({
        language: lang,
        format: 'srt',
        url: `https://subscene.com${m[1]}`,
        isHardsub: false,
      });
    }

    return subtitles;
  } catch {
    return [];
  }
}

function getOpenSubtitlesKey(): string {
  return (
    ((globalThis as Record<string, unknown>).OPENSUBTITLES_API_KEY as string) ?? ''
  );
}
