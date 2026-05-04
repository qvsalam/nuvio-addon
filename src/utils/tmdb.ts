import type { MediaType, TMDBInfo, TMDBMultiLangInfo } from '../types/index.js';
import { fetchJSON } from './fetch.js';
import { searchCache } from './cache.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';

function getTmdbApiKey(): string {
  const key = (globalThis as Record<string, unknown>).TMDB_API_KEY as string | undefined;
  if (!key) throw new Error('TMDB_API_KEY not provided. Inject it from the Nuvio app.');
  return key;
}

export async function fetchTMDBInfo(
  tmdbId: string,
  mediaType: MediaType
): Promise<TMDBMultiLangInfo> {
  const cacheKey = `tmdb:${mediaType}:${tmdbId}`;
  const cached = searchCache.get<TMDBMultiLangInfo>(cacheKey);
  if (cached) return cached;

  const path = `/${mediaType === 'movie' ? 'movie' : 'tv'}/${tmdbId}`;
  const apiKey = getTmdbApiKey();

  const [enInfo, arInfo] = await Promise.all([
    fetchJSON<TMDBInfo>(`${TMDB_BASE}${path}?api_key=${apiKey}&language=en`),
    fetchJSON<TMDBInfo>(`${TMDB_BASE}${path}?api_key=${apiKey}&language=ar`),
  ]);

  const enTitles = collectTitles(enInfo);
  const arTitles = collectTitles(arInfo);
  const allTitles = [...new Set([...enTitles, ...arTitles])];

  const year = extractYear(enInfo);

  const result: TMDBMultiLangInfo = {
    enTitles,
    arTitles,
    allTitles,
    imdbId: enInfo.imdb_id,
    year,
  };

  searchCache.set(cacheKey, result);
  return result;
}

export async function fetchIMDBFallback(
  imdbId: string,
  mediaType: MediaType
): Promise<TMDBMultiLangInfo | null> {
  const apiKey = getTmdbApiKey();
  const url = `${TMDB_BASE}/find/${imdbId}?api_key=${apiKey}&external_source=imdb_id`;

  try {
    const data = await fetchJSON<{
      movie_results?: TMDBInfo[];
      tv_results?: TMDBInfo[];
    }>(url);

    const results =
      mediaType === 'movie' ? data.movie_results : data.tv_results;
    if (!results || results.length === 0) return null;

    const info = results[0];
    const titles = collectTitles(info);

    return {
      enTitles: titles,
      arTitles: [],
      allTitles: titles,
      imdbId,
      year: extractYear(info),
    };
  } catch {
    return null;
  }
}

function collectTitles(info: TMDBInfo): string[] {
  const titles: string[] = [];
  if (info.title) titles.push(info.title);
  if (info.original_title && !titles.includes(info.original_title))
    titles.push(info.original_title);
  if (info.name) titles.push(info.name);
  if (info.original_name && !titles.includes(info.original_name))
    titles.push(info.original_name);
  return titles;
}

function extractYear(info: TMDBInfo): number | undefined {
  const dateStr = info.release_date || info.first_air_date;
  if (!dateStr) return undefined;
  const y = parseInt(dateStr.substring(0, 4), 10);
  return isNaN(y) ? undefined : y;
}
