import type { CacheEntry } from '../types/index.js';

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class Cache {
  private store = new Map<string, CacheEntry<unknown>>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    this.store.set(key, {
      data,
      expiry: Date.now() + (ttlMs ?? this.ttlMs),
    });
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    this.pruneExpired();
    return this.store.size;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiry) this.store.delete(key);
    }
  }

  buildKey(parts: (string | number | undefined)[]): string {
    return parts.filter((p) => p !== undefined).join(':');
  }
}

export const searchCache = new Cache();
