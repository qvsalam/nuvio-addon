// ============================================
// Nuvio IPTV Provider v1.0.0
// Xtream Codes API Integration
// ============================================

// ---- CONFIGURATION ----
// Reads from Nuvio per-plugin settings (SCRAPER_SETTINGS) with hardcoded fallback
var _s = (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) ? SCRAPER_SETTINGS : {};
var XTREAM_URL = _s.xtream_url || "http://s.otbnver.club";
var XTREAM_USER = _s.xtream_user || "65874521487";
var XTREAM_PASS = _s.xtream_pass || "89808745219";
var TMDB_API_KEY = _s.tmdb_api_key || (typeof TMDB_API_KEY !== 'undefined' ? TMDB_API_KEY : "ee8ac8a9044c09a11cc362033f98c735");
// -----------------------

var BASE = XTREAM_URL + "/player_api.php?username=" + XTREAM_USER + "&password=" + XTREAM_PASS;

// Cache for VOD/series lists (avoid re-fetching every search)
var _vodCache = null;
var _seriesCache = null;

function log(msg) {
  console.log("[IPTV] " + msg);
}

// Fetch VOD list from Xtream
function getVodList() {
  if (_vodCache) {
    return Promise.resolve(_vodCache);
  }
  log("Fetching VOD list...");
  return fetch(BASE + "&action=get_vod_streams")
    .then(function(r) { return r.json(); })
    .then(function(list) {
      _vodCache = list || [];
      log("VOD list loaded: " + _vodCache.length + " items");
      return _vodCache;
    })
    .catch(function(e) {
      log("VOD list error: " + e.message);
      return [];
    });
}

// Fetch Series list from Xtream
function getSeriesList() {
  if (_seriesCache) {
    return Promise.resolve(_seriesCache);
  }
  log("Fetching Series list...");
  return fetch(BASE + "&action=get_series")
    .then(function(r) { return r.json(); })
    .then(function(list) {
      _seriesCache = list || [];
      log("Series list loaded: " + _seriesCache.length + " items");
      return _seriesCache;
    })
    .catch(function(e) {
      log("Series list error: " + e.message);
      return [];
    });
}

// Get series episodes info
function getSeriesInfo(seriesId) {
  log("Fetching series info for ID: " + seriesId);
  return fetch(BASE + "&action=get_series_info&series_id=" + seriesId)
    .then(function(r) { return r.json(); })
    .catch(function(e) {
      log("Series info error: " + e.message);
      return null;
    });
}

// Resolve TMDB ID to title
function getTmdbTitle(tmdbId, mediaType) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&language=en-US&append_to_response=alternative_titles,translations";
  log("TMDB lookup: " + type + "/" + tmdbId);
  return fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var titles = [];

      // Primary English title
      var primary = data.title || data.name || "";
      if (primary) titles.push(primary);

      // Original title
      var original = data.original_title || data.original_name || "";
      if (original && original !== primary) titles.push(original);

      // Arabic title from translations
      var translations = data.translations && data.translations.translations ? data.translations.translations : [];
      for (var i = 0; i < translations.length; i++) {
        var t = translations[i];
        if (t.iso_639_1 === "ar") {
          var arTitle = t.data && (t.data.title || t.data.name);
          if (arTitle) titles.push(arTitle);
          break;
        }
      }

      // Alternative titles
      var altKey = mediaType === "movie" ? "titles" : "results";
      var alts = data.alternative_titles && data.alternative_titles[altKey] ? data.alternative_titles[altKey] : [];
      for (var j = 0; j < alts.length; j++) {
        var alt = alts[j].title || alts[j].name || "";
        if (alt && titles.indexOf(alt) === -1) titles.push(alt);
      }

      var year = "";
      var dateStr = data.release_date || data.first_air_date || "";
      if (dateStr) year = dateStr.substring(0, 4);

      log("TMDB titles: " + titles.join(" | ") + " (" + year + ")");
      return { titles: titles, year: year };
    })
    .catch(function(e) {
      log("TMDB error: " + e.message);
      return { titles: [], year: "" };
    });
}

// Normalize string for matching
function normalize(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/[^\w\s\u0600-\u06FF]/g, "") // keep letters, numbers, spaces, Arabic
    .replace(/\s+/g, " ")
    .trim();
}

// Score how well two titles match
function matchScore(query, target) {
  var q = normalize(query);
  var t = normalize(target);
  if (!q || !t) return 0;

  // Exact match
  if (q === t) return 100;

  // One contains the other
  if (t.indexOf(q) !== -1) return 80;
  if (q.indexOf(t) !== -1) return 70;

  // Word-level overlap
  var qWords = q.split(" ");
  var tWords = t.split(" ");
  var matched = 0;
  for (var i = 0; i < qWords.length; i++) {
    for (var j = 0; j < tWords.length; j++) {
      if (qWords[i] === tWords[j] && qWords[i].length > 2) {
        matched++;
        break;
      }
    }
  }
  if (qWords.length > 0) {
    var pct = (matched / qWords.length) * 60;
    return Math.round(pct);
  }
  return 0;
}

// Find best matches from Xtream list
function findMatches(titles, year, list) {
  var results = [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    var itemName = item.name || "";
    var bestScore = 0;

    for (var j = 0; j < titles.length; j++) {
      var s = matchScore(titles[j], itemName);
      if (s > bestScore) bestScore = s;
    }

    // Boost if year matches
    if (year && itemName.indexOf(year) !== -1) {
      bestScore += 10;
    }

    // Also check tmdb field if Xtream has it
    if (item.tmdb && String(item.tmdb) !== "" && String(item.tmdb) !== "0") {
      // Some Xtream servers store TMDB IDs
      // We'll check this in the main flow
    }

    if (bestScore >= 50) {
      results.push({ item: item, score: bestScore });
    }
  }

  // Sort by score descending
  results.sort(function(a, b) { return b.score - a.score; });
  return results;
}

// Build VOD stream URL
function buildVodUrl(streamId, ext) {
  var extension = ext || "mp4";
  return XTREAM_URL + "/movie/" + XTREAM_USER + "/" + XTREAM_PASS + "/" + streamId + "." + extension;
}

// Build Series episode stream URL
function buildSeriesUrl(streamId, ext) {
  var extension = ext || "mp4";
  return XTREAM_URL + "/series/" + XTREAM_USER + "/" + XTREAM_PASS + "/" + streamId + "." + extension;
}

// Guess quality from stream info
function guessQuality(item) {
  var name = (item.name || "").toLowerCase();
  if (/4k|2160p|uhd/i.test(name)) return "4K";
  if (/1080p|fhd|full\s*hd/i.test(name)) return "1080p";
  if (/720p|hd/i.test(name)) return "720p";
  if (/480p|sd/i.test(name)) return "480p";
  return "HD";
}

// ============ MAIN FUNCTION ============

function getStreams(tmdbId, mediaType, season, episode) {
  log("Request: tmdb=" + tmdbId + " type=" + mediaType + " S" + (season || "-") + "E" + (episode || "-"));

  return getTmdbTitle(tmdbId, mediaType)
    .then(function(info) {
      if (!info.titles || info.titles.length === 0) {
        log("No title found for TMDB ID: " + tmdbId);
        return [];
      }

      if (mediaType === "movie") {
        return getVodList().then(function(vodList) {
          // First: check if any VOD has matching tmdb ID directly
          var tmdbMatches = [];
          for (var i = 0; i < vodList.length; i++) {
            if (vodList[i].tmdb && String(vodList[i].tmdb) === String(tmdbId)) {
              tmdbMatches.push({ item: vodList[i], score: 100 });
            }
          }

          var matches = tmdbMatches.length > 0 ? tmdbMatches : findMatches(info.titles, info.year, vodList);
          log("VOD matches: " + matches.length);

          var streams = [];
          // Take top 5 matches max
          var limit = Math.min(matches.length, 5);
          for (var m = 0; m < limit; m++) {
            var vod = matches[m].item;
            var ext = vod.container_extension || "mp4";
            var url = buildVodUrl(vod.stream_id, ext);
            streams.push({
              name: "IPTV",
              title: (vod.name || "Stream") + " [" + guessQuality(vod) + "]",
              url: url,
              quality: guessQuality(vod)
            });
          }
          return streams;
        });

      } else {
        // TV Series
        return getSeriesList().then(function(seriesList) {
          // Check TMDB ID match first
          var tmdbMatches = [];
          for (var i = 0; i < seriesList.length; i++) {
            if (seriesList[i].tmdb && String(seriesList[i].tmdb) === String(tmdbId)) {
              tmdbMatches.push({ item: seriesList[i], score: 100 });
            }
          }

          var matches = tmdbMatches.length > 0 ? tmdbMatches : findMatches(info.titles, info.year, seriesList);
          log("Series matches: " + matches.length);

          if (matches.length === 0) return [];

          // Get episode info for the best match
          var bestSeries = matches[0].item;
          var seriesId = bestSeries.series_id;
          log("Best series match: " + bestSeries.name + " (id:" + seriesId + ")");

          return getSeriesInfo(seriesId).then(function(seriesData) {
            if (!seriesData || !seriesData.episodes) {
              log("No episodes data");
              return [];
            }

            var seasonStr = String(season || 1);
            var episodeNum = parseInt(episode || 1);
            var seasonEps = seriesData.episodes[seasonStr];
            if (!seasonEps) {
              log("Season " + seasonStr + " not found. Available: " + Object.keys(seriesData.episodes).join(","));
              return [];
            }

            log("Season " + seasonStr + " has " + seasonEps.length + " episodes");

            var streams = [];
            for (var e = 0; e < seasonEps.length; e++) {
              var ep = seasonEps[e];
              var epNum = parseInt(ep.episode_num || 0);
              if (epNum === episodeNum) {
                var ext = ep.container_extension || "mp4";
                var url = buildSeriesUrl(ep.id, ext);
                var title = bestSeries.name + " S" + seasonStr + "E" + epNum;
                streams.push({
                  name: "IPTV",
                  title: title + " [" + guessQuality(ep) + "]",
                  url: url,
                  quality: guessQuality(ep)
                });
                log("Found episode: " + title + " → " + url);
              }
            }

            // If exact episode not found, list all episodes in that season
            if (streams.length === 0) {
              log("Exact episode E" + episodeNum + " not found, listing all in S" + seasonStr);
              for (var a = 0; a < seasonEps.length; a++) {
                var epA = seasonEps[a];
                var extA = epA.container_extension || "mp4";
                var urlA = buildSeriesUrl(epA.id, extA);
                streams.push({
                  name: "IPTV",
                  title: bestSeries.name + " S" + seasonStr + "E" + (epA.episode_num || (a + 1)),
                  url: urlA,
                  quality: guessQuality(epA)
                });
              }
            }

            return streams;
          });
        });
      }
    })
    .catch(function(err) {
      log("Fatal error: " + err.message);
      return [];
    });
}

module.exports = { getStreams: getStreams };
