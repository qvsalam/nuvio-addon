/**
 * Cinema Box (cinema.albox.co) - Nuvio Scraper
 * Version: 1.2.0
 * ISP-restricted: Iraqi networks only
 * Hermes-compatible: Promise chains, no async/await
 */

var CINEMA_API = 'https://cinema.albox.co/api/v4/';
var TMDB_KEY   = 'ee8ac8a9044c09a11cc362033f98c735';

function debugStream(msg) {
  return { name: 'CinemaBox-DEBUG', title: msg, url: 'https://example.com/debug.mp4', quality: 'DEBUG' };
}

function fetchJson(url) {
  return fetch(url, { headers: { 'Accept': 'application/json' } })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP_' + r.status + ':' + url.replace(CINEMA_API, ''));
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
  throw new Error('NO_URL:' + raw.slice(0, 150));
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
    if (!t) throw new Error('TMDB_NO_TITLE');
    return t;
  });
}

// ── Step 2: Search ────────────────────────────────────────────────────────────

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
      throw new Error('SEARCH_EMPTY keys=' + Object.keys(data).join(','));
    }
    var match = bestMatch(list, title);
    if (!match) throw new Error('NO_MATCH');
    return match;
  });
}

// ── Step 3: Show dynamic info ─────────────────────────────────────────────────
// Response structure: { post_info: { id, title, ... }, sections: [...] }

function getShowInfo(showId) {
  return fetchJson(CINEMA_API + 'shows/shows/dynamic/' + showId);
  // Return the raw response — we handle post_info/sections downstream
}

// Find seasons inside sections array
// sections entries may look like: { type: "seasons"|"episodes"|"player", data: [...] }
// or directly contain season objects
function findSeasonsInSections(sections) {
  if (!Array.isArray(sections)) return [];

  for (var i = 0; i < sections.length; i++) {
    var sec = sections[i];
    var t = (sec.type || sec.section_type || sec.name || '').toLowerCase();
    if (t.indexOf('season') !== -1 || t.indexOf('episode') !== -1 || t.indexOf('player') !== -1) {
      var d = sec.data || sec.seasons || sec.episodes || sec.items || [];
      if (Array.isArray(d) && d.length > 0) return d;
    }
  }

  // fallback: return data of first section that has an array
  for (var j = 0; j < sections.length; j++) {
    var keys = Object.keys(sections[j]);
    for (var k = 0; k < keys.length; k++) {
      if (Array.isArray(sections[j][keys[k]]) && sections[j][keys[k]].length > 0) {
        return sections[j][keys[k]];
      }
    }
  }
  return [];
}

// ── Step 4a: Movie stream ─────────────────────────────────────────────────────

function getMovieStream(raw, title) {
  var postInfo = raw.post_info || raw.data || raw.show || raw;
  var sections = raw.sections || [];

  // Try seasons from sections first
  var seasons = postInfo.seasons || postInfo.season || findSeasonsInSections(sections);

  // Also check if post_info has a direct player_id or season_id
  var directId = postInfo.season_id || postInfo.player_id || postInfo.episode_id;
  if (directId) {
    return fetchJson(CINEMA_API + 'shows/seasons/player/' + directId)
      .then(function(data) { return [makeStream(extractStreamUrl(data), title)]; });
  }

  if (!Array.isArray(seasons) || seasons.length === 0) {
    // Debug: show full sections structure
    var secInfo = JSON.stringify(sections).slice(0, 200);
    var piInfo  = JSON.stringify(postInfo).slice(0, 200);
    throw new Error('NO_SEASONS_V2 sec=' + secInfo + ' pi=' + piInfo);
  }

  // Try to call seasons/player with the first season's id
  var season = seasons[0];
  var seasonId = season.id || season._id || season.season_id;

  if (!seasonId) {
    // Maybe the seasons array IS the player response directly (has url)
    if (season.url || season.stream_url) {
      return Promise.resolve([makeStream(extractStreamUrl(season), title)]);
    }
    throw new Error('SEASON_NO_ID keys=' + Object.keys(season).join(','));
  }

  return fetchJson(CINEMA_API + 'shows/seasons/player/' + seasonId)
    .then(function(data) { return [makeStream(extractStreamUrl(data), title)]; });
}

// ── Step 4b: Episode stream ───────────────────────────────────────────────────

function getEpisodeStream(raw, sNum, eNum, title) {
  var postInfo = raw.post_info || raw.data || raw.show || raw;
  var sections = raw.sections || [];
  var seasons  = postInfo.seasons || postInfo.season || findSeasonsInSections(sections);

  if (!Array.isArray(seasons) || seasons.length === 0) {
    throw new Error('NO_SEASONS_TV keys=' + Object.keys(raw).join(','));
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
          var showId = show.id || show._id || show.show_id;
          if (!showId) {
            return [debugStream('SHOW_NO_ID keys=' + Object.keys(show).join(','))];
          }
          return getShowInfo(showId)
            .then(function(raw) {
              if (mediaType === 'movie') return getMovieStream(raw, title);
              return getEpisodeStream(raw, parseInt(season, 10) || 1, parseInt(episode, 10) || 1, title);
            });
        })
        .catch(function(err) {
          return [debugStream('[CB] ' + (err.message || String(err)))];
        });
    })
    .catch(function(err) {
      return [debugStream('[CB-TMDB] ' + (err.message || String(err)))];
    });
}

module.exports = { getStreams: getStreams };
