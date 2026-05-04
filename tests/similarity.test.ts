import { describe, it, expect } from '@jest/globals';
import { similarity, normalize, bestMatch } from '../src/utils/similarity.js';

describe('similarity', () => {
  it('should return 1 for identical strings', () => {
    expect(similarity('hello', 'hello')).toBe(1);
  });

  it('should return 0 for empty strings', () => {
    expect(similarity('', 'hello')).toBe(0);
    expect(similarity('hello', '')).toBe(0);
  });

  it('should be case-insensitive', () => {
    expect(similarity('Hello World', 'hello world')).toBe(1);
  });

  it('should handle similar titles', () => {
    const score = similarity('The Dark Knight', 'The Dark Knight Rises');
    expect(score).toBeGreaterThan(0.7);
  });

  it('should handle Arabic titles', () => {
    const score = similarity('فيلم جديد', 'فيلم جديد');
    expect(score).toBe(1);
  });

  it('should penalize very different strings', () => {
    const score = similarity('abc', 'xyz');
    expect(score).toBeLessThan(0.5);
  });
});

describe('normalize', () => {
  it('should lowercase and trim', () => {
    expect(normalize('  Hello World  ')).toBe('hello world');
  });

  it('should remove special characters', () => {
    expect(normalize('Hello: World!')).toBe('hello world');
  });

  it('should preserve Arabic characters', () => {
    const result = normalize('فيلم عربي');
    expect(result).toContain('فيلم');
    expect(result).toContain('عربي');
  });
});

describe('bestMatch', () => {
  it('should find the best matching title', () => {
    const result = bestMatch('The Dark Knight', [
      'Batman Begins',
      'The Dark Knight',
      'The Dark Knight Rises',
    ]);
    expect(result?.title).toBe('The Dark Knight');
    expect(result?.score).toBe(1);
  });

  it('should return null for empty candidates', () => {
    expect(bestMatch('test', [])).toBeNull();
  });

  it('should pick closest match', () => {
    const result = bestMatch('Spider Man', [
      'Iron Man',
      'Spider-Man: Homecoming',
      'Ant Man',
    ]);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);
  });
});
