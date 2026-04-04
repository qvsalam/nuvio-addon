/**
 * VODU Scraper for Nuvio
 * Streams movies & TV series from movie.vodu.me
 *
 * ⚠️  يعمل فقط على شبكة الـ ISP العراقية (Earthlink, Korek, Asiacell, ...)
 *
 * Available globals (injected by Nuvio):
 *   axios         - HTTP client (sandboxed)
 *   fetch         - Fetch API
 *   logger        - logger.log / .warn / .error
 *   TMDB_API_KEY  - TMDB read token from Nuvio settings
 *   SCRAPER_SETTINGS - per-scraper user settings (username, password)
 *   cheerio       - HTML parser
 *   params        - { tmdbId, mediaType, season, episode }
 */

// ─── Constants ────────────────────────────────────────────────────────────────
const VODU_BASE   = 'http://movie.vodu.me';
const TMDB_BASE   = 'https://api.themoviedb.org/3';
const DEFAULT_UA  = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

// ─── Entry Point ──────────────────────────────────────────────────────────────
async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    logger.log(`[VODU] ▶ tmdbId=${tmdbId} type=${mediaType} s=${season ?? '-'} e=${episode ?? '-'}`);

    // 1. Get title + year from TMDB
    const info = await getTMDBInfo(tmdbId, mediaType);
    if (!info) { logger.warn('[VODU] TMDB lookup failed'); return []; }
    logger.log(`[VODU] Title: "${info.title}" (${info.year})`);

    // 2. Search VODU website by title
    let results = await searchVodu(info.title);

    // Try original-language title as fallback
    if (results.length === 0 && info.originalTitle && info.originalTitle !== info.title) {
      logger.log(`[VODU] Retrying with original title: "${info.originalTitle}"`);
      results = await searchVodu(info.originalTitle);
    }

    // Try shorter title (first 3 words) if still no results
    if (results.length === 0) {
      const shortTitle = info.title.split(' ').slice(0, 3).join(' ');
      if (shortTitle !== info.title) {
        logger.log(`[VODU] Retrying with short title: "${shortTitle}"`);
        results = await searchVodu(shortTitle);
      }
    }

    logger.log(`[VODU] Found ${results.length} results`);
    if (results.length === 0) return [];

    // 3. Pick best-matching result
    const match = findBestMatch(results, info.title, info.year, mediaType);
    if (!match) { logger.warn('[VODU] No good title match'); return []; }
    logger.log(`[VODU] Best match → "${match.title}" id=${match.id} score=${match.score}`);

    // 4. Extract streams
    if (mediaType === 'tv' && season != null && episode != null) {
      return await getTVStreams(match.id, season, episode, match.title);
    } else {
      return await getMovieStreams(match.id, match.title);
    }

  } catch (err) {
    logger.error('[VODU] Fatal:', err.message);
    return [];
  }
}

// ─── TMDB Info ────────────────────────────────────────────────────────────────
async function getTMDBInfo(tmdbId, mediaType) {
  try {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;
    const res = await axios.get(url, { timeout: 12000 });
    const d = res.data;
    return {
      title:         d.title        || d.name        || '',
      originalTitle: d.original_title || d.original_name || '',
      year:          (d.release_date || d.first_air_date || '').split('-')[0] || null,
    };
  } catch (e) {
    logger.error('[VODU] TMDB error:', e.message);
    return null;
  }
}

// ─── VODU Search ──────────────────────────────────────────────────────────────
async function searchVodu(title) {
  try {
    const url = `${VODU_BASE}/index.php?do=list&title=${encodeURIComponent(title)}`;
    logger.log('[VODU] Searching:', url);
    const res = await axios.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent': DEFAULT_UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ar,en;q=0.9',
      },
    });
    return parseSearchResults(res.data);
  } catch (e) {
    logger.error('[VODU] Search request failed:', e.message);
    return [];
  }
}

function parseSearchResults(html) {
  const results = [];
  const seen = new Set();

  // Pattern: href="...?do=view&type=post&id=XXXXX"
  const linkRe = /href="[^"]*do=view[^"]*type=post[^"]*id=(\d+)[^"]*"/g;
  const titleRe = /<div[^>]+class="mytitle"[^>]*>[\s\S]*?<a[^>]+id=(\d+)[^>]*>([^<]+)<\/a>/g;
  const altRe   = /<div[^>]+class="alttitle"[^>]*>\s*([^<]*)\s*<\/div>/g;

  // Primary: extract via mytitle blocks (most reliable)
  let m;
  while ((m = titleRe.exec(html)) !== null) {
    const id = m[1];
    const title = decodeHTML(m[2].trim());
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    results.push({ id, title, altTitle: '' });
  }

  // Collect alt titles in order
  const alts = [];
  while ((m = altRe.exec(html)) !== null) {
    alts.push(decodeHTML(m[1].trim()));
  }
  for (let i = 0; i < results.length && i < alts.length; i++) {
    results[i].altTitle = alts[i];
  }

  // Fallback: simple link scan if mytitle pattern didn't match
  if (results.length === 0) {
    while ((m = linkRe.exec(html)) !== null) {
      const id = m[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      results.push({ id, title: `Post ${id}`, altTitle: '' });
    }
  }

  return results;
}

function decodeHTML(str) {
  return str
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// ─── Title Matching ───────────────────────────────────────────────────────────
function findBestMatch(results, targetTitle, year, mediaType) {
  const norm = s => s.toLowerCase()
    .replace(/[:'!?.,\-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normTarget = norm(targetTitle);

  const scored = results.map(r => {
    const normR   = norm(r.title);
    const normAlt = norm(r.altTitle || '');
    let score = 0;

    if (normR === normTarget || normAlt === normTarget)          score = 100;
    else if (normR.startsWith(normTarget) || normAlt.startsWith(normTarget)) score = 85;
    else if (normTarget.startsWith(normR) || normTarget.startsWith(normAlt)) score = 75;
    else if (normR.includes(normTarget) || normAlt.includes(normTarget))     score = 65;
    else if (normTarget.includes(normR))                                      score = 50;
    else {
      // Word-overlap score
      const targetWords = normTarget.split(' ').filter(Boolean);
      const rWords      = new Set((normR + ' ' + normAlt).split(' ').filter(Boolean));
      const overlap     = targetWords.filter(w => w.length > 2 && rWords.has(w)).length;
      score = Math.round((overlap / targetWords.length) * 50);
    }

    // Year bonus
    if (year && (r.title.includes(year) || (r.altTitle && r.altTitle.includes(year)))) {
      score += 5;
    }

    return { ...r, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best && best.score >= 45 ? best : null;
}

// ─── Movie Streams ────────────────────────────────────────────────────────────
async function getMovieStreams(postId, displayTitle) {
  try {
    const url = `${VODU_BASE}/index.php?do=view&type=post&id=${postId}`;
    logger.log('[VODU] Fetching movie page:', url);
    const res = await axios.get(url, {
      timeout: 20000,
      headers: { 'User-Agent': DEFAULT_UA },
    });
    const streams = extractVideoUrls(res.data, displayTitle);
    logger.log(`[VODU] Movie streams found: ${streams.length}`);
    return streams;
  } catch (e) {
    logger.error('[VODU] Movie page error:', e.message);
    return [];
  }
}

// ─── TV / Series Streams ──────────────────────────────────────────────────────
async function getTVStreams(seriesId, season, episode, seriesTitle) {
  try {
    const url = `${VODU_BASE}/index.php?do=view&type=post&id=${seriesId}`;
    logger.log('[VODU] Fetching series page:', url);
    const res = await axios.get(url, {
      timeout: 20000,
      headers: { 'User-Agent': DEFAULT_UA },
    });
    const html = res.data;
    const epLabel = `S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}`;

    // Step 1: Try to find a dedicated episode page link
    const epPageId = findEpisodePageId(html, season, episode);
    if (epPageId) {
      logger.log(`[VODU] Found episode page id=${epPageId} for ${epLabel}`);
      const epUrl = `${VODU_BASE}/index.php?do=view&type=post&id=${epPageId}`;
      const epRes = await axios.get(epUrl, {
        timeout: 20000,
        headers: { 'User-Agent': DEFAULT_UA },
      });
      const streams = extractVideoUrls(epRes.data, `${seriesTitle} ${epLabel}`);
      if (streams.length > 0) return streams;
    }

    // Step 2: Fallback – try to extract directly from series page
    //  (some VODU series embed all episodes in one page via tabs)
    const directStreams = extractVideoUrls(html, `${seriesTitle} ${epLabel}`);
    if (directStreams.length > 0) {
      logger.log('[VODU] Got streams from series page directly');
      return directStreams;
    }

    // Step 3: Try searching for episode specifically
    const epSearchTitle = `${seriesTitle} ${epLabel}`;
    const epResults = await searchVodu(epSearchTitle);
    if (epResults.length > 0) {
      logger.log('[VODU] Found via episode search, id=' + epResults[0].id);
      return await getMovieStreams(epResults[0].id, `${seriesTitle} ${epLabel}`);
    }

    logger.warn(`[VODU] No streams for ${epLabel}`);
    return [];

  } catch (e) {
    logger.error('[VODU] TV streams error:', e.message);
    return [];
  }
}

function findEpisodePageId(html, season, episode) {
  const s2 = String(season).padStart(2, '0');
  const e2 = String(episode).padStart(2, '0');

  // Patterns to look for in link text / href
  const patterns = [
    new RegExp(`s${s2}e${e2}`, 'i'),
    new RegExp(`s${season}e${episode}[^\\d]`, 'i'),
    new RegExp(`season\\s*${season}[^\\d]*episode\\s*${episode}[^\\d]`, 'i'),
    new RegExp(`حلقة\\s*${episode}`, 'i'),       // Arabic: Episode N
    new RegExp(`الموسم\\s*${season}`, 'i'),       // Arabic: Season N
  ];

  // Find all anchor tags that link to content pages
  const anchorRe = /<a\s[^>]*href="[^"]*id=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const id = m[1];
    const text = m[2].replace(/<[^>]+>/g, ' ').trim();
    for (const pat of patterns) {
      if (pat.test(text) || pat.test(m[0])) return id;
    }
  }

  return null;
}

// ─── Video URL Extractor ──────────────────────────────────────────────────────
function extractVideoUrls(html, displayTitle) {
  const streams = [];
  const seen    = new Set();
  const label   = displayTitle || 'VODU';

  const addStream = (url, quality) => {
    const cleanUrl = url.replace(/\\u0026/g, '&').replace(/\\/g, '');
    if (seen.has(cleanUrl)) return;
    // Skip thumbnail / trailer files
    if (/[_\-]t\.(mp4|m3u8)/.test(cleanUrl)) return;
    if (/thumb|trailer|preview/i.test(cleanUrl)) return;
    seen.add(cleanUrl);
    streams.push({ title: `VODU | ${quality}`, name: label, url: cleanUrl, quality });
  };

  // ── 1. Direct VODU MP4 URLs (movie.vodu.me:8888/videos/...)
  const mp4Re = /https?:\/\/(?:movie\.)?vodu\.me(?::\d+)?\/videos?\/[^\s"'\\)>]+\.mp4(?:[^\s"'\\)>]*)?/gi;
  let m;
  while ((m = mp4Re.exec(html)) !== null) {
    const url = m[0];
    const q = qualityFromUrl(url);
    if (q !== 'SKIP') addStream(url, q);
  }

  // ── 2. Alternative video server patterns (int.vodu.me or isp.vodu.me)
  const altMp4Re = /https?:\/\/(?:int|isp)\.vodu\.me(?::\d+)?\/[^\s"'\\)>]+\.mp4(?:[^\s"'\\)>]*)?/gi;
  while ((m = altMp4Re.exec(html)) !== null) {
    const url = m[0];
    const q = qualityFromUrl(url);
    if (q !== 'SKIP') addStream(url, q);
  }

  // ── 3. HLS / M3U8 streams from VODU servers
  const hlsRe = /https?:\/\/(?:[^"'\s>]*vodu[^"'\s>]*)\.m3u8(?:[^"'\s>]*)?/gi;
  while ((m = hlsRe.exec(html)) !== null) {
    addStream(m[0], 'HLS');
  }

  // ── 4. JS variable assignments (VideoJS / JW Player source)
  const jsVarPatterns = [
    /(?:file|src|url|videoUrl|tvVideoUrl|source)\s*[:=]\s*["'`](\bhttps?:\/\/[^"'`\s]+\.(?:mp4|m3u8)[^"'`\s]*)/gi,
    /"(?:file|src|url|path)"\s*:\s*"(https?:\/\/[^"]+\.(?:mp4|m3u8)[^"]*)"/gi,
  ];
  for (const re of jsVarPatterns) {
    re.lastIndex = 0;
    while ((m = re.exec(html)) !== null) {
      const url = m[1];
      if (!url || !url.startsWith('http')) continue;
      const q = qualityFromUrl(url);
      if (q !== 'SKIP') addStream(url, q);
    }
  }

  // ── 5. JSON-encoded URLs (escaped forward slashes)
  const jsonUrlRe = /"(https?:\\\/\\\/[^"]+\.(?:mp4|m3u8)[^"]*)"/g;
  while ((m = jsonUrlRe.exec(html)) !== null) {
    const url = m[1].replace(/\\\//g, '/');
    const q = qualityFromUrl(url);
    if (q !== 'SKIP') addStream(url, q);
  }

  // Sort by quality: 1080 → 720 → 480 → 360 → HLS → others
  const order = { '1080p': 0, '720p': 1, '480p': 2, '360p': 3, 'HLS': 4, 'HD': 5, 'SD': 6 };
  streams.sort((a, b) => (order[a.quality] ?? 9) - (order[b.quality] ?? 9));

  logger.log(`[VODU] Extracted ${streams.length} video URL(s)`);
  return streams;
}

function qualityFromUrl(url) {
  if (/[_\-]t\.(mp4|m3u8)/i.test(url))     return 'SKIP';  // thumbnail
  if (/thumb|trailer|preview/i.test(url))   return 'SKIP';
  if (/1080/i.test(url))  return '1080p';
  if (/720/i.test(url))   return '720p';
  if (/480/i.test(url))   return '480p';
  if (/360/i.test(url))   return '360p';
  if (/\.m3u8/i.test(url)) return 'HLS';
  return 'HD';
}
