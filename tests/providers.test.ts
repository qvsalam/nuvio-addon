import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { VoduProvider } from '../src/providers/vodu.js';
import { CinemaBoxProvider } from '../src/providers/cinemabox.js';
import { CinemanaProvider } from '../src/providers/cinemana.js';
import { AnimeProvider } from '../src/providers/anime.js';
import type { TMDBMultiLangInfo, StreamRequest } from '../src/types/index.js';

const mockTmdbInfo: TMDBMultiLangInfo = {
  enTitles: ['The Matrix'],
  arTitles: ['ماتريكس'],
  allTitles: ['The Matrix', 'ماتريكس'],
  imdbId: 'tt0133093',
  year: 1999,
};

const originalFetch = globalThis.fetch;

function mockFetchWith(handler: (url: string) => Promise<{ text?: () => Promise<string>; json?: () => Promise<unknown>; ok: boolean }>): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    return handler(url);
  }) as typeof fetch;
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).TMDB_API_KEY = 'test-key';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('VoduProvider', () => {
  const provider = new VoduProvider();

  it('should have correct metadata', () => {
    expect(provider.id).toBe('vodu-iraq');
    expect(provider.name).toBe('VODU');
    expect(provider.supportedTypes).toContain('movie');
    expect(provider.supportedTypes).toContain('tv');
    expect(provider.formats).toContain('mp4');
    expect(provider.formats).toContain('m3u8');
  });

  it('should return empty streams when search yields no results', async () => {
    mockFetchWith(async () => ({
      text: () => Promise.resolve('<html>no results</html>'),
      json: () => Promise.resolve({}),
      ok: true,
    }));

    const streams = await provider.scrape(mockTmdbInfo, {
      tmdbId: '603',
      mediaType: 'movie',
    });
    expect(streams).toEqual([]);
  });

  it('should extract streams from VODU page with video URLs', async () => {
    let callCount = 0;
    mockFetchWith(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          text: () =>
            Promise.resolve(
              '<a href="https://movie.vodu.me/index.php?do=view&id=123">Link</a>'
            ),
          ok: true,
        };
      }
      return {
        text: () =>
          Promise.resolve(
            '<video src="https://cdn.vodu.me:8888/movies/matrix-720.mp4"></video>'
          ),
        ok: true,
      };
    });

    const streams = await provider.scrape(mockTmdbInfo, {
      tmdbId: '603',
      mediaType: 'movie',
    });
    expect(streams.length).toBeGreaterThanOrEqual(1);
    if (streams.length > 0) {
      expect(streams[0].name).toBe('VODU');
      expect(streams[0].url).toContain('mp4');
    }
  });

  it('should handle TV episodes with S01E01 pattern', async () => {
    let callCount = 0;
    mockFetchWith(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          text: () =>
            Promise.resolve(
              '<a href="https://movie.vodu.me/index.php?do=view&id=456">Link</a>'
            ),
          ok: true,
        };
      }
      return {
        text: () =>
          Promise.resolve(
            '"https://cdn.vodu.me:8888/series/show-S01E03-720.mp4"'
          ),
        ok: true,
      };
    });

    const streams = await provider.scrape(mockTmdbInfo, {
      tmdbId: '100',
      mediaType: 'tv',
      season: 1,
      episode: 3,
    } as StreamRequest);
    expect(streams.length).toBeGreaterThanOrEqual(1);
  });
});

describe('CinemaBoxProvider', () => {
  const provider = new CinemaBoxProvider();

  it('should have correct metadata', () => {
    expect(provider.id).toBe('cinemabox-iraq');
    expect(provider.name).toBe('CinemaBox');
    expect(provider.supportedTypes).toContain('movie');
  });

  it('should return empty streams on no search results', async () => {
    mockFetchWith(async () => ({
      json: () => Promise.resolve({ results: [] }),
      ok: true,
    }));

    const streams = await provider.scrape(mockTmdbInfo, {
      tmdbId: '603',
      mediaType: 'movie',
    });
    expect(streams).toEqual([]);
  });

  it('should extract streams from CinemaBox API', async () => {
    let callCount = 0;
    mockFetchWith(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          json: () =>
            Promise.resolve({
              results: [{ id: '123', type: 'MOVIE', title: 'The Matrix' }],
            }),
          ok: true,
        };
      }
      if (callCount === 2) {
        return {
          json: () =>
            Promise.resolve({ post_info: { episode_id: 'ep1' } }),
          ok: true,
        };
      }
      return {
        json: () =>
          Promise.resolve({
            videos: [
              { url: 'https://cloud1.albox.co/episodes/movie.mp4', quality: '1080p' },
              { url: 'https://cloud1.albox.co/episodes/movie2.mp4', quality: '720p' },
            ],
          }),
        ok: true,
      };
    });

    const streams = await provider.scrape(mockTmdbInfo, {
      tmdbId: '603',
      mediaType: 'movie',
    });
    expect(streams.length).toBe(2);
    expect(streams[0].name).toBe('CinemaBox');
    expect(streams[0].quality).toBe('1080p');
  });
});

describe('CinemanaProvider', () => {
  const provider = new CinemanaProvider();

  it('should have correct metadata', () => {
    expect(provider.id).toBe('cinemana-iraq');
    expect(provider.name).toBe('Cinemana');
  });

  it('should return empty streams on no results', async () => {
    mockFetchWith(async () => ({
      json: () => Promise.resolve([]),
      ok: true,
    }));

    const streams = await provider.scrape(mockTmdbInfo, {
      tmdbId: '603',
      mediaType: 'movie',
    });
    expect(streams).toEqual([]);
  });

  it('should extract streams from Cinemana API', async () => {
    let callCount = 0;
    mockFetchWith(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          json: () =>
            Promise.resolve([
              { nb: '999', en_title: 'The Matrix', year: '1999' },
            ]),
          ok: true,
        };
      }
      return {
        json: () =>
          Promise.resolve([
            { videoUrl: 'https://cdn.cinemana.com/movie-1080.mp4', resolution: '1080p' },
            { videoUrl: 'https://cdn.cinemana.com/movie-720.mp4', resolution: '720p' },
          ]),
        ok: true,
      };
    });

    const streams = await provider.scrape(mockTmdbInfo, {
      tmdbId: '603',
      mediaType: 'movie',
    });
    expect(streams.length).toBe(2);
    expect(streams[0].name).toBe('Cinemana');
  });

  it('should handle TV show with seasons', async () => {
    let callCount = 0;
    mockFetchWith(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          json: () =>
            Promise.resolve([{ nb: '100', en_title: 'Breaking Bad' }]),
          ok: true,
        };
      }
      if (callCount === 2) {
        return {
          json: () =>
            Promise.resolve([
              {
                season: '1',
                episodes: [
                  { nb: '101', episodeNumber: '1' },
                  { nb: '102', episodeNumber: '2' },
                ],
              },
            ]),
          ok: true,
        };
      }
      return {
        json: () =>
          Promise.resolve([
            { videoUrl: 'https://cdn.cinemana.com/ep-720.mp4', resolution: '720p' },
          ]),
        ok: true,
      };
    });

    const streams = await provider.scrape(
      { ...mockTmdbInfo, allTitles: ['Breaking Bad'] },
      { tmdbId: '1396', mediaType: 'tv', season: 1, episode: 2 }
    );
    expect(streams.length).toBe(1);
  });
});

describe('AnimeProvider', () => {
  const provider = new AnimeProvider();

  it('should have correct metadata', () => {
    expect(provider.id).toBe('anime-provider');
    expect(provider.name).toBe('Anime');
    expect(provider.supportedTypes).toContain('tv');
  });

  it('should return empty streams when no anime found', async () => {
    mockFetchWith(async () => ({
      text: () => Promise.resolve('<html>not found</html>'),
      json: () => Promise.resolve({ data: [] }),
      ok: true,
    }));

    const streams = await provider.scrape(
      { ...mockTmdbInfo, allTitles: ['Naruto'] },
      { tmdbId: '999', mediaType: 'tv', anilistId: '20' }
    );
    expect(streams).toEqual([]);
  });
});
