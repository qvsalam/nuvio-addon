import { describe, it, expect } from '@jest/globals';
import {
  detectHardsub,
  detectSubtitleFormat,
  detectSubtitleLanguage,
  extractSubtitlesFromHTML,
} from '../src/subtitles/index.js';

describe('detectHardsub', () => {
  it('should detect hardsub URLs', () => {
    expect(detectHardsub('movie-hardsub.mp4')).toBe(true);
    expect(detectHardsub('movie-embedded.mp4')).toBe(true);
    expect(detectHardsub('movie-burned.mp4')).toBe(true);
  });

  it('should not flag normal URLs', () => {
    expect(detectHardsub('movie-720.mp4')).toBe(false);
    expect(detectHardsub('https://cdn.example.com/video.mp4')).toBe(false);
  });
});

describe('detectSubtitleFormat', () => {
  it('should detect VTT', () => {
    expect(detectSubtitleFormat('subs.vtt')).toBe('vtt');
  });

  it('should detect ASS', () => {
    expect(detectSubtitleFormat('subs.ass')).toBe('ass');
  });

  it('should default to SRT', () => {
    expect(detectSubtitleFormat('subs.srt')).toBe('srt');
    expect(detectSubtitleFormat('unknown')).toBe('srt');
  });
});

describe('detectSubtitleLanguage', () => {
  it('should detect Arabic from URL', () => {
    expect(detectSubtitleLanguage('/subs/ar/movie.srt')).toBe('ar');
    expect(detectSubtitleLanguage('movie-arabic.srt')).toBe('ar');
  });

  it('should detect Arabic from content', () => {
    expect(detectSubtitleLanguage('subs.srt', 'مرحبا')).toBe('ar');
  });

  it('should default to English', () => {
    expect(detectSubtitleLanguage('subs.srt')).toBe('en');
  });
});

describe('extractSubtitlesFromHTML', () => {
  it('should extract subtitle URLs from HTML', () => {
    const html = `
      <track src="https://cdn.example.com/subs-en.vtt" kind="subtitles" srclang="en">
      <track src="https://cdn.example.com/subs-ar.srt" kind="subtitles" srclang="ar">
    `;
    const subs = extractSubtitlesFromHTML(html);
    expect(subs).toHaveLength(2);
    expect(subs[0].format).toBe('vtt');
    expect(subs[1].format).toBe('srt');
  });

  it('should handle HTML with no subtitles', () => {
    expect(extractSubtitlesFromHTML('<div>no subs</div>')).toHaveLength(0);
  });

  it('should deduplicate URLs', () => {
    const html = `
      "https://cdn.example.com/subs.vtt"
      "https://cdn.example.com/subs.vtt"
    `;
    const subs = extractSubtitlesFromHTML(html);
    expect(subs).toHaveLength(1);
  });
});
