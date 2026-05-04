import type { WeeklyReport, ProviderReport } from '../types/index.js';
import { AnalyticsLogger } from './logger.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const PROVIDER_IDS = [
  { id: 'vodu-iraq', name: 'VODU' },
  { id: 'cinemabox-iraq', name: 'CinemaBox' },
  { id: 'cinemana-iraq', name: 'Cinemana' },
  { id: 'anime-provider', name: 'Anime' },
];

export function generateWeeklyReport(logger: AnalyticsLogger): WeeklyReport {
  const now = Date.now();
  const weekAgo = now - WEEK_MS;

  const providerReports: ProviderReport[] = PROVIDER_IDS.map(({ id, name }) => {
    const stats = logger.getProviderStats(id, weekAgo);
    return {
      providerId: id,
      providerName: name,
      totalRequests: stats.totalRequests,
      successfulRequests: stats.successfulRequests,
      failedRequests: stats.failedRequests,
      successRate: stats.successRate,
      averageResponseMs: stats.averageResponseMs,
      averageQuality: stats.averageQuality,
      streamCount: stats.totalStreams,
    };
  });

  const totalStreams = providerReports.reduce((s, p) => s + p.streamCount, 0);
  const totalRequests = providerReports.reduce(
    (s, p) => s + p.totalRequests,
    0
  );
  const totalSuccess = providerReports.reduce(
    (s, p) => s + p.successfulRequests,
    0
  );

  return {
    generatedAt: now,
    periodStart: weekAgo,
    periodEnd: now,
    providers: providerReports,
    totalStreamsServed: totalStreams,
    overallSuccessRate:
      totalRequests > 0
        ? Math.round((totalSuccess / totalRequests) * 10000) / 100
        : 0,
  };
}

function formatReport(report: WeeklyReport): string {
  const lines: string[] = [];
  lines.push('=== NuvioTV Weekly Provider Report ===');
  lines.push(`Period: ${new Date(report.periodStart).toISOString()} to ${new Date(report.periodEnd).toISOString()}`);
  lines.push(`Generated: ${new Date(report.generatedAt).toISOString()}`);
  lines.push('');
  lines.push(`Total Streams Served: ${report.totalStreamsServed}`);
  lines.push(`Overall Success Rate: ${report.overallSuccessRate}%`);
  lines.push('');

  for (const p of report.providers) {
    lines.push(`--- ${p.providerName} (${p.providerId}) ---`);
    lines.push(`  Requests: ${p.totalRequests} (${p.successfulRequests} ok, ${p.failedRequests} failed)`);
    lines.push(`  Success Rate: ${p.successRate}%`);
    lines.push(`  Avg Response: ${p.averageResponseMs}ms`);
    lines.push(`  Avg Quality: ${p.averageQuality}`);
    lines.push(`  Streams: ${p.streamCount}`);
    lines.push('');
  }

  const bestProvider = report.providers
    .filter((p) => p.totalRequests > 0)
    .sort((a, b) => {
      const aScore = a.successRate * 0.5 + (a.averageQuality === '1080p' ? 50 : a.averageQuality === '720p' ? 30 : 10);
      const bScore = b.successRate * 0.5 + (b.averageQuality === '1080p' ? 50 : b.averageQuality === '720p' ? 30 : 10);
      return bScore - aScore;
    })[0];

  if (bestProvider) {
    lines.push(`Best Provider: ${bestProvider.providerName} (${bestProvider.successRate}% success, avg ${bestProvider.averageQuality})`);
  }

  return lines.join('\n');
}

async function main() {
  const logger = new AnalyticsLogger();
  const report = generateWeeklyReport(logger);
  console.log(formatReport(report));
}

main().catch(console.error);
