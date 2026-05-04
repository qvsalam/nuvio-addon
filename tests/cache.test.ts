import { describe, it, expect, beforeEach } from '@jest/globals';
import { Cache } from '../src/utils/cache.js';

describe('Cache', () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache(1000);
  });

  it('should store and retrieve values', () => {
    cache.set('key1', { data: 'test' });
    expect(cache.get('key1')).toEqual({ data: 'test' });
  });

  it('should return null for missing keys', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('should expire entries after TTL', async () => {
    const shortCache = new Cache(50);
    shortCache.set('key1', 'value');
    expect(shortCache.get('key1')).toBe('value');

    await new Promise((r) => setTimeout(r, 100));
    expect(shortCache.get('key1')).toBeNull();
  });

  it('should delete entries', () => {
    cache.set('key1', 'value');
    expect(cache.delete('key1')).toBe(true);
    expect(cache.get('key1')).toBeNull();
  });

  it('should clear all entries', () => {
    cache.set('key1', 'v1');
    cache.set('key2', 'v2');
    cache.clear();
    expect(cache.get('key1')).toBeNull();
    expect(cache.get('key2')).toBeNull();
  });

  it('should report correct size', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size()).toBe(2);
  });

  it('should check existence with has()', () => {
    cache.set('exists', true);
    expect(cache.has('exists')).toBe(true);
    expect(cache.has('nope')).toBe(false);
  });

  it('should build cache keys', () => {
    expect(cache.buildKey(['search', '550', 'movie', undefined])).toBe(
      'search:550:movie'
    );
    expect(cache.buildKey(['provider', 'vodu', '550', 'movie', 1, 2])).toBe(
      'provider:vodu:550:movie:1:2'
    );
  });

  it('should allow custom TTL per entry', async () => {
    cache.set('short', 'value', 50);
    cache.set('long', 'value', 5000);

    await new Promise((r) => setTimeout(r, 100));
    expect(cache.get('short')).toBeNull();
    expect(cache.get('long')).toBe('value');
  });
});
