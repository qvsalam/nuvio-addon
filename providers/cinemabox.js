/**
 * Cinema Box (cinema.albox.co) - Nuvio Scraper
 * Version: 1.1.0 - Debug edition
 * ISP-restricted: Iraqi networks only
 * Hermes-compatible: Promise chains, no async/await
 */

var CINEMA_API = 'https://cinema.albox.co/api/v4/';
var TMDB_KEY   = 'ee8ac8a9044c09a11cc362033f98c735';

// Returns a fake "debug" stream so errors are visible in Nuvio's stream list
function debugStream(msg) {
  return { name: 'CinemaBox-DEBUG', title: msg, url: 'https://example.com/debug.mp4', quality: 'DEBUG' };
}

function fetchJson(url) {
  return fetch(url, { headers: { 'Accept': 'application/json' } })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP_' + r.status + ' → ' + url.replace(CINEMA_API, ''));
      return r.json();
    });
}

function normalise(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, ' ').replace(/\s+/g, ' ').trim();
}

function bestMatch(list, needle) {
  var norm = normalise(needle);
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    var cands = [s.title, s.title_en, s.name, s.original_title, s.original_name];
    for (var j = 0; j < cands.length; j++) {
      if (cands[j] && normalise(cands[j]) === norm) return s;
    }
  }
  return list[0] || null;
}

function extractStreamUrl(data) {
  var d = data.data || data;
  if (d.url)        return d.url;
  if (d.stream_url) return d.stream_url;
  if (d.video_url)  return d.video_url;
  if (d.link)       return d.link;
  var sources = d.sources || d.qualities || d.links || [];
  if (Array.isArray(sources) && sources.length > 0) {
    var best = sources[0];
    for (var i = 1; i < sources.length; i++) {
      if (parseInt(sources[i].quality || 0) > parseInt(best.quality || 0)) best = sources[i];
    }
    return best.url || best.link || best.src;
  }
  var raw = JSON.stringify(d);
  var mp4 = raw.match(/https?:\/\/[^"\\]*\.mp4/);
  var hls = raw.match(/https?:\/\/[^"\\]*\.m3u8/);
  if (mp4) return mp4[0];
  if (hls) return hls[0];
  throw new Error('NO_URL_IN: ' + raw.slice(0, 120));
}

function makeStream(url, title) {
  var isHls = url.indexOf('.m3u8') !== -1;
  var q = /1080/i.test(url) ? '1080p' : /720/i.test(url) ? '720p' : /480/i.test(url) ? '480p' : isHls ? 'HLS' : 'HD';
  return { name: 'Cinema Box', title: 'CinemaBox ' + q, url: url, quality: q };
}

// ── Step 1: TMDB ──────────────────────────────────────────────────────────────

function getTmdbTitle(tmdbId, mediaType) {
  var url = 'https://api.themoviedb.org/3/' + (mediaType === 'movie' ? 'movie' : 'tv') +
            '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=en-US';
  return fetchJson(url).then(function(d) {
    var t = d.title || d.name || d.original_title || d.original_name;
    if (!t) throw new Error('TMDB_NO_TITLE id=' + tmdbId);
    return t;
  });
}

// ── Step 2: Search — tries multiple endpoint patterns ─────────────────────────

function searchCinemaBox(title) {
  // Try endpoint 1: search?q=
  var url1 = CINEMA_API + 'search?q=' + encodeURIComponent(title) + '&page_size=15';
  return fetchJson(url1)
    .then(function(data) {
      return resolveList(data, title, 'search?q=');
    })
    .catch(function(e1) {
      // Try endpoint 2: shows/shows?search= 
      var url2 = CINEMA_API + 'shows/shows?search=' + encodeURIComponent(title) + '&page_size=15';
      return fetchJson(url2)
        .then(function(data) {
          return resolveList(data, title, 'shows/shows?search=');
        })
        .catch(function(e2) {
          // Try endpoint 3: shows/shows?q=
          var url3 = CINEMA_API + 'shows/shows?q=' + encodeURIComponent(title) + '&page_size=15';
          return fetchJson(url3)
            .then(function(data) {
              return resolveList(data, title, 'shows/shows?q=');
            })
            .catch(function(e3) {
              throw new Error('SEARCH_FAILED | ' + e1.message + ' | ' + e2.message + ' | ' + e3.message);
            });
        });
    });
}

function resolveList(data, title, endpoint) {
  var list = data.results || data.shows || data.data || data;
  if (!Array.isArray(list)) {
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(data[keys[i]])) { list = data[keys[i]]; break; }
    }
  }
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('EMPTY_RESULTS via ' + endpoint + ' keys=' + Object.keys(data).join(','));
  }
  var match = bestMatch(list, title);
  if (!match) throw new Error('NO_MATCH via ' + endpoint);
  match._usedEndpoint = endpoint;
  return match;
}

// ── Step 3: Show info ─────────────────────────────────────────────────────────

function getShowInfo(showId) {
  return fetchJson(CINEMA_API + 'shows/shows/dynamic/' + showId)
    .then(function(d) { return d.data || d.show || d; });
}

// ── Step 4a: Movie stream ─────────────────────────────────────────────────────

function getMovieStream(showInfo, title) {
  var seasons = showInfo.seasons || showInfo.season || [];
  if (!Array.isArray(seasons) || seasons.length === 0) {
    if (showInfo.url) return Promise.resolve([makeStream(showInfo.url, title)]);
    throw new Error('NO_SEASONS id=' + showInfo.id + ' keys=' + Object.keys(showInfo).join(','));
  }
  var seasonId = seasons[0].id || seasons[0]._id;
  if (!seasonId) throw new Error('SEASON_NO_ID keys=' + Object.keys(seasons[0]).join(','));
  return fetchJson(CINEMA_API + 'shows/seasons/player/' + seasonId)
    .then(function(data) { return [makeStream(extractStreamUrl(data), title)]; });
}

// ── Step 4b: Episode stream ───────────────────────────────────────────────────

function getEpisodeStream(showInfo, sNum, eNum, title) {
  var seasons = showInfo.seasons || showInfo.season || [];
  if (!Array.isArray(seasons) || seasons.length === 0) {
    throw new Error('NO_SEASONS_TV id=' + showInfo.id);
  }
  var seasonObj = null;
  for (var i = 0; i < seasons.length; i++) {
    var n = parseInt(seasons[i].season_number || seasons[i].sort_order || seasons[i].number || (i + 1), 10);
    if (n === sNum) { seasonObj = seasons[i]; break; }
  }
  if (!seasonObj) seasonObj = seasons[Math.max(0, sNum - 1)] || seasons[0];

  var episodes = seasonObj.episodes || [];
  if (episodes.length === 0 && seasonObj.id) {
    return fetchJson(CINEMA_API + 'shows/seasons/player/' + seasonObj.id)
      .then(function(d) { return playEpisode(d.episodes || d.data || [], eNum, title); });
  }
  return playEpisode(episodes, eNum, title);
}

function playEpisode(episodes, eNum, title) {
  var ep = null;
  for (var i = 0; i < episodes.length; i++) {
    var n = parseInt(episodes[i].episode_number || episodes[i].number || episodes[i].sort_order || (i + 1), 10);
    if (n === eNum) { ep = episodes[i]; break; }
  }
  if (!ep) ep = episodes[Math.max(0, eNum - 1)] || episodes[0];
  if (!ep) throw new Error('EP_NOT_FOUND ep=' + eNum + ' total=' + episodes.length);
  var epId = ep.id || ep._id;
  if (!epId) throw new Error('EP_NO_ID keys=' + Object.keys(ep).join(','));
  return fetchJson(CINEMA_API + 'shows/episodes/player/' + epId)
    .then(function(data) { return [makeStream(extractStreamUrl(data), title)]; });
}

// ── Main ──────────────────────────────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  return getTmdbTitle(tmdbId, mediaType)
    .then(function(title) {
      return searchCinemaBox(title)
        .then(function(show) {
          var showId = show.id || show._id;
          if (!showId) throw new Error('SHOW_NO_ID keys=' + Object.keys(show).join(','));
          return getShowInfo(showId)
            .then(function(info) {
              if (mediaType === 'movie') return getMovieStream(info, title);
              return getEpisodeStream(info, parseInt(season, 10) || 1, parseInt(episode, 10) || 1, title);
            });
        })
        .catch(function(err) {
          // Return debug stream so error is visible in Nuvio
          return [debugStream('[CB] ' + (err.message || String(err)))];
        });
    })
    .catch(function(err) {
      return [debugStream('[CB-TMDB] ' + (err.message || String(err)))];
    });
}

module.exports = { getStreams: getStreams };
