import type { AnalyticsEntry, ProviderResult, MediaType, QualityLabel } from '../types/index.js';
import { averageQuality } from '../utils/quality.js';
import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = 'analytics.jsonl';

export class AnalyticsLogger {
  private logPath: string;

  constructor(logDir?: string) {
    this.logPath = path.resolve(logDir ?? '.', LOG_FILE);
  }

  log(result: ProviderResult, mediaType: MediaType): void {
    const entry: AnalyticsEntry = {
      providerId: result.providerId,
      timestamp: Date.now(),
      success: !result.error && result.streams.length > 0,
      streamCount: result.streams.length,
      averageQuality: averageQuality(
        result.streams.map((s) => s.quality)
      ),
      responseTimeMs: result.responseTimeMs,
      error: result.error,
      mediaType,
    };

    try {
      fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
    } catch {
      console.error('Failed to write analytics entry');
    }
  }

  readEntries(since?: number): AnalyticsEntry[] {
    try {
      if (!fs.existsSync(this.logPath)) return [];

      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      const entries = lines.map((line) => JSON.parse(line) as AnalyticsEntry);

      if (since) {
        return entries.filter((e) => e.timestamp >= since);
      }
      return entries;
    } catch {
      return [];
    }
  }

  getProviderStats(providerId: string, since?: number): {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    successRate: number;
    averageResponseMs: number;
    averageQuality: QualityLabel;
    totalStreams: number;
  } {
    const entries = this.readEntries(since).filter(
      (e) => e.providerId === providerId
    );

    if (entries.length === 0) {
      return {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        successRate: 0,
        averageResponseMs: 0,
        averageQuality: 'Unknown',
        totalStreams: 0,
      };
    }

    const successful = entries.filter((e) => e.success).length;
    const totalStreams = entries.reduce((sum, e) => sum + e.streamCount, 0);
    const avgResponse =
      entries.reduce((sum, e) => sum + e.responseTimeMs, 0) / entries.length;
    const qualities = entries
      .filter((e) => e.averageQuality !== 'Unknown')
      .map((e) => e.averageQuality);

    return {
      totalRequests: entries.length,
      successfulRequests: successful,
      failedRequests: entries.length - successful,
      successRate: Math.round((successful / entries.length) * 10000) / 100,
      averageResponseMs: Math.round(avgResponse),
      averageQuality: averageQuality(qualities),
      totalStreams,
    };
  }
}
