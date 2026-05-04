/* Cinemana Provider - Nuvio Compatible
 * Features: dual-language TMDB, similarity matching, year filtering, timeout, retry, caching
 */

var CINEMANA_API = "https://cinemana.shabakaty.com/api/android/";
var TMDB_BASE = "https://api.themoviedb.org/3";
var CACHE = {};
var CACHE_TTL = 10 * 60 * 1000;

function cacheGet(key) {
  var entry = CACHE[key];
  if (!entry) return null;
  if (Date.now() > entry.expiry) { delete CACHE[key]; return null; }
  return entry.data;
}

function cacheSet(key, data) {
  CACHE[key] = { data: data, expiry: Date.now() + CACHE_TTL };
}

function fetchWithRetry(url, retries) {
  retries = retries || 3;
  return fetch(url)
    .then(function(r) { return r; })
    .catch(function(err) {
      if (retries <= 1) return Promise.reject(err);
      var delay = 1000 * Math.pow(2, 3 - retries);
      return new Promise(function(resolve) { setTimeout(resolve, delay); })
        .then(function() { return fetchWithRetry(url, retries - 1); });
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
  var cacheKey = "cin:" + tmdbId + ":" + mediaType + ":" + season + ":" + episode;
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
      var year = null;
      var dateStr = enInfo.release_date || enInfo.first_air_date;
      if (dateStr) year = parseInt(dateStr.substring(0, 4), 10) || null;
      if (titles.length === 0) return [];
      var type = mediaType === "movie" ? "movies" : "series";
      return searchCinemana(titles, 0, type, season, episode, year);
    })
    .then(function(streams) {
      if (streams.length > 0) cacheSet(cacheKey, streams);
      return streams;
    })
    .catch(function() { return []; });
}

function searchCinemana(titles, idx, type, season, episode, year) {
  if (idx >= titles.length) return [];
  return fetchWithRetry(CINEMANA_API + "AdvancedSearch?videoTitle=" + encodeURIComponent(titles[idx]) + "&type=" + type)
    .then(function(r) { return r.json(); })
    .then(function(results) {
      if (!results || results.length === 0) {
        return searchCinemana(titles, idx + 1, type, season, episode, year);
      }

      var candidates = results;
      if (year) {
        var yearFiltered = [];
        for (var y = 0; y < candidates.length; y++) {
          if (candidates[y].year && parseInt(candidates[y].year, 10) === year) {
            yearFiltered.push(candidates[y]);
          }
        }
        if (yearFiltered.length > 0) candidates = yearFiltered;
      }

      var best = candidates[0];
      var bestScore = 0;
      for (var s = 0; s < candidates.length; s++) {
        var c = candidates[s];
        var score = Math.max(
          similarity(titles[idx], c.en_title || ""),
          similarity(titles[idx], c.ar_title || ""),
          similarity(titles[idx], c.title || "")
        );
        if (score > bestScore) { bestScore = score; best = c; }
      }

      var nb = best.nb;
      if (type === "series" && season && episode) {
        return getTVFiles(nb, parseInt(season) || 1, parseInt(episode) || 1);
      }
      return getFiles(nb);
    })
    .catch(function() { return searchCinemana(titles, idx + 1, type, season, episode, year); });
}

function getTVFiles(showNb, sNum, eNum) {
  return fetchWithRetry(CINEMANA_API + "videoSeason/id/" + showNb)
    .then(function(r) { return r.json(); })
    .then(function(seasons) {
      if (!seasons || seasons.length === 0) return getFiles(showNb);
      var seasonData = null;
      for (var i = 0; i < seasons.length; i++) {
        var s = seasons[i];
        var sn = parseInt(s.season) || parseInt(s.seasonNumber) || (i + 1);
        if (sn === sNum) { seasonData = s; break; }
      }
      if (!seasonData && seasons.length >= sNum) seasonData = seasons[sNum - 1];
      if (!seasonData) return [];
      var episodes = seasonData.episodes || [];
      if (episodes.length === 0) return getFiles(showNb);
      var epNb = null;
      for (var j = 0; j < episodes.length; j++) {
        var ep = episodes[j];
        var en = parseInt(ep.episodeNummer) || parseInt(ep.episodeNumber) || (j + 1);
        if (en === eNum) { epNb = ep.nb; break; }
      }
      if (!epNb && episodes.length >= eNum) epNb = episodes[eNum - 1].nb;
      if (!epNb) return [];
      return getFiles(epNb);
    })
    .catch(function() { return getFiles(showNb); });
}

function getFiles(nb) {
  return fetchWithRetry(CINEMANA_API + "transcoddedFiles/id/" + nb)
    .then(function(r) { return r.json(); })
    .then(function(files) {
      var streams = [];
      var seen = {};
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var url = f.videoUrl || f.url || f.transcoddedFile || "";
        var q = f.resolution || f.quality || "HD";
        if (typeof q === "number") q = q + "p";
        q = q.toString().replace(/\s/g, "");
        if (url && !seen[url]) {
          seen[url] = true;
          streams.push({ name: "Cinemana", title: "Cinemana " + q, url: url, quality: q });
        }
      }
      var order = {"1080p": 0, "720p": 1, "480p": 2, "360p": 3, "240p": 4, "HD": 5};
      streams.sort(function(a, b) {
        return (order[a.quality] != null ? order[a.quality] : 9) - (order[b.quality] != null ? order[b.quality] : 9);
      });
      return streams;
    })
    .catch(function() { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else if (typeof global !== "undefined") {
  global.getStreams = getStreams;
}
