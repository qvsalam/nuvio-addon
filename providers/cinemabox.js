// CinemaBox Provider for Nuvio
// Hermes/React Native compatible - Promise chains only, no async/await

var CB_API = "https://cinema.albox.co/api/v4/";
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
  var cacheKey = "cb:" + tmdbId + ":" + mediaType + ":" + season + ":" + episode;
  var cached = cacheGet(cacheKey);
  if (cached) return Promise.resolve(cached);

  var path = "/" + (mediaType === "movie" ? "movie" : "tv") + "/" + tmdbId;
  var enUrl = TMDB_BASE + path + "?api_key=" + TMDB_API_KEY + "&language=en";
  var arUrl = TMDB_BASE + path + "?api_key=" + TMDB_API_KEY + "&language=ar";

  return Promise.all([
    fetch(enUrl).then(function(r) { return r.json(); }).catch(function() { return {}; }),
    fetch(arUrl).then(function(r) { return r.json(); }).catch(function() { return {}; })
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
      return searchCB(titles, 0, mediaType, season, episode, year);
    })
    .then(function(streams) {
      if (streams.length > 0) cacheSet(cacheKey, streams);
      return streams;
    })
    .catch(function() { return []; });
}

function searchCB(titles, idx, mediaType, season, episode, year) {
  if (idx >= titles.length) return [];
  return fetch(CB_API + "search?q=" + encodeURIComponent(titles[idx]))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.results || data.results.length === 0) {
        return searchCB(titles, idx + 1, mediaType, season, episode, year);
      }
      var targetType = mediaType === "movie" ? "MOVIE" : "SERIES";
      var candidates = [];
      for (var i = 0; i < data.results.length; i++) {
        if (data.results[i].type === targetType) candidates.push(data.results[i]);
      }
      if (candidates.length === 0) candidates = data.results;

      if (year) {
        var yearFiltered = [];
        for (var y = 0; y < candidates.length; y++) {
          if (candidates[y].year === year) yearFiltered.push(candidates[y]);
        }
        if (yearFiltered.length > 0) candidates = yearFiltered;
      }

      var best = candidates[0];
      var bestScore = 0;
      for (var s = 0; s < candidates.length; s++) {
        var score = similarity(titles[idx], candidates[s].title || "");
        if (score > bestScore) { bestScore = score; best = candidates[s]; }
      }

      if (!best) return searchCB(titles, idx + 1, mediaType, season, episode, year);
      return fetch(CB_API + "shows/shows/dynamic/" + best.id)
        .then(function(r2) { return r2.json(); })
        .then(function(detail) {
          if (!detail.post_info) return searchCB(titles, idx + 1, mediaType, season, episode, year);
          if (mediaType === "movie") {
            var epId = detail.post_info.episode_id;
            if (!epId) return [];
            return getPlayerStreams(epId);
          } else {
            return getTVStreams(detail, best.id, parseInt(season) || 1, parseInt(episode) || 1);
          }
        });
    })
    .catch(function() { return searchCB(titles, idx + 1, mediaType, season, episode, year); });
}

function getTVStreams(detail, showId, sNum, eNum) {
  var sections = detail.sections || [];
  var seasonItems = [];
  for (var i = 0; i < sections.length; i++) {
    var sec = sections[i];
    if (sec.data && sec.data.length > 0 && sec.data[0].card_type === "episode") {
      seasonItems = sec.data || [];
      break;
    }
  }
  if (seasonItems.length > 0 && eNum <= seasonItems.length) {
    var ep = seasonItems[eNum - 1];
    if (ep && ep.id) return getPlayerStreams(ep.id);
  }
  if (detail.post_info && detail.post_info.episode_id) {
    return getPlayerStreams(detail.post_info.episode_id);
  }
  return Promise.resolve([]);
}

function getPlayerStreams(episodeId) {
  return fetch(CB_API + "shows/episodes/player/" + episodeId)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var streams = [];
      var seen = {};
      var videos = data.videos || [];
      for (var i = 0; i < videos.length; i++) {
        var v = videos[i];
        if (v.url && !seen[v.url]) {
          seen[v.url] = true;
          var q = v.quality || "HD";
          if (typeof q === "number") q = q + "p";
          streams.push({ name: "CinemaBox", title: "CinemaBox " + q, url: v.url, quality: q });
        }
      }
      if (streams.length === 0) {
        var text = JSON.stringify(data);
        var re = /(https?:\/\/cloud[0-9]*\.albox\.co\/episodes\/[^"'\s,\]]+\.mp4)/gi;
        var m;
        while ((m = re.exec(text)) !== null) {
          if (!seen[m[1]]) {
            seen[m[1]] = true;
            streams.push({ name: "CinemaBox", title: "CinemaBox HD", url: m[1], quality: "HD" });
          }
        }
      }
      var order = {"1080p": 0, "1080": 0, "720p": 1, "720": 1, "480p": 2, "480": 2, "360p": 3, "360": 3, "HD": 4};
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
