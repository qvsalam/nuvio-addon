import { describe, it, expect } from '@jest/globals';
import { parseQuality, sortByQuality, averageQuality, qualityToNumeric } from '../src/utils/quality.js';
import type { QualityLabel } from '../src/types/index.js';

describe('parseQuality', () => {
  it('should detect 1080p', () => {
    expect(parseQuality('movie-1080.mp4')).toBe('1080p');
  });

  it('should detect 720p', () => {
    expect(parseQuality('movie-720.mp4')).toBe('720p');
  });

  it('should detect 480p', () => {
    expect(parseQuality('movie-480.mp4')).toBe('480p');
  });

  it('should detect 360p', () => {
    expect(parseQuality('movie-360.mp4')).toBe('360p');
  });

  it('should detect HLS', () => {
    expect(parseQuality('stream.m3u8')).toBe('HLS');
  });

  it('should default to HD', () => {
    expect(parseQuality('movie.mp4')).toBe('HD');
  });

  it('should detect 4K/2160p', () => {
    expect(parseQuality('movie-2160.mp4')).toBe('2160p');
    expect(parseQuality('movie-4k.mp4')).toBe('2160p');
  });
});

describe('sortByQuality', () => {
  it('should sort by quality descending', () => {
    const items = [
      { quality: '360p' as QualityLabel },
      { quality: '1080p' as QualityLabel },
      { quality: '720p' as QualityLabel },
    ];
    const sorted = sortByQuality(items);
    expect(sorted.map((i) => i.quality)).toEqual(['1080p', '720p', '360p']);
  });
});

describe('averageQuality', () => {
  it('should compute average quality label', () => {
    const avg = averageQuality(['1080p', '720p']);
    expect(['720p', '1080p']).toContain(avg);
    expect(averageQuality(['1080p', '1080p'])).toBe('1080p');
  });

  it('should return Unknown for empty array', () => {
    expect(averageQuality([])).toBe('Unknown');
  });
});

describe('qualityToNumeric', () => {
  it('should map quality labels to numbers', () => {
    expect(qualityToNumeric('1080p')).toBe(1080);
    expect(qualityToNumeric('720p')).toBe(720);
    expect(qualityToNumeric('Unknown')).toBe(0);
  });
});
