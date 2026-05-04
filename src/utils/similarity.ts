export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u0600-\u06FF\u200C\u200D]/g, (c) => c) // keep Arabic chars
    .replace(/[^\w\u0600-\u06FF\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;

  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length < nb.length ? na : nb;

  const dist = levenshtein(longer, shorter);
  return 1 - dist / longer.length;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export function bestMatch(query: string, candidates: string[]): { title: string; score: number } | null {
  if (candidates.length === 0) return null;

  let best = { title: candidates[0], score: similarity(query, candidates[0]) };
  for (let i = 1; i < candidates.length; i++) {
    const score = similarity(query, candidates[i]);
    if (score > best.score) {
      best = { title: candidates[i], score };
    }
  }
  return best;
}
