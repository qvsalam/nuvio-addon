import type { QualityLabel } from '../types/index.js';

const QUALITY_ORDER: Record<QualityLabel, number> = {
  '2160p': 0,
  '1080p': 1,
  '720p': 2,
  '480p': 3,
  '360p': 4,
  '240p': 5,
  HLS: 6,
  HD: 7,
  Unknown: 8,
};

export function sortByQuality<T extends { quality: QualityLabel }>(items: T[]): T[] {
  return items.sort(
    (a, b) => (QUALITY_ORDER[a.quality] ?? 9) - (QUALITY_ORDER[b.quality] ?? 9)
  );
}

export function parseQuality(url: string): QualityLabel {
  if (/2160|4k/i.test(url)) return '2160p';
  if (/1080/i.test(url)) return '1080p';
  if (/720/i.test(url)) return '720p';
  if (/480/i.test(url)) return '480p';
  if (/360/i.test(url)) return '360p';
  if (/240/i.test(url)) return '240p';
  if (/\.m3u8/i.test(url)) return 'HLS';
  return 'HD';
}

export function qualityToNumeric(q: QualityLabel): number {
  const map: Record<QualityLabel, number> = {
    '2160p': 2160,
    '1080p': 1080,
    '720p': 720,
    '480p': 480,
    '360p': 360,
    '240p': 240,
    HLS: 720,
    HD: 720,
    Unknown: 0,
  };
  return map[q] ?? 0;
}

export function averageQuality(qualities: QualityLabel[]): QualityLabel {
  if (qualities.length === 0) return 'Unknown';
  const avg = qualities.reduce((sum, q) => sum + qualityToNumeric(q), 0) / qualities.length;
  if (avg >= 1620) return '2160p';
  if (avg >= 900) return '1080p';
  if (avg >= 600) return '720p';
  if (avg >= 420) return '480p';
  if (avg >= 300) return '360p';
  if (avg >= 120) return '240p';
  return 'Unknown';
}
