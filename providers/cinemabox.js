/**
 * Cinema Box (cinema.albox.co) - Nuvio Scraper
 * Version: 1.0.0
 * ISP-restricted: Iraqi networks only
 * Hermes-compatible: Promise chains, no async/await
 */

var CINEMA_API = 'https://cinema.albox.co/api/v4/';
var TMDB_KEY   = 'ee8ac8a9044c09a11cc362033f98c735';

// ── helpers ───────────────────────────────────────────────────────────────────

function fetchJson(url) {
  return fetch(url, {
    headers: { 'Accept': 'application/json' }
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

function normalise(str) {
  return String(str || '').toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bestMatch(shows, needle) {
  var norm = normalise(needle);
  var best = null;
  for (var i = 0; i < shows.length; i++) {
    var s = shows[i];
    var candidates = [s.title, s.title_en, s.name, s.original_title, s.original_name];
    for (var j = 0; j < candidates.length; j++) {
      if (candidates[j] && normalise(candidates[j]) === norm) return s;
    }
    if (!best) best = s;
  }
  return best;
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

  // last resort – scan raw JSON for .mp4 / .m3u8
  var raw = JSON.stringify(d);
  var mp4 = raw.match(/https?:\/\/[^"\\]*\.mp4/);
  var hls = raw.match(/https?:\/\/[^"\\]*\.m3u8/);
  if (mp4) return mp4[0];
  if (hls) return hls[0];
  throw new Error('CinemaBox: no stream URL in player response');
}

function makeStream(url, title) {
  var isHls = url.indexOf('.m3u8') !== -1;
  var q = 'HD';
  if (/1080/i.test(url)) q = '1080p';
  else if (/720/i.test(url)) q = '720p';
  else if (/480/i.test(url)) q = '480p';
  else if (isHls) q = 'HLS';
  return { name: 'Cinema Box', title: 'CinemaBox ' + q, url: url, quality: q };
}

// ── step 1: TMDB ID → title ───────────────────────────────────────────────────

function getTmdbTitle(tmdbId, mediaType) {
  var endpoint = (mediaType === 'movie') ? 'movie' : 'tv';
  var url = 'https://api.themoviedb.org/3/' + endpoint + '/' + tmdbId +
            '?api_key=' + TMDB_KEY + '&language=en-US';
  return fetchJson(url).then(function(d) {
    var t = d.title || d.name || d.original_title || d.original_name;
    if (!t) throw new Error('TMDB: no title for id=' + tmdbId);
    return t;
  });
}

// ── step 2: search Cinema Box ─────────────────────────────────────────────────

function searchCinemaBox(title) {
  var url = CINEMA_API + 'search?q=' + encodeURIComponent(title) + '&page_size=15';
  return fetchJson(url).then(function(data) {
    var list = data.results || data.shows || data.data || data;
    if (!Array.isArray(list)) {
      var keys = Object.keys(data);
      for (var i = 0; i < keys.length; i++) {
        if (Array.isArray(data[keys[i]])) { list = data[keys[i]]; break; }
      }
    }
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error('CinemaBox: no results for "' + title + '"');
    }
    var match = bestMatch(list, title);
    if (!match) throw new Error('CinemaBox: no match for "' + title + '"');
    return match;
  });
}

// ── step 3: show dynamic info ─────────────────────────────────────────────────

function getShowInfo(showId) {
  return fetchJson(CINEMA_API + 'shows/shows/dynamic/' + showId)
    .then(function(d) { return d.data || d.show || d; });
}

// ── step 4a: movie → seasons/player ──────────────────────────────────────────

function getMovieStream(showInfo, title) {
  var seasons = showInfo.seasons || showInfo.season || [];
  if (!Array.isArray(seasons) || seasons.length === 0) {
    if (showInfo.url) return Promise.resolve([makeStream(showInfo.url, title)]);
    throw new Error('CinemaBox: no seasons for movie id=' + showInfo.id);
  }
  var seasonId = seasons[0].id || seasons[0]._id;
  if (!seasonId) throw new Error('CinemaBox: season has no id');
  return fetchJson(CINEMA_API + 'shows/seasons/player/' + seasonId)
    .then(function(data) {
      return [makeStream(extractStreamUrl(data), title)];
    });
}

// ── step 4b: series → episodes/player ────────────────────────────────────────

function getEpisodeStream(showInfo, sNum, eNum, title) {
  var seasons = showInfo.seasons || showInfo.season || [];
  if (!Array.isArray(seasons) || seasons.length === 0) {
    throw new Error('CinemaBox: no seasons for series id=' + showInfo.id);
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
      .then(function(d) {
        var eps = d.episodes || d.data || [];
        return playEpisode(eps, eNum, title);
      });
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
  if (!ep) throw new Error('CinemaBox: episode ' + eNum + ' not found');

  var epId = ep.id || ep._id;
  if (!epId) throw new Error('CinemaBox: episode has no id');

  return fetchJson(CINEMA_API + 'shows/episodes/player/' + epId)
    .then(function(data) {
      return [makeStream(extractStreamUrl(data), title)];
    });
}

// ── main entry point ──────────────────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  return getTmdbTitle(tmdbId, mediaType)
    .then(function(title) {
      return searchCinemaBox(title).then(function(show) {
        var showId = show.id || show._id;
        if (!showId) throw new Error('CinemaBox: show has no id');

        return getShowInfo(showId).then(function(info) {
          if (mediaType === 'movie') {
            return getMovieStream(info, title);
          } else {
            var sn = parseInt(season, 10) || 1;
            var en = parseInt(episode, 10) || 1;
            return getEpisodeStream(info, sn, en, title);
          }
        });
      });
    })
    .catch(function(err) {
      console.log('[CinemaBox]', err.message || String(err));
      return [];
    });
}

module.exports = { getStreams: getStreams };
