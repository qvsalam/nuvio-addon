import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { AnalyticsLogger } from '../src/analytics/logger.js';
import { generateWeeklyReport } from '../src/analytics/report.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_LOG_DIR = '/tmp/nuviotv-test-analytics';

describe('AnalyticsLogger', () => {
  let logger: AnalyticsLogger;

  beforeEach(() => {
    if (!fs.existsSync(TEST_LOG_DIR)) {
      fs.mkdirSync(TEST_LOG_DIR, { recursive: true });
    }
    const logFile = path.join(TEST_LOG_DIR, 'analytics.jsonl');
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    logger = new AnalyticsLogger(TEST_LOG_DIR);
  });

  afterAll(() => {
    if (fs.existsSync(TEST_LOG_DIR)) {
      fs.rmSync(TEST_LOG_DIR, { recursive: true, force: true });
    }
  });

  it('should log a provider result', () => {
    logger.log(
      {
        providerId: 'vodu-iraq',
        providerName: 'VODU',
        streams: [
          { name: 'VODU', title: 'VODU 720p', url: 'test.mp4', quality: '720p' },
        ],
        subtitles: [],
        responseTimeMs: 500,
      },
      'movie'
    );

    const entries = logger.readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].providerId).toBe('vodu-iraq');
    expect(entries[0].success).toBe(true);
  });

  it('should log failed results', () => {
    logger.log(
      {
        providerId: 'cinemabox-iraq',
        providerName: 'CinemaBox',
        streams: [],
        subtitles: [],
        error: 'Connection timeout',
        responseTimeMs: 15000,
      },
      'tv'
    );

    const entries = logger.readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].success).toBe(false);
    expect(entries[0].error).toBe('Connection timeout');
  });

  it('should compute provider stats', () => {
    for (let i = 0; i < 5; i++) {
      logger.log(
        {
          providerId: 'vodu-iraq',
          providerName: 'VODU',
          streams: [{ name: 'VODU', title: 'VODU 720p', url: 'test.mp4', quality: '720p' }],
          subtitles: [],
          responseTimeMs: 300 + i * 100,
        },
        'movie'
      );
    }

    logger.log(
      {
        providerId: 'vodu-iraq',
        providerName: 'VODU',
        streams: [],
        subtitles: [],
        error: 'fail',
        responseTimeMs: 1000,
      },
      'movie'
    );

    const stats = logger.getProviderStats('vodu-iraq');
    expect(stats.totalRequests).toBe(6);
    expect(stats.successfulRequests).toBe(5);
    expect(stats.failedRequests).toBe(1);
    expect(stats.successRate).toBeGreaterThan(80);
  });
});

describe('generateWeeklyReport', () => {
  it('should generate a report with provider data', () => {
    const dir = '/tmp/nuviotv-test-report';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const logFile = path.join(dir, 'analytics.jsonl');
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);

    const logger = new AnalyticsLogger(dir);
    logger.log(
      {
        providerId: 'vodu-iraq',
        providerName: 'VODU',
        streams: [{ name: 'VODU', title: 'VODU 1080p', url: 'test.mp4', quality: '1080p' }],
        subtitles: [],
        responseTimeMs: 400,
      },
      'movie'
    );

    const report = generateWeeklyReport(logger);
    expect(report.providers).toHaveLength(4);
    expect(report.totalStreamsServed).toBe(1);
    expect(report.overallSuccessRate).toBeGreaterThan(0);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
