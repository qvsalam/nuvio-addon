import { describe, it, expect } from '@jest/globals';
import { RateLimiter } from '../src/utils/rate-limiter.js';

describe('RateLimiter', () => {
  it('should allow requests within limit', async () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.remaining).toBe(3);
  });

  it('should track remaining capacity', () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });
    expect(limiter.remaining).toBe(3);
  });

  it('should throttle when limit exceeded', async () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 100 });
    await limiter.acquire();
    await limiter.acquire();

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(50);
  }, 10000);
});
