// VODU Iraq Provider for Nuvio
// Works only on Iraqi ISP networks
// v1.2.0 - Promise-based (no async/await for Hermes compatibility)

var VODU_BASE = 'https://movie.vodu.me';
var TMDB_BASE = 'https://api.themoviedb.org/3';
var TMDB_KEY = '258f9e3b7fae26a1b295cb13e0689b73';

function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[VODU] getStreams called: tmdbId=' + tmdbId + ' type=' + mediaType + ' S' + season + 'E' + episode);

  // Step 1: Get title from TMDB
  var tmdbUrl;
  if (mediaType === 'movie') {
    tmdbUrl = TMDB_BASE + '/movie/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=ar';
  } else {
    tmdbUrl = TMDB_BASE + '/tv/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=ar';
  }

  return fetch(tmdbUrl)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var title = data.title || data.name || data.original_title || data.original_name || '';
      var originalTitle = data.original_title || data.original_name || '';
      var year = '';
      if (data.release_date) year = data.release_date.substring(0, 4);
      if (data.first_air_date) year = data.first_air_date.substring(0, 4);

      console.log('[VODU] TMDB title: ' + title + ' | original: ' + originalTitle + ' | year: ' + year);

      if (!title && !originalTitle) {
        console.log('[VODU] No title found from TMDB');
        return [];
      }

      // Try Arabic title first, then original
      var searchQueries = [];
      if (title) searchQueries.push(title);
      if (originalTitle && originalTitle !== title) searchQueries.push(originalTitle);

      return searchVODU(searchQueries, 0, mediaType, season, episode, year);
    })
    .catch(function(err) {
      console.error('[VODU] TMDB error: ' + err.message);
      return [];
    });
}

function searchVODU(queries, index, mediaType, season, episode, year) {
  if (index >= queries.length) {
    console.log('[VODU] No results found for any search query');
    return [];
  }

  var query = queries[index];
  var searchType = mediaType === 'movie' ? 'movies' : 'series';
  var searchUrl = VODU_BASE + '/search?type=' + searchType + '&q=' + encodeURIComponent(query);

  console.log('[VODU] Searching: ' + searchUrl);

  return fetch(searchUrl)
    .then(function(res) { return res.text(); })
    .then(function(html) {
      var results = parseSearchResults(html);
      console.log('[VODU] Found ' + results.length + ' search results');

      if (results.length === 0) {
        // Try next query
        return searchVODU(queries, index + 1, mediaType, season, episode, year);
      }

      // Pick best match
      var bestMatch = pickBestMatch(results, query, year);
      if (!bestMatch) {
        return searchVODU(queries, index + 1, mediaType, season, episode, year);
      }

      console.log('[VODU] Best match: ' + bestMatch.title + ' -> ' + bestMatch.url);

      if (mediaType === 'movie') {
        return extractStreamsFromPage(bestMatch.url);
      } else {
        return getEpisodePage(bestMatch.url, season, episode);
      }
    })
    .catch(function(err) {
      console.error('[VODU] Search error: ' + err.message);
      return searchVODU(queries, index + 1, mediaType, season, episode, year);
    });
}

function parseSearchResults(html) {
  var results = [];
  // Match links to movie/series detail pages
  var patterns = [
    /<a[^>]*href=["']((?:https?:\/\/movie\.vodu\.me)?\/(?:movie|series)\/[^"']+)["'][^>]*>/gi,
    /<a[^>]*href=["'](\/(?:movie|series)\/[^"']+)["'][^>]*>/gi
  ];

  var seen = {};
  for (var p = 0; p < patterns.length; p++) {
    var re = patterns[p];
    var m;
    while ((m = re.exec(html)) !== null) {
      var url = m[1];
      if (url.indexOf('http') !== 0) {
        url = VODU_BASE + url;
      }
      if (!seen[url]) {
        seen[url] = true;
        // Try to extract title from nearby text
        var titleMatch = html.substring(m.index, m.index + 500).match(/title=["']([^"']+)["']/i);
        var title = titleMatch ? titleMatch[1] : url.split('/').pop().replace(/-/g, ' ');
        results.push({ url: url, title: title });
      }
    }
  }

  return results;
}

function pickBestMatch(results, query, year) {
  if (results.length === 0) return null;

  var queryLower = query.toLowerCase().trim();

  // Score each result
  var scored = results.map(function(r) {
    var titleLower = r.title.toLowerCase();
    var urlLower = r.url.toLowerCase();
    var score = 0;

    // Exact title match
    if (titleLower === queryLower) score += 100;
    // Title contains query
    else if (titleLower.indexOf(queryLower) !== -1) score += 50;
    // URL contains query words
    var words = queryLower.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      if (urlLower.indexOf(words[i]) !== -1) score += 10;
    }
    // Year match
    if (year && (titleLower.indexOf(year) !== -1 || urlLower.indexOf(year) !== -1)) {
      score += 30;
    }

    return { result: r, score: score };
  });

  scored.sort(function(a, b) { return b.score - a.score; });

  if (scored[0].score > 0) {
    return scored[0].result;
  }

  // Just return first result as fallback
  return results[0];
}

function getEpisodePage(seriesUrl, season, episode) {
  console.log('[VODU] Getting series page: ' + seriesUrl);

  return fetch(seriesUrl)
    .then(function(res) { return res.text(); })
    .then(function(html) {
      // Try direct episode URL patterns
      var seasonNum = parseInt(season) || 1;
      var episodeNum = parseInt(episode) || 1;

      var episodePatterns = [
        // /series/name/season-1/episode-1
        seriesUrl.replace(/\/$/, '') + '/season-' + seasonNum + '/episode-' + episodeNum,
        seriesUrl.replace(/\/$/, '') + '/s' + seasonNum + '/e' + episodeNum,
        seriesUrl.replace(/\/$/, '') + '/' + seasonNum + '/' + episodeNum
      ];

      // Also search for episode links in the HTML
      var epRe = new RegExp('href=["\']((?:https?://movie\\.vodu\\.me)?/[^"\']*(?:season[\\-_]?' + seasonNum + '[^"\']*episode[\\-_]?' + episodeNum + '|s0?' + seasonNum + '[\\-_]?e0?' + episodeNum + ')[^"\']*)["\']', 'gi');
      var m;
      while ((m = epRe.exec(html)) !== null) {
        var url = m[1];
        if (url.indexOf('http') !== 0) url = VODU_BASE + url;
        episodePatterns.unshift(url); // Add found URLs first
      }

      return tryEpisodeUrls(episodePatterns, 0);
    })
    .catch(function(err) {
      console.error('[VODU] Episode page error: ' + err.message);
      return [];
    });
}

function tryEpisodeUrls(urls, index) {
  if (index >= urls.length) {
    console.log('[VODU] No episode URL worked');
    return [];
  }

  var url = urls[index];
  console.log('[VODU] Trying episode URL: ' + url);

  return fetch(url)
    .then(function(res) {
      if (!res.ok) {
        return tryEpisodeUrls(urls, index + 1);
      }
      return res.text();
    })
    .then(function(html) {
      if (typeof html !== 'string') return html; // Already returned from recursive call
      var streams = extractVideoUrls(html);
      if (streams.length > 0) {
        return streams;
      }
      return tryEpisodeUrls(urls, index + 1);
    })
    .catch(function(err) {
      console.error('[VODU] Episode URL error: ' + err.message);
      return tryEpisodeUrls(urls, index + 1);
    });
}

function extractStreamsFromPage(pageUrl) {
  console.log('[VODU] Extracting streams from: ' + pageUrl);

  return fetch(pageUrl)
    .then(function(res) { return res.text(); })
    .then(function(html) {
      var streams = extractVideoUrls(html);
      console.log('[VODU] Found ' + streams.length + ' stream(s)');

      // If no streams found, look for iframe/embed
      if (streams.length === 0) {
        var iframeSrc = findIframeSrc(html);
        if (iframeSrc) {
          console.log('[VODU] Found iframe: ' + iframeSrc);
          return fetch(iframeSrc)
            .then(function(res) { return res.text(); })
            .then(function(iframeHtml) {
              return extractVideoUrls(iframeHtml);
            })
            .catch(function() { return []; });
        }
      }

      return streams;
    })
    .catch(function(err) {
      console.error('[VODU] Extract error: ' + err.message);
      return [];
    });
}

function findIframeSrc(html) {
  var iframeRe = /<iframe[^>]*src=["']([^"']+)["'][^>]*>/gi;
  var m;
  while ((m = iframeRe.exec(html)) !== null) {
    var src = m[1];
    if (src.indexOf('youtube') === -1 && src.indexOf('google') === -1 && src.indexOf('facebook') === -1) {
      if (src.indexOf('http') !== 0) {
        src = VODU_BASE + src;
      }
      return src;
    }
  }
  return null;
}

function extractVideoUrls(html) {
  var streams = [];
  var seen = {};

  function addStream(url, quality) {
    // Clean URL
    url = url.replace(/\\\//g, '/').replace(/&amp;/g, '&');
    if (seen[url]) return;
    // Skip thumbnails and trailers
    if (/[_\-]t\.(mp4|m3u8)/i.test(url)) return;
    if (/thumb|trailer|preview/i.test(url)) return;
    seen[url] = true;
    if (!quality) quality = guessQuality(url);
    streams.push({
      name: 'VODU',
      title: 'VODU ' + quality,
      url: url,
      quality: quality
    });
  }

  // 1. <source> and <video> tags
  var sourceRe = /<(?:source|video)[^>]*src=["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/gi;
  var m;
  while ((m = sourceRe.exec(html)) !== null) { addStream(m[1]); }

  // 2. Direct MP4/M3U8 URLs in any attribute
  var attrRe = /["'](https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)(?:\?[^\s"'<>]*)?)/gi;
  while ((m = attrRe.exec(html)) !== null) { addStream(m[1]); }

  // 3. HLS URLs
  var hlsRe = /["'](https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi;
  while ((m = hlsRe.exec(html)) !== null) { addStream(m[1], 'HLS'); }

  // 4. JS variables (file/src/url assignments)
  var jsRe = /(?:file|src|url|videoUrl|tvVideoUrl|source)\s*[:=]\s*["'`](https?:\/\/[^"'`\s]+\.(?:mp4|m3u8)[^"'`\s]*)/gi;
  while ((m = jsRe.exec(html)) !== null) { addStream(m[1]); }

  // 5. JSON with escaped slashes
  var jsonRe = /"(https?:\\\/\\\/[^"]+\.(?:mp4|m3u8)[^"]*)"/g;
  while ((m = jsonRe.exec(html)) !== null) { addStream(m[1]); }

  // 6. data-src / data-url attributes
  var dataRe = /data-(?:src|url|file)\s*=\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/gi;
  while ((m = dataRe.exec(html)) !== null) { addStream(m[1]); }

  // Sort by quality
  var order = { '1080p': 0, '720p': 1, '480p': 2, '360p': 3, 'HLS': 4, 'HD': 5, 'SD': 6 };
  streams.sort(function(a, b) {
    return (order[a.quality] != null ? order[a.quality] : 9) -
           (order[b.quality] != null ? order[b.quality] : 9);
  });

  return streams;
}

function guessQuality(url) {
  if (/1080/i.test(url)) return '1080p';
  if (/720/i.test(url)) return '720p';
  if (/480/i.test(url)) return '480p';
  if (/360/i.test(url)) return '360p';
  if (/\.m3u8/i.test(url)) return 'HLS';
  return 'HD';
}

module.exports = { getStreams: getStreams };
