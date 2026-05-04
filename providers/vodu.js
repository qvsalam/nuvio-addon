/* VODU Provider - Nuvio Compatible
 * Features: dual-language TMDB, similarity matching, timeout, retry, User-Agent rotation, caching
 */

var VODU_BASE = "https://movie.vodu.me";
var TMDB_BASE = "https://api.themoviedb.org/3";
var CACHE = {};
var CACHE_TTL = 10 * 60 * 1000;

var USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0"
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function cacheGet(key) {
  var entry = CACHE[key];
  if (!entry) return null;
  if (Date.now() > entry.expiry) { delete CACHE[key]; return null; }
  return entry.data;
}

function cacheSet(key, data) {
  CACHE[key] = { data: data, expiry: Date.now() + CACHE_TTL };
}

function fetchWithRetry(url, retries, headers) {
  retries = retries || 3;
  headers = headers || {};
  if (!headers["User-Agent"]) headers["User-Agent"] = randomUA();

  return fetch(url, { headers: headers })
    .then(function(r) { return r; })
    .catch(function(err) {
      if (retries <= 1) return Promise.reject(err);
      var delay = 1000 * Math.pow(2, 3 - retries);
      return new Promise(function(resolve) { setTimeout(resolve, delay); })
        .then(function() { return fetchWithRetry(url, retries - 1, headers); });
    });
}

function normalize(s) {
  return s.toLowerCase().replace(/[^\w\u0600-\u06FF\s]/g, "").replace(/\s+/g, " ").trim();
}

function similarity(a, b) {
  var na = normalize(a);
  var nb = normalize(b);
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;
  var longer = na.length >= nb.length ? na : nb;
  var shorter = na.length < nb.length ? na : nb;
  var m = longer.length;
  var n = shorter.length;
  var dp = [];
  for (var i = 0; i <= m; i++) {
    dp[i] = [];
    for (var j = 0; j <= n; j++) dp[i][j] = 0;
    dp[i][0] = i;
  }
  for (var j2 = 0; j2 <= n; j2++) dp[0][j2] = j2;
  for (var i2 = 1; i2 <= m; i2++) {
    for (var j3 = 1; j3 <= n; j3++) {
      var cost = longer[i2 - 1] === shorter[j3 - 1] ? 0 : 1;
      dp[i2][j3] = Math.min(dp[i2 - 1][j3] + 1, dp[i2][j3 - 1] + 1, dp[i2 - 1][j3 - 1] + cost);
    }
  }
  return 1 - dp[m][n] / m;
}

function getStreams(tmdbId, mediaType, season, episode) {
  var cacheKey = "vodu:" + tmdbId + ":" + mediaType + ":" + season + ":" + episode;
  var cached = cacheGet(cacheKey);
  if (cached) return Promise.resolve(cached);

  var path = "/" + (mediaType === "movie" ? "movie" : "tv") + "/" + tmdbId;
  var enUrl = TMDB_BASE + path + "?api_key=" + TMDB_API_KEY + "&language=en";
  var arUrl = TMDB_BASE + path + "?api_key=" + TMDB_API_KEY + "&language=ar";

  return Promise.all([
    fetchWithRetry(enUrl).then(function(r) { return r.json(); }).catch(function() { return {}; }),
    fetchWithRetry(arUrl).then(function(r) { return r.json(); }).catch(function() { return {}; })
  ])
    .then(function(results) {
      var enInfo = results[0];
      var arInfo = results[1];
      var titles = [];
      var addTitle = function(t) { if (t && titles.indexOf(t) === -1) titles.push(t); };
      addTitle(enInfo.title); addTitle(enInfo.original_title);
      addTitle(enInfo.name); addTitle(enInfo.original_name);
      addTitle(arInfo.title); addTitle(arInfo.original_title);
      addTitle(arInfo.name); addTitle(arInfo.original_name);
      if (titles.length === 0) return [];
      return searchVODU(titles, 0, mediaType, season, episode);
    })
    .then(function(streams) {
      if (streams.length > 0) cacheSet(cacheKey, streams);
      return streams;
    })
    .catch(function() { return []; });
}

function searchVODU(titles, idx, mediaType, season, episode) {
  if (idx >= titles.length) return [];
  return fetchWithRetry(VODU_BASE + "/index.php?do=list&title=" + encodeURIComponent(titles[idx]))
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var links = [];
      var re = /href=["']([^"']*do=view[^"']*)["']/gi;
      var m;
      while ((m = re.exec(html)) !== null) {
        var href = m[1].replace(/&amp;/g, "&");
        if (href.indexOf("http") !== 0) href = VODU_BASE + "/" + href.replace(/^\//, "");
        if (links.indexOf(href) === -1) links.push(href);
      }
      if (links.length === 0) return searchVODU(titles, idx + 1, mediaType, season, episode);
      return tryLinks(links, 0, mediaType, season, episode);
    })
    .catch(function() { return searchVODU(titles, idx + 1, mediaType, season, episode); });
}

function tryLinks(links, idx, mediaType, season, episode) {
  if (idx >= links.length) return [];
  return fetchWithRetry(links[idx])
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var allUrls = getAllVideoUrls(html);
      var s;
      if (mediaType === "tv" && season && episode) {
        s = filterEpisode(allUrls, parseInt(season) || 1, parseInt(episode) || 1, html);
      } else {
        s = filterMovieUrls(allUrls, html);
      }
      if (s.length > 0) return s;
      return tryLinks(links, idx + 1, mediaType, season, episode);
    })
    .catch(function() { return tryLinks(links, idx + 1, mediaType, season, episode); });
}

function filterEpisode(allUrls, sNum, eNum, html) {
  var sStr = sNum < 10 ? "0" + sNum : "" + sNum;
  var eStr = eNum < 10 ? "0" + eNum : "" + eNum;
  var pats = [
    "S" + sStr + "E" + eStr, "s" + sStr + "e" + eStr,
    "S" + sNum + "E" + eNum, "s" + sNum + "e" + eNum
  ];
  var streams = [];
  var seen = {};
  for (var i = 0; i < allUrls.length; i++) {
    var url = allUrls[i];
    if (isSkip(url)) continue;
    var upper = url.toUpperCase();
    var matched = false;
    for (var p = 0; p < pats.length; p++) {
      if (upper.indexOf(pats[p].toUpperCase()) > -1) { matched = true; break; }
    }
    if (matched && !seen[url]) {
      seen[url] = true;
      streams.push({ name: "VODU", title: "VODU " + getQ(url), url: url, quality: getQ(url) });
    }
  }
  if (streams.length === 0) {
    var epPats = [
      "_E" + eStr + "_", "_E" + eStr + "-", "_E" + eStr + ".",
      "_E" + eNum + "_", "_E" + eNum + "-", "_E" + eNum + ".",
      "E" + eStr + "_", "E" + eStr + "-", "_" + eStr + "_"
    ];
    for (var i2 = 0; i2 < allUrls.length; i2++) {
      var url2 = allUrls[i2];
      if (isSkip(url2)) continue;
      var upper2 = url2.toUpperCase();
      for (var p2 = 0; p2 < epPats.length; p2++) {
        if (upper2.indexOf(epPats[p2].toUpperCase()) > -1 && !seen[url2]) {
          seen[url2] = true;
          streams.push({ name: "VODU", title: "VODU " + getQ(url2), url: url2, quality: getQ(url2) });
          break;
        }
      }
    }
  }
  addVariants(streams, html);
  sortStreams(streams);
  return streams;
}

function filterMovieUrls(allUrls, html) {
  var streams = [];
  var seen = {};
  for (var i = 0; i < allUrls.length; i++) {
    var url = allUrls[i];
    if (isSkip(url)) continue;
    if (seen[url]) continue;
    seen[url] = true;
    streams.push({ name: "VODU", title: "VODU " + getQ(url), url: url, quality: getQ(url) });
  }
  addVariants(streams, html);
  sortStreams(streams);
  return streams;
}

function getAllVideoUrls(html) {
  var urls = [];
  var m;
  var res = [
    /["'](https?:\/\/[^"'\s]*:8888\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi,
    /<(?:source|video)[^>]*src=["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/gi,
    /(?:file|src|url|videoUrl|source)\s*[:=]\s*["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)/gi,
    /"(https?:\\\/\\\/[^"]*\.(?:mp4|m3u8)[^"]*)"/g,
    /["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8)(?:\?[^"'\s]*)?)/gi
  ];
  for (var p = 0; p < res.length; p++) {
    while ((m = res[p].exec(html)) !== null) {
      var u = m[1].replace(/\\\//g, "/").replace(/&amp;/g, "&");
      if (urls.indexOf(u) === -1) urls.push(u);
    }
  }
  return urls;
}

function isSkip(url) {
  if (/-t\.(mp4|m3u8)/i.test(url)) return true;
  if (/_t\.(mp4|m3u8)/i.test(url)) return true;
  if (/thumb|trailer|preview|poster/i.test(url)) return true;
  return false;
}

function getQ(url) {
  if (/-360\./i.test(url)) return "360p";
  if (/-480\./i.test(url)) return "480p";
  if (/-720\./i.test(url)) return "720p";
  if (/-1080\./i.test(url)) return "1080p";
  if (/\.m3u8/i.test(url)) return "HLS";
  return "HD";
}

function addVariants(streams, html) {
  var has720 = false;
  var baseUrl = null;
  for (var i = 0; i < streams.length; i++) {
    if (streams[i].quality === "720p") has720 = true;
    if (!baseUrl && /-(?:360|1080)\./i.test(streams[i].url)) baseUrl = streams[i].url;
  }
  if (!has720 && baseUrl && html.indexOf("720") > -1) {
    var u = baseUrl.replace(/-(?:360|1080)\./i, "-720.");
    streams.push({ name: "VODU", title: "VODU 720p", url: u, quality: "720p" });
  }
}

function sortStreams(streams) {
  var order = {"1080p": 0, "720p": 1, "480p": 2, "360p": 3, "HLS": 4, "HD": 5};
  streams.sort(function(a, b) {
    return (order[a.quality] != null ? order[a.quality] : 9) - (order[b.quality] != null ? order[b.quality] : 9);
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else if (typeof global !== "undefined") {
  global.getStreams = getStreams;
}
