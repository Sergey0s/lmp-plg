/*
 * Кнопка «Продолжить» на карточке фильма/сериала, восстановление позиции,
 * фоновый prefetch торрента, окно буферизации.
 * © 2026 · Sergey0s · github.com/Sergey0s
 *
 */
(function () {
  'use strict';

    var PLUGIN_VERSION = '147';

  if (window.continue_watch_plugin) return;
  window.continue_watch_plugin = PLUGIN_VERSION;

  // =========================================================================
  // 1. Константы
  // =========================================================================
  var PLUGIN_ID = 'continue_watch_plus';
  var MENU_DATA_ACTION = PLUGIN_ID;
  var COMPONENT_ID = 'continue_watch_diag';
  var PLUGIN_NAME = 'Продолжить';

  var MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
  var STORAGE_DEBOUNCE_MS = 2000;
  var TIMELINE_THROTTLE_MS = 2000;
  var CLICK_DEBOUNCE_MS = 1000;
  var MENU_RETRY_MAX = 40;
  var MENU_RETRY_MS = 500;

  var BUFFER_DEFAULT_PCT = 10;
  var BUFFER_MIN_SPEED = 50 * 1024;
  var BUFFER_POLL_MS = 1000;
  var BUFFER_SETTING_KEY = 'cw_buffer_modal';
  var BUFFER_PCT_KEY = 'cw_buffer_pct';

  var PREFETCH_KEY = 'cw_prefetch';
  var PREFETCH_TARGET_KEY = 'cw_prefetch_target';
  var PREFETCH_TARGET_DEF = 5;
  var PREFETCH_POLL_MS = 1500;
  var PREFETCH_TIMEOUT_MS = 120000;
  var ECO_MODE_KEY = 'cw_eco_mode';

  var SMART_NEXT_PCT = 92;
  var SMART_NEXT_CONFIRM_KEY = 'cw_smart_next_confirm';
  var EXIT_SUMMARY_KEY = 'cw_exit_summary';
  var EXIT_SUMMARY_COOLDOWN_MS = 60 * 1000;
  var EXIT_SUMMARY_MIN_TIME_S = 5;
  var TIMELINE_STORE_KEY = 'file_view';

  var MIGRATION_FLAG_KEY = 'continue_watch_params__migrated_to_profiles';
  var TORR_ALT_KEYS = [
    'torrserver_url',
    'torrserver_url_two',
    'torrserver',
    'torr_server',
    'torr_url',
    'ts_url',
    'tsurl',
  ];

  // =========================================================================
  // 2. Runtime state
  // =========================================================================
  var DEBUG = false;

  var S = {
    booted: false,
    account_ready: !!window.appready,
    active_key: null,
    synced_key: null,
    mem: null,
    title_index: null,
    ts_url: null,
    files: {},
    full_events: 0,
    button_injected: 0,
    play_intercepted: 0,
    prefetched: 0,
    last_prefetched_link: null,
    last_prefetched_index: null,
    prefetch_hash: null,
    prefetch_link: null,
    prefetch_index: null,
    prefetch_pct: 0,
    prefetch_speed: 0,
    prefetch_started_at: 0,
    prefetch_target_reached: false,
    prefetch_poll_iv: 0,
    prefetch_xhr: null,
    last_full_title: null,
    last_full_movie: null,
    last_full_render: null,
    last_play_url: null,
    last_lookup: null,
    last_tick: 0,
    last_card_refresh_at: 0,
    last_player_hash: null,
    last_player_card: null,
    session_play_hash: null,
    session_play_card: null,
    last_launched_card: null,
    last_launched_at: 0,
    last_exit_summary_at: 0,
    last_exit_summary_hash: null,
    modal_open: false,
    files_pending: {},
    cleanup_count: 0,
    last_cleanup_at: 0,
    last_cleanup_reason: '',
    buffer_close: null,
    boot_at: 0,
    boot_heap_used: 0,
    timeline_updates: 0,
    file_view_changes: 0,
    ts_requests: 0,
    ts_request_errors: 0,
    active_xhrs: 0,
  };

  var TIMERS = {save: 0, click: 0};
  var LISTENERS = {player_start: null, player_destroy: null};

  // =========================================================================
  // 3. Logger (ленивый — не строит timestamp когда DEBUG=false)
  // =========================================================================
  function _ts() {
    var d = new Date();
    var p2 = function (n) {
      return n < 10 ? '0' + n : '' + n;
    };
    var p3 = function (n) {
      return n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n;
    };
    return (
      p2(d.getHours()) +
      ':' +
      p2(d.getMinutes()) +
      ':' +
      p2(d.getSeconds()) +
      '.' +
      p3(d.getMilliseconds())
    );
  }

  function log() {
    if (!DEBUG || !window.console || !console.log) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[CW ' + _ts() + ']');
    try {
      console.log.apply(console, args);
    } catch (e) {}
  }

  function warn() {
    if (!window.console || !console.warn) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[CW ' + _ts() + ']');
    try {
      console.warn.apply(console, args);
    } catch (e) {}
  }

  function safe(name, fn) {
    try {
      return fn();
    } catch (e) {
      warn(name + ' failed:', e);
    }
  }

  // =========================================================================
  // 4. Утилиты
  // =========================================================================
  function pickTitle(movie) {
    if (!movie) return '';
    return (
      movie.original_name ||
      movie.original_title ||
      movie.name ||
      movie.title ||
      ''
    );
  }

  function noty(text) {
    try {
      Lampa.Noty.show(text);
    } catch (e) {}
  }

  // ===== длинный toast (свой), нужен потому что Lampa.Noty гасится за ~1.5с
  // и не успеваешь прочитать стек ошибки. Показываем на 10с, до 4 одновременно.
  // Хранится глобально (window.cw_errors) чтобы можно было вызвать cw.errors().
  var CW_TOAST_MS = 10000;
  var CW_TOAST_MAX = 4;
  function cwToast(msg, kind) {
    if (!window.cw_errors) window.cw_errors = [];
    window.cw_errors.push({ at: Date.now(), kind: kind || 'info', msg: String(msg) });
    if (window.cw_errors.length > 50) window.cw_errors.shift();
    try {
      var box = document.getElementById('cw-toast-box');
      if (!box) {
        box = document.createElement('div');
        box.id = 'cw-toast-box';
        box.style.cssText =
          'position:fixed;left:1em;bottom:1em;z-index:99999;display:flex;flex-direction:column;gap:.5em;max-width:80vw;pointer-events:none';
        document.body.appendChild(box);
      }
      while (box.children.length >= CW_TOAST_MAX) box.removeChild(box.firstChild);
      var color = kind === 'err' ? '#f55' : kind === 'warn' ? '#fc7' : '#7c7';
      var el = document.createElement('div');
      el.style.cssText =
        'background:rgba(0,0,0,.85);border-left:.3em solid ' + color +
        ';padding:.7em 1em;border-radius:.4em;color:#fff;font-size:.95em;' +
        'font-family:monospace;white-space:pre-wrap;word-break:break-all;' +
        'box-shadow:0 4px 18px rgba(0,0,0,.5);max-height:40vh;overflow-y:auto';
      el.textContent = '[cw] ' + msg;
      box.appendChild(el);
      setTimeout(function () { try { el.remove(); } catch (e) {} }, CW_TOAST_MS);
    } catch (e) {}
  }

  function cwError(label, err) {
    var msg = label + ': ' + ((err && err.message) || err || 'unknown');
    if (err && err.stack) msg += '\n' + String(err.stack).split('\n').slice(0, 6).join('\n');
    cwToast(msg, 'err');
    try { console.warn('[CW]', label, err && err.stack ? err.stack : err); } catch (e) {}
  }

  function hookLampaNoty() {
    try {
      if (!Lampa || !Lampa.Noty || !Lampa.Noty.show || Lampa.Noty.__cw_hooked) return;
      var originalShow = Lampa.Noty.show;
      Lampa.Noty.show = function (text) {
        try {
          var msg = String(text || '');
          if (msg && (msg.indexOf('error') !== -1 || msg.indexOf('Error') !== -1 || msg.indexOf('ошиб') !== -1)) {
            cwToast('Lampa.Noty: ' + msg, 'err');
          }
        } catch (e) {}
        return originalShow.apply(this, arguments);
      };
      Lampa.Noty.__cw_hooked = true;
    } catch (e) {}
  }

  // глобальный перехватчик: показываем только ошибки, что прилетели из нашего плагина
  // (по filename: cw.js / lmp-plg / sergey0s). Это не зашумляет нас ошибками самой Lampa.
  (function () {
    if (window.__cw_onerror_installed) return;
    window.__cw_onerror_installed = true;
    window.addEventListener('error', function (e) {
      try {
        var fn = (e && (e.filename || (e.error && e.error.fileName))) || '';
        var src = String(fn).toLowerCase();
        var stack = (e && e.error && e.error.stack) || '';
        var fromUs =
          src.indexOf('cw.js') !== -1 ||
          src.indexOf('lmp-plg') !== -1 ||
          src.indexOf('sergey0s') !== -1 ||
          stack.indexOf('cw.js') !== -1;
        if (!fromUs) return;
        cwError(
          'window.error ' + (e.lineno || '?') + ':' + (e.colno || '?'),
          e.error || e.message
        );
      } catch (err) {}
    });
    window.addEventListener('unhandledrejection', function (e) {
      try {
        var r = e && (e.reason || e.detail);
        var stack = (r && r.stack) || '';
        if (stack.indexOf('cw.js') === -1 && stack.indexOf('lmp-plg') === -1) return;
        cwError('unhandled promise', r);
      } catch (err) {}
    });
  })();

  function formatTime(seconds) {
    if (!seconds) return '';
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = Math.floor(seconds % 60);
    var mm = (m < 10 ? '0' : '') + m;
    var ss = (s < 10 ? '0' : '') + s;
    return h > 0 ? h + ':' + mm + ':' + ss : m + ':' + ss;
  }

  function normUrl(u) {
    if (!u || typeof u !== 'string') return '';
    u = u.trim();
    if (!u) return '';
    if (!u.match(/^https?:\/\//)) u = 'http://' + u;
    return u.replace(/\/$/, '');
  }

  function fmtBytes(n) {
    n = +n || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function fmtSpeed(n) {
    if (!n || n < 1024) return '0 KB/s';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB/s';
    return (n / 1048576).toFixed(2) + ' MB/s';
  }

  function fmtEta(seconds) {
    if (!seconds || seconds === Infinity || seconds < 0) return '—';
    if (seconds < 60) return Math.ceil(seconds) + ' с';
    if (seconds < 3600) return Math.ceil(seconds / 60) + ' мин';
    return (seconds / 3600).toFixed(1) + ' ч';
  }

  function fmtUptime(ms) {
    if (!ms || ms < 0) return '—';
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    if (h > 0) return h + 'ч ' + m + 'м ' + sec + 'с';
    if (m > 0) return m + 'м ' + sec + 'с';
    return sec + 'с';
  }

  function fmtSignedBytes(n) {
    var sign = n >= 0 ? '+' : '−';
    return sign + fmtBytes(Math.abs(n));
  }

  function safeLampa() {
    return (
      typeof window.Lampa !== 'undefined' &&
      Lampa &&
      Lampa.Storage &&
      Lampa.Listener
    );
  }

  function getBoolPref(key, def) {
    var v = safe('storageGet', function () {
      return Lampa.Storage.get(key, def);
    });
    return v !== false && v !== 'false' && v !== 0 && v !== '0';
  }

  function getIntPref(key, def, max) {
    var v = safe('storageGet', function () {
      return Lampa.Storage.get(key, def);
    });
    v = parseInt(v, 10);
    if (isNaN(v) || v < 0) v = def;
    if (typeof max === 'number' && v > max) v = max;
    return v;
  }

  function generateHash(movie, season, episode) {
    var title = pickTitle(movie);
    if (movie && movie.number_of_seasons && season && episode) {
      var sep = season > 10 ? ':' : '';
      return Lampa.Utils.hash([season, sep, episode, title].join(''));
    }
    return Lampa.Utils.hash(title);
  }

  // =========================================================================
  // 5. Storage: ключ, sync, кэш, индекс по title
  // =========================================================================
  function storageKey() {
    try {
      var a = Lampa.Account;
      if (
        S.account_ready &&
        a &&
        a.Permit &&
        a.Permit.sync &&
        a.Permit.account &&
        a.Permit.account.profile &&
        typeof a.Permit.account.profile.id !== 'undefined'
      ) {
        return 'continue_watch_params_' + a.Permit.account.profile.id;
      }
    } catch (e) {}
    return 'continue_watch_params';
  }

  function activeKey() {
    var k = storageKey();
    if (S.active_key !== k) {
      log('storage key:', S.active_key, '->', k);
      S.active_key = k;
      S.mem = null;
      S.title_index = null;
    }
    return k;
  }

  function ensureSync() {
    if (!safeLampa()) return;
    var k = activeKey();
    if (S.synced_key !== k) {
      safe('Storage.sync', function () {
        Lampa.Storage.sync(k, 'object_object');
      });
      S.synced_key = k;
    }
  }

  function readParams() {
    ensureSync();
    if (!S.mem) {
      S.mem =
        safe('Storage.get', function () {
          return Lampa.Storage.get(activeKey(), {});
        }) || {};
      S.title_index = null;
    }
    return S.mem;
  }

  function writeParams(data, force) {
    ensureSync();
    S.mem = data;
    S.title_index = null;
    if (TIMERS.save) clearTimeout(TIMERS.save);
    var k = activeKey();
    var flush = function () {
      safe('Storage.set', function () {
        Lampa.Storage.set(k, data);
      });
      if (DEBUG) log('write key=' + k);
    };
    if (force) flush();
    else TIMERS.save = setTimeout(flush, STORAGE_DEBOUNCE_MS);
  }

  function buildIndex() {
    var ix = {};
    var p = S.mem || {};
    for (var hash in p) {
      var t = p[hash] && p[hash].title;
      if (!t) continue;
      if (!ix[t]) ix[t] = [];
      ix[t].push(hash);
    }
    S.title_index = ix;
    return ix;
  }

  function updateEntry(hash, data) {
    var params = readParams();
    var isNew = !params[hash];
    if (isNew) params[hash] = {};

    // Не позволяем обнулять duration уже сохранённой записи: внешние плееры
    // (ViMu и др.) присылают через Lampa.Timeline.update timeline с
    // duration=0 при ended=true, мы бы потеряли реальную длительность,
    // нужную для смарт-next и UI.
    if (
      data &&
      typeof data.duration === 'number' &&
      data.duration === 0 &&
      params[hash] &&
      typeof params[hash].duration === 'number' &&
      params[hash].duration > 0
    ) {
      data = (function () {
        var c = {};
        for (var k in data) c[k] = data[k];
        delete c.duration;
        return c;
      })();
    }

    var changed = false;
    for (var k in data) {
      if (data[k] === undefined) continue;
      if (params[hash][k] !== data[k]) {
        params[hash][k] = data[k];
        changed = true;
      }
    }
    if (changed || !params[hash].timestamp) {
      params[hash].timestamp = Date.now();
      var critical = data.percent && data.percent > 90;
      writeParams(params, critical);
      if (DEBUG)
        log(
          (isNew ? 'NEW ' : 'UPD ') +
            'hash=' +
            hash +
            ' S=' +
            data.season +
            ' E=' +
            data.episode +
            ' %=' +
            data.percent +
            ' t=' +
            data.time
        );
    }
  }

  function cleanupOldParams() {
    safe('cleanup', function () {
      var params = readParams();
      var now = Date.now();
      var changed = false;
      for (var h in params) {
        if (params[h].timestamp && now - params[h].timestamp > MAX_AGE_MS) {
          delete params[h];
          changed = true;
        }
      }
      if (changed) {
        writeParams(params, true);
        log('cleanup: removed stale entries');
      }
    });
  }

  // =========================================================================
  // 6. TorrServer URL
  // =========================================================================
  function torrUrl() {
    if (S.ts_url !== null) return S.ts_url;
    var url = '';
    safe('torrUrl', function () {
      var useTwo = Lampa.Storage.field('torrserver_use_link') == 'two';
      var u1 = normUrl(Lampa.Storage.get('torrserver_url'));
      var u2 = normUrl(Lampa.Storage.get('torrserver_url_two'));
      url = useTwo ? u2 || u1 : u1 || u2;

      if (!url) {
        for (var i = 0; i < TORR_ALT_KEYS.length; i++) {
          var c = normUrl(Lampa.Storage.get(TORR_ALT_KEYS[i]));
          if (c) {
            url = c;
            log('TorrServer in alt key:', TORR_ALT_KEYS[i], '->', c);
            break;
          }
        }
      }
    });
    S.ts_url = url || '';
    return S.ts_url;
  }

  function dumpTorrKeys() {
    var found = {};
    for (var i = 0; i < TORR_ALT_KEYS.length; i++) {
      var v = safe('torrDump', function () {
        return Lampa.Storage.get(TORR_ALT_KEYS[i]);
      });
      if (v) found[TORR_ALT_KEYS[i]] = v;
    }
    return found;
  }

  // =========================================================================
  // 7. Поиск / построение URL
  // =========================================================================
  function findStreamParams(movie) {
    if (!movie) return null;
    var title = pickTitle(movie);
    if (!title) return null;

    var params = readParams();
    var ix = S.title_index || buildIndex();

    if (movie.number_of_seasons) {
      var best = null,
        bestTs = 0;
      var hashes = ix[title] || [];
      for (var i = 0; i < hashes.length; i++) {
        var p = params[hashes[i]];
        if (p && p.season && p.episode && p.timestamp > bestTs) {
          bestTs = p.timestamp;
          best = p;
        }
      }
      S.last_lookup = {
        kind: 'series',
        title: title,
        total: Object.keys(params).length,
        matched: hashes.length,
        found: !!best,
      };
      log(
        'lookup series title="' +
          title +
          '" matched=' +
          hashes.length +
          ' found=' +
          !!best
      );
      return best;
    }

    var hash = Lampa.Utils.hash(title);
    var f = params[hash] || null;
    S.last_lookup = {
      kind: 'movie',
      title: title,
      hash: hash,
      total: Object.keys(params).length,
      found: !!f,
    };
    log('lookup movie title="' + title + '" found=' + !!f);
    return f;
  }

  function findEpisodeParams(movie, season, episode) {
    if (!movie || !season || !episode) return null;
    var title = pickTitle(movie);
    var params = readParams();
    var ix = S.title_index || buildIndex();
    var hashes = ix[title] || [];
    var best = null;
    var bestTs = 0;
    for (var i = 0; i < hashes.length; i++) {
      var ep = params[hashes[i]];
      if (ep && ep.season === season && ep.episode === episode) {
        var ts = ep.timestamp || 0;
        if (!best || ts >= bestTs) {
          best = ep;
          bestTs = ts;
        }
      }
    }
    return best;
  }

  function findNextEpisodeParams(movie, current) {
    if (!current || !current.season || !current.episode) return null;
    var nxt = findEpisodeParams(movie, current.season, current.episode + 1);
    if (nxt) return nxt;
    return findEpisodeParams(movie, current.season + 1, 1);
  }

  function fileToEpisodeParams(movie, current, file) {
    if (!movie || !current || !file || !current.torrent_link) return null;
    var title = pickTitle(movie);
    var info = null;
    safe('parseNextFile', function () {
      info = Lampa.Torserver.parse({
        movie: movie,
        files: [file],
        filename: file.path.split('/').pop(),
        path: file.path,
        is_file: true,
      });
    });
    if (!info || !info.season || !info.episode) return null;
    if (
      movie.number_of_seasons &&
      info.season !== current.season &&
      !(info.season === current.season + 1 && info.episode === 1)
    )
      return null;
    return {
      file_name: file.path,
      torrent_link: current.torrent_link,
      file_index: file.id || 0,
      title: title,
      season: info.season,
      episode: info.episode,
      percent: 0,
      time: 0,
      duration: 0,
      synthetic_next: true,
    };
  }

  function findNextEpisodeFromFiles(movie, current) {
    if (!current || !current.torrent_link) return null;
    var files = S.files[current.torrent_link];
    if (!files || !files.length) return null;

    var targetSeason = current.season;
    var targetEpisode = current.episode + 1;
    var fallback = null;

    for (var i = 0; i < files.length; i++) {
      var p = fileToEpisodeParams(movie, current, files[i]);
      if (!p) continue;
      if (p.season === targetSeason && p.episode === targetEpisode) return p;
      if (!fallback && p.season === current.season + 1 && p.episode === 1)
        fallback = p;
    }
    return fallback;
  }

  function findPrevEpisodeParams(movie, current) {
    if (!current || !current.season || !current.episode) return null;
    if (current.episode > 1) {
      return findEpisodeParams(movie, current.season, current.episode - 1);
    }
    if (current.season > 1) {
      var title = pickTitle(movie);
      var params = readParams();
      var ix = S.title_index || buildIndex();
      var hashes = ix[title] || [];
      var bestEp = 0,
        best = null;
      for (var i = 0; i < hashes.length; i++) {
        var p = params[hashes[i]];
        if (p && p.season === current.season - 1 && p.episode > bestEp) {
          bestEp = p.episode;
          best = p;
        }
      }
      return best;
    }
    return null;
  }

  // Возвращает { params, isNext } или null. Источник percent — НАШ params
  // (единственный авторитет): Lampa.Timeline.view(hash) может вернуть
  // закэшированное в памяти значение даже после resetEntry/clearTimelineEntry,
  // и тогда smart-next ложно срабатывает на «досмотренном» эпизоде.
  // target всегда указывает на ПОСЛЕДНИЙ запущенный эпизод (params=current),
  // чтобы кнопка «Продолжить SxEy» показывала именно его процент/время.
  // Если он почти досмотрен (pct >= SMART_NEXT_PCT) и есть следующий —
  // кладём его в nextParams: при клике откроем confirm-модал с выбором
  // «Продолжить» / «Следующий», без тихого прыжка.
  function pickContinueTarget(movie) {
    var current = findStreamParams(movie);
    if (!current) return null;

    var pct = typeof current.percent === 'number' ? current.percent : 0;
    var isSeries = !!(
      movie.number_of_seasons &&
      current.season &&
      current.episode
    );

    if (pct >= SMART_NEXT_PCT) {
      if (!isSeries) {
        if (S.last_lookup)
          S.last_lookup.reason = 'movie watched >= ' + SMART_NEXT_PCT + '%';
        return null;
      }
      var next =
        findNextEpisodeParams(movie, current) ||
        findNextEpisodeFromFiles(movie, current);
      if (!next) {
        if (S.last_lookup)
          S.last_lookup.reason = 'next episode not in history, showing current';
        return {params: current, hasNext: false};
      }
      if (next.synthetic_next && S.last_lookup)
        S.last_lookup.reason = 'next episode from torrent files';
      return {
        params: current,
        hasNext: true,
        nextParams: next,
        currentPercent: Math.floor(pct),
      };
    }
    return {params: current, hasNext: false};
  }

  function cloneFresh(p) {
    var c = {};
    for (var k in p) c[k] = p[k];
    c.time = 0;
    c.percent = 0;
    return c;
  }

  // Сбросить in-memory кэш Lampa.Timeline для конкретного hash (обнуляем percent/time,
  // duration сохраняем, чтобы наш listener не записал duration=0 поверх реального).
  // + удаляем запись из Lampa.Storage[file_view] на случай, если cache читается лениво.
  function clearTimelineEntry(hash) {
    var p = readParams();
    var existingDuration = (p[hash] && p[hash].duration) || 0;
    safe('Timeline.update.invalidate', function () {
      if (Lampa.Timeline && Lampa.Timeline.update) {
        Lampa.Timeline.update({
          hash: hash,
          percent: 0,
          time: 0,
          duration: existingDuration,
        });
      }
    });
    safe('Timeline.storage.delete', function () {
      var fv = Lampa.Storage.get(TIMELINE_STORE_KEY, {});
      if (fv && fv[hash]) {
        delete fv[hash];
        Lampa.Storage.set(TIMELINE_STORE_KEY, fv);
      }
    });
  }

  // Если в S.prefetch_* лежит state для конкретного torrent_link — снимаем его.
  // Нужно после resetEntry, иначе buffer-modal берёт закэшированный
  // S.prefetch_hash и опрашивает TorrServer, который мог уже выгрузить торрент
  // (idle TTL). Polls возвращают пустые stats → modal висит без данных.
  function clearPrefetchIfMatches(torrentLink) {
    if (!torrentLink || S.last_prefetched_link !== torrentLink) return;
    log('clearing prefetch state for ' + String(torrentLink).slice(0, 60));
    stopPrefetchPoll();
    S.last_prefetched_link = null;
    S.prefetch_link = null;
    S.prefetch_hash = null;
    S.prefetch_pct = 0;
    S.prefetch_speed = 0;
    S.prefetch_target_reached = false;
  }

  // «Сбросить прогресс» — обнулить запись (percent=0, time=0), но НЕ удалять.
  // Запись остаётся, чтобы кнопка «Продолжить» продолжала её показывать,
  // и при клике плеер стартовал с начала.
  function resetEntry(hash) {
    var p = readParams();
    var torrentLink = p[hash] && p[hash].torrent_link;
    if (p[hash]) {
      p[hash].percent = 0;
      p[hash].time = 0;
      p[hash].timestamp = Date.now();
      writeParams(p, true);
    }
    clearTimelineEntry(hash);
    clearPrefetchIfMatches(torrentLink);
  }

  function markWatched(hash, params) {
    var p = readParams();
    var dur = params.duration || (p[hash] && p[hash].duration) || 0;
    if (p[hash]) {
      p[hash].percent = 100;
      p[hash].time = dur;
      p[hash].timestamp = Date.now();
      writeParams(p, true);
    }
    safe('Timeline.mark.update', function () {
      if (Lampa.Timeline && Lampa.Timeline.update) {
        Lampa.Timeline.update({
          hash: hash,
          percent: 100,
          time: dur,
          duration: dur,
        });
      }
    });
    safe('Timeline.mark.storage', function () {
      var fv = Lampa.Storage.get(TIMELINE_STORE_KEY, {});
      fv[hash] = {hash: hash, percent: 100, time: dur, duration: dur};
      Lampa.Storage.set(TIMELINE_STORE_KEY, fv);
    });
  }

  function buildStreamUrl(p) {
    if (!p || !p.file_name || !p.torrent_link) return null;
    var url = torrUrl();
    if (!url) {
      noty('TorrServer не настроен');
      return null;
    }
    var q = ['link=' + p.torrent_link, 'index=' + (p.file_index || 0), 'play'];
    return (
      url + '/stream/' + encodeURIComponent(p.file_name) + '?' + q.join('&')
    );
  }

  // =========================================================================
  // 7.5 Извлечение infohash из magnet + add через GET /stream:
  //
  // POST /torrents (action=add) с Content-Type:application/json требует
  // CORS preflight → TorrServer на ANSWER без CORS-заголовков → браузер
  // режет с onerror = «сеть/CORS». Не используем POST add вообще.
  //
  // BitTorrent infohash вшит в magnet (xt=urn:btih:<hash>), извлекаем его
  // на клиенте. Дальше:
  //   1. triggerPreload (GET /stream/...?preload) — simple CORS, не нужен
  //      preflight; TorrServer auto-add'ит торрент и начинает качать.
  //   2. Polling через POST /torrents action=get — это та же ручка, что
  //      использует префетч и она у юзера работает (значит CORS на этом
  //      коде проходит).
  // =========================================================================
  var B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  var B32_VAL = (function () {
    var o = {};
    for (var bi = 0; bi < B32_ALPHABET.length; bi++)
      o[B32_ALPHABET.charAt(bi)] = bi;
    return o;
  })();

  function base32ToHex(str) {
    var bitsParts = [];
    for (var i = 0; i < str.length; i++) {
      var v = B32_VAL[str.charAt(i)];
      if (v === undefined) return null;
      var b = v.toString(2);
      while (b.length < 5) b = '0' + b;
      bitsParts.push(b);
    }
    var bits = bitsParts.join('');
    var hex = '';
    for (var j = 0; j + 4 <= bits.length; j += 4) {
      hex += parseInt(bits.substr(j, 4), 2).toString(16);
    }
    return hex.toLowerCase().slice(0, 40);
  }

  function magnetToHash(magnet) {
    if (!magnet) return null;
    var raw = String(magnet);
    var variants = [raw];
    try {
      variants.push(decodeURIComponent(raw));
    } catch (e) {}
    try {
      variants.push(decodeURIComponent(decodeURIComponent(raw)));
    } catch (e) {}

    for (var i = 0; i < variants.length; i++) {
      var s = variants[i];
      var hex =
        s.match(/[?&]xt=urn:bt[im]h:([a-fA-F0-9]{40})/i) ||
        s.match(/urn:bt[im]h:([a-fA-F0-9]{40})/i);
      if (hex) return hex[1].toLowerCase();
      var b32 =
        s.match(/[?&]xt=urn:bt[im]h:([a-zA-Z2-7]{32})/i) ||
        s.match(/urn:bt[im]h:([a-zA-Z2-7]{32})/i);
      if (b32) {
        var h = base32ToHex(b32[1].toUpperCase());
        if (h) return h;
      }
    }
    return null;
  }

  // Async-only API для совместимости с прошлым кодом (prefetch / modal).
  // Если magnet валидный — отдаём хеш моментально без сети.
  // Если хеш извлечь не получилось — фолбэк через tsAddTorrent (POST /torrents
  // add). На большинстве TorrServer'ов он не работает из-за CORS, но для
  // нестандартных ссылок другого варианта нет.
  var inflightHash = {};

  function getTorrentHash(opts, onSuccess, onError) {
    var link = opts && opts.link;
    if (!link) {
      if (onError) onError(new Error('пустая ссылка'));
      return;
    }

    var rawHash = String(link).match(/^[a-fA-F0-9]{40}$/);
    if (rawHash) {
      log('hash from raw infohash: ' + String(link).slice(0, 16) + '…');
      if (onSuccess) onSuccess({hash: String(link).toLowerCase()});
      return;
    }

    var localHash = magnetToHash(link);
    if (localHash) {
      log('hash from magnet: ' + localHash.slice(0, 16) + '…');
      if (onSuccess) onSuccess({hash: localHash});
      return;
    }

    warn(
      'hash not extractable from link, falling back to POST add. link prefix: ' +
        String(link).slice(0, 160)
    );

    if (inflightHash[link]) {
      inflightHash[link].cb.push(onSuccess);
      if (onError) inflightHash[link].err.push(onError);
      log(
        'hash dedup: subscribed to in-flight request for ' +
          String(link).slice(0, 60)
      );
      return;
    }
    inflightHash[link] = {cb: [onSuccess], err: onError ? [onError] : []};

    tsAddTorrent(
      link,
      opts.title,
      opts.poster,
      function (json) {
        var entry = inflightHash[link];
        delete inflightHash[link];
        if (!entry) return;
        json.hash = json.hash || json.Hash;
        for (var i = 0; i < entry.cb.length; i++) {
          try {
            entry.cb[i](json);
          } catch (e) {
            warn('getTorrentHash cb', e);
          }
        }
      },
      function (err) {
        var entry = inflightHash[link];
        delete inflightHash[link];
        warn('getTorrentHash failed: ' + (err && err.message));
        if (!entry) return;
        for (var i = 0; i < entry.err.length; i++) {
          try {
            entry.err[i](err);
          } catch (e) {}
        }
      }
    );
  }

  function tsAddTorrent(link, title, poster, onOk, onErr) {
    var url = torrUrl();
    if (!url) {
      if (onErr) onErr(new Error('TorrServer URL не настроен'));
      return;
    }
    var xhr = new XMLHttpRequest();
    try {
      xhr.open('POST', url + '/torrents', true);
      xhr.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
      xhr.timeout = 15000;
      xhr.onload = function () {
        var raw = xhr.responseText || '';
        if (xhr.status >= 200 && xhr.status < 300) {
          var json = null;
          try {
            json = raw ? JSON.parse(raw) : {};
          } catch (e) {}
          if (json && (json.hash || json.Hash)) {
            if (onOk) onOk(json);
          } else if (onErr)
            onErr(new Error('пустой hash в ответе: ' + raw.slice(0, 120)));
        } else if (onErr) {
          onErr(new Error('HTTP ' + xhr.status + ' ' + raw.slice(0, 120)));
        }
      };
      xhr.onerror = function () {
        if (onErr)
          onErr(
            new Error(
              'CORS на /torrents add (TorrServer жив, но не пускает) или сеть упала'
            )
          );
      };
      xhr.ontimeout = function () {
        if (onErr) onErr(new Error('TorrServer не ответил (15с)'));
      };
      xhr.send(
        JSON.stringify({
          action: 'add',
          link: link,
          title: title || '',
          poster: poster || '',
        })
      );
    } catch (e) {
      if (onErr) onErr(e);
    }
  }

  // =========================================================================
  // 8. Плейлист эпизодов сериала (тихая догрузка в фоне)
  // =========================================================================
  function loadEpisodesPlaylist(
    movie,
    currentParams,
    currentUrl,
    done,
    currentResumeTime
  ) {
    var title = pickTitle(movie);
    var allParams = readParams();
    var playlist = [];
    var hasResume =
      typeof currentResumeTime === 'number' && currentResumeTime > 0;

    for (var hash in allParams) {
      var p = allParams[hash];
      if (p.title === title && p.season && p.episode) {
        var epHash = generateHash(movie, p.season, p.episode);
        var tl = Lampa.Timeline.view(epHash);
        var isCur =
          p.season === currentParams.season &&
          p.episode === currentParams.episode;
        var pos;
        if (isCur) {
          pos = hasResume ? currentResumeTime : tl ? tl.time || -1 : -1;
          if (hasResume && tl) {
            tl.time = currentResumeTime;
          }
        } else {
          pos = -1;
        }
        playlist.push({
          title: p.episode_title || 'S' + p.season + ' E' + p.episode,
          season: p.season,
          episode: p.episode,
          timeline: tl,
          torrent_hash: p.torrent_hash || p.torrent_link,
          card: movie,
          url: isCur ? currentUrl : buildStreamUrl(p),
          position: pos,
        });
      }
    }

    if (!currentParams.torrent_link) {
      done(playlist);
      return;
    }

    var processFiles = function (files) {
      S.files[currentParams.torrent_link] = files;
      setTimeout(function () {
        delete S.files[currentParams.torrent_link];
      }, 300000);

      var seen = {};
      for (var j = 0; j < playlist.length; j++)
        seen[playlist[j].season + '_' + playlist[j].episode] = 1;

      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        safe('parseFile', function () {
          var info = Lampa.Torserver.parse({
            movie: movie,
            files: [file],
            filename: file.path.split('/').pop(),
            path: file.path,
            is_file: true,
          });
          if (movie.number_of_seasons && info.season !== currentParams.season)
            return;
          var key = info.season + '_' + info.episode;
          if (seen[key]) return;

          var epHash = generateHash(movie, info.season, info.episode);
          var tl = Lampa.Timeline.view(epHash) || {
            hash: epHash,
            percent: 0,
            time: 0,
            duration: 0,
          };

          if (!allParams[epHash]) {
            updateEntry(epHash, {
              file_name: file.path,
              torrent_link: currentParams.torrent_link,
              file_index: file.id || 0,
              title: title,
              season: info.season,
              episode: info.episode,
              percent: 0,
              time: 0,
              duration: 0,
            });
          }

          var isCur =
            info.season === currentParams.season &&
            info.episode === currentParams.episode;
          var pos;
          if (isCur) {
            pos = hasResume ? currentResumeTime : tl.time || -1;
            if (hasResume) tl.time = currentResumeTime;
          } else {
            pos = -1;
          }
          playlist.push({
            title: movie.number_of_seasons
              ? 'S' + info.season + ' E' + info.episode
              : movie.title || title,
            season: info.season,
            episode: info.episode,
            timeline: tl,
            torrent_hash: currentParams.torrent_link,
            card: movie,
            url:
              isCur ||
              (file.id === currentParams.file_index && !movie.number_of_seasons)
                ? currentUrl
                : buildStreamUrl({
                    file_name: file.path,
                    torrent_link: currentParams.torrent_link,
                    file_index: file.id || 0,
                  }),
            position: pos,
          });
          seen[key] = 1;
        });
      }

      if (movie.number_of_seasons)
        playlist.sort(function (a, b) {
          return a.episode - b.episode;
        });
      done(playlist);
    };

    if (S.files[currentParams.torrent_link]) {
      processFiles(S.files[currentParams.torrent_link]);
      return;
    }

    getTorrentHash(
      {
        link: currentParams.torrent_link,
        title: title,
        poster: movie.poster_path,
      },
      function (torrent) {
        if (!torrent || !torrent.hash) {
          done(playlist);
          return;
        }
        var tries = 0;
        var fetch = function () {
          safe('Torserver.files', function () {
            Lampa.Torserver.files(
              torrent.hash,
              function (json) {
                if (json && json.file_stats && json.file_stats.length)
                  processFiles(json.file_stats);
                else if (tries++ < 5) setTimeout(fetch, tries * 1000);
                else done(playlist);
              },
              function () {
                if (tries++ < 5) setTimeout(fetch, tries * 1000);
                else done(playlist);
              }
            );
          });
        };
        fetch();
      },
      function () {
        done(playlist);
      }
    );
  }

  // =========================================================================
  // 8.5 Окно буферизации (опрос TorrServer перед стартом плеера)
  // =========================================================================
  // Simple CORS POST: Content-Type: text/plain не требует preflight'а.
  // TorrServer (Go) парсит body по содержимому, а не по Content-Type, так что
  // отправлять валидный JSON безопасно. Это критично для дефолтных сборок
  // TorrServer без CORS-обвязки на OPTIONS.
  function tsRequest(action, body, onOk, onErr) {
    var url = torrUrl();
    if (!url) {
      onErr && onErr(new Error('no torrserver'));
      return;
    }
    var xhr = new XMLHttpRequest();
    S.ts_requests++;
    S.active_xhrs++;
    var done = false;
    var finish = function () {
      if (done) return;
      done = true;
      S.active_xhrs = Math.max(0, S.active_xhrs - 1);
    };
    try {
      xhr.open('POST', url + '/torrents', true);
      xhr.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
      xhr.timeout = 5000;
      xhr.onload = function () {
        finish();
        if (xhr.status >= 200 && xhr.status < 300) {
          var json = null;
          try {
            json = xhr.responseText ? JSON.parse(xhr.responseText) : {};
          } catch (e) {}
          onOk && onOk(json || {});
        } else {
          S.ts_request_errors++;
          if (onErr) onErr(new Error('http ' + xhr.status));
        }
      };
      xhr.onerror = function () {
        finish();
        S.ts_request_errors++;
        onErr && onErr(new Error('network'));
      };
      xhr.ontimeout = function () {
        finish();
        S.ts_request_errors++;
        onErr && onErr(new Error('timeout'));
      };
      var payload = {action: action};
      if (body) for (var k in body) payload[k] = body[k];
      xhr.send(JSON.stringify(payload));
    } catch (e) {
      finish();
      S.ts_request_errors++;
      onErr && onErr(e);
    }
  }

  // GET /echo — TorrServer health-check. Simple CORS, без preflight'а.
  // Используем чтобы отличить «сервер мёртв» от «сервер жив, но CORS режет».
  function tsPing(onAlive, onDead) {
    var url = torrUrl();
    if (!url) {
      onDead && onDead(new Error('TorrServer URL не настроен'));
      return;
    }
    var xhr = new XMLHttpRequest();
    try {
      xhr.open('GET', url + '/echo', true);
      xhr.timeout = 3000;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 400) onAlive && onAlive();
        else
          onDead && onDead(new Error('TorrServer ответил HTTP ' + xhr.status));
      };
      xhr.onerror = function () {
        onDead && onDead(new Error('TorrServer недоступен (сеть)'));
      };
      xhr.ontimeout = function () {
        onDead && onDead(new Error('TorrServer не ответил за 3с'));
      };
      xhr.send();
    } catch (e) {
      onDead && onDead(e);
    }
  }

  function triggerPreload(streamUrl, keepAliveMs) {
    var preUrl = streamUrl.replace(/[?&]play(&|$)/, '$1').replace(/[?&]$/, '');
    preUrl += (preUrl.indexOf('?') !== -1 ? '&' : '?') + 'preload';
    try {
      var x = new XMLHttpRequest();
      x.open('GET', preUrl, true);
      x.timeout = keepAliveMs || 5000;
      x.onerror = function () {};
      x.ontimeout = function () {};
      x.send();
      return x;
    } catch (e) {
      return null;
    }
  }

  function prefetchEnabled() {
    return getBoolPref(PREFETCH_KEY, true);
  }
  function prefetchTarget() {
    return getIntPref(PREFETCH_TARGET_KEY, PREFETCH_TARGET_DEF, 100);
  }

  function stopPrefetchPoll() {
    if (S.prefetch_poll_iv) {
      clearInterval(S.prefetch_poll_iv);
      S.prefetch_poll_iv = 0;
    }
    if (S.prefetch_xhr) {
      try {
        S.prefetch_xhr.abort();
      } catch (e) {}
      S.prefetch_xhr = null;
    }
  }

  function ecoModeEnabled() {
    return getBoolPref(ECO_MODE_KEY, true);
  }

  function memorySnapshot() {
    var m =
      window.performance && performance.memory ? performance.memory : null;
    if (!m) return null;
    return {
      used: m.usedJSHeapSize || 0,
      total: m.totalJSHeapSize || 0,
      limit: m.jsHeapSizeLimit || 0,
    };
  }

  function cleanupRuntime(reason) {
    stopPrefetchPoll();
    S.files = {};
    S.files_pending = {};
    S.last_prefetched_link = null;
    S.last_prefetched_index = null;
    S.prefetch_link = null;
    S.prefetch_index = null;
    S.prefetch_hash = null;
    S.prefetch_pct = 0;
    S.prefetch_speed = 0;
    S.prefetch_target_reached = false;
    if (S.buffer_close) {
      safe('buffer.close.cleanup', function () {
        S.buffer_close();
      });
      S.buffer_close = null;
    }
    S.cleanup_count++;
    S.last_cleanup_at = Date.now();
    S.last_cleanup_reason = reason || 'manual';
    log('runtime cleanup: ' + S.last_cleanup_reason);
    S.session_play_hash = null;
    S.session_play_card = null;
  }

  function scheduleReturnRefresh(reason) {
    if (!S.last_launched_card) return;
    if (Date.now() - S.last_launched_at > 10 * 60 * 1000) return;
    log('schedule return refresh: ' + (reason || 'unknown'));
    scheduleCardButtonRefresh(S.last_launched_card);
  }

  function flushProgressAfterExternalReturn(reason) {
    var h = S.last_player_hash || S.session_play_hash;
    if (!h) return;
    log(
      'resume flush timeline → storage (' +
        (reason || '') +
        ') hash=' +
        String(h).slice(0, 12) +
        '…'
    );
    var ok = syncEntryFromFileView(h);
    if (!ok) flushHashFromTimeline(h);
    flushPendingWrites();
    if (ok) {
      var card =
        S.last_player_card || S.session_play_card || S.last_launched_card;
      if (card) maybeShowExitSummary(card, h, 'external.return');
    }
  }

  // Lampa Android вызывает Lampa.Timeline.update() уже после нашего focus/
  // visible-эвента (нативный onActivityResult → evaluateJavascript идёт
  // асинхронно). Делаем серию проб с расширяющимися интервалами, чтобы
  // гарантированно подцепить запись file_view, как только она попадёт
  // в Storage. Stop-условие: timeline уже синхронизирован успешно.
  function scheduleResumeFlushes(reason) {
    var attempts = [120, 380, 900, 1800, 3200, 5000];
    var card =
      S.last_player_card || S.session_play_card || S.last_launched_card;
    for (var i = 0; i < attempts.length; i++) {
      (function (delay) {
        setTimeout(function () {
          if (document.hidden) return;
          flushProgressAfterExternalReturn(reason);
          if (card) {
            S.last_card_refresh_at = 0;
            refreshActiveCardSoon(card, 'resume #' + delay);
          }
        }, delay);
      })(attempts[i]);
    }
  }

  function attachLifecycleCleanup() {
    var cleanupIfEco = function (reason) {
      if (ecoModeEnabled()) cleanupRuntime(reason);
    };
    var onAppBecameActive = function (reason) {
      scheduleResumeFlushes(reason);
      scheduleReturnRefresh(reason);
    };
    safe('lifecycle.cleanup', function () {
      window.addEventListener('pagehide', function () {
        cleanupIfEco('pagehide');
      });
      window.addEventListener('focus', function () {
        onAppBecameActive('window.focus');
      });
      window.addEventListener('pageshow', function () {
        onAppBecameActive('pageshow');
      });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) onAppBecameActive('visible');
      });
    });
  }

  // Заранее тянем file_stats у TorrServer'а, чтобы при клике «Продолжить»
  // плейлист эпизодов был готов синхронно. Иначе Lampa.Player.play получает
  // короткий [current] плейлист и автоматический next-episode не работает —
  // плеер просто закрывается на конце текущего файла.
  function refreshActiveCardIfMatches(movie) {
    safe('refreshActiveCardIfMatches', function () {
      var act = Lampa.Activity.active && Lampa.Activity.active();
      var activeMovie = act && (act.movie || (act.activity && act.activity.movie));
      var render = act && (
        (act.render && act.render()) ||
        (act.activity && act.activity.render && act.activity.render())
      );
      var expectedTitle = pickTitle(movie);

      // На Android TV после возврата из внешнего плеера Activity.active()
      // иногда временно указывает не на full-карточку или отдаёт activity без
      // movie/render, хотя DOM карточки остаётся на экране. Поэтому храним
      // последний render из full:complite и используем его как fallback.
      if (
        (!activeMovie || !render || pickTitle(activeMovie) !== expectedTitle) &&
        S.last_full_render &&
        pickTitle(S.last_full_movie) === expectedTitle
      ) {
        activeMovie = S.last_full_movie;
        render = S.last_full_render;
        log('active card refresh: using cached full render');
      }

      if (!activeMovie || !render) return;
      if (pickTitle(activeMovie) !== expectedTitle) return;
      var oldBtn = render.find('.button--continue-watch').first();
      if (oldBtn.length) oldBtn.remove();
      _runInject(activeMovie, render, {skipPrefetch: true});
    });
  }

  function refreshActiveCardSoon(movie, reason) {
    if (!movie) return;
    var now = Date.now();
    if (now - S.last_card_refresh_at < 1500) return;
    S.last_card_refresh_at = now;
    setTimeout(function () {
      // Если у нас открыт Select-модал (smart-next / exit-summary /
      // context-menu) — рефрешить карточку нельзя: refreshActiveCardIfMatches
      // → _runInject → lockButtonFocus → Lampa.Controller.collectionFocus
      // переключает контроллер, и Select мгновенно закрывается. Отложим до
      // закрытия модала.
      if (S.modal_open) {
        S.last_card_refresh_at = 0;
        setTimeout(function () {
          refreshActiveCardSoon(movie, (reason || 'unknown') + ' deferred');
        }, 600);
        return;
      }
      log('active card refresh: ' + (reason || 'unknown'));
      refreshActiveCardIfMatches(movie);
    }, 80);
  }

  function prefetchFilesList(torrentLink, hash, movie, params) {
    if (!hash || !torrentLink) return;
    if (S.files[torrentLink] || S.files_pending[torrentLink]) return;
    if (!Lampa.Torserver || !Lampa.Torserver.files) return;
    S.files_pending[torrentLink] = true;
    safe('Torserver.files.prefetch', function () {
      Lampa.Torserver.files(
        hash,
        function (json) {
          delete S.files_pending[torrentLink];
          if (json && json.file_stats && json.file_stats.length) {
            S.files[torrentLink] = json.file_stats;
            log(
              'files prefetched: ' +
                json.file_stats.length +
                ' for ' +
                torrentLink.slice(0, 60)
            );
            if (
              movie &&
              params &&
              params.percent >= SMART_NEXT_PCT &&
              findNextEpisodeFromFiles(movie, params)
            ) {
              refreshActiveCardIfMatches(movie);
            }
            setTimeout(function () {
              delete S.files[torrentLink];
            }, 600000);
          }
        },
        function () {
          delete S.files_pending[torrentLink];
        }
      );
    });
  }

  function prefetchTorrent(movie, params) {
    if (!prefetchEnabled()) return;
    if (!params || !params.torrent_link || !params.file_name) return;
    if (!torrUrl()) return;
    // TorrServer preload работает per-file (по index в торренте). При смене
    // эпизода в том же торренте index меняется → старый prefetch для нового
    // файла бесполезен. Сравниваем link + index, а не только link.
    var idx = typeof params.file_index === 'number' ? params.file_index : 0;
    var sameTarget =
      S.last_prefetched_link === params.torrent_link &&
      S.last_prefetched_index === idx;
    if (sameTarget && S.prefetch_target_reached) {
      log('prefetch skip: same link+index, target already reached');
      return;
    }
    if (sameTarget && S.prefetch_poll_iv) {
      log('prefetch skip: same link+index, polling already in progress');
      return;
    }

    var url = buildStreamUrl(params);
    if (!url) return;

    stopPrefetchPoll();
    S.last_prefetched_link = params.torrent_link;
    S.last_prefetched_index = idx;
    S.prefetched++;
    S.prefetch_link = params.torrent_link;
    S.prefetch_index = idx;
    S.prefetch_hash = null;
    S.prefetch_pct = 0;
    S.prefetch_speed = 0;
    S.prefetch_target_reached = false;
    S.prefetch_started_at = Date.now();

    var title = pickTitle(movie);
    var target = prefetchTarget();
    log(
      'prefetch start: "' +
        title +
        '"' +
        (params.season ? ' S' + params.season + 'E' + params.episode : '') +
        ' file_index=' +
        idx +
        ' target=' +
        target +
        '%'
    );

    getTorrentHash(
      {
        link: params.torrent_link,
        title: title,
        poster: movie.poster_path,
      },
      function (torrent) {
        var hash = torrent && (torrent.hash || torrent.Hash);
        if (!hash) {
          log('prefetch: no hash returned');
          return;
        }
        if (S.last_prefetched_link !== params.torrent_link) {
          log('prefetch: card changed, abort');
          return;
        }

        S.prefetch_hash = hash;
        log('prefetch: hash=' + hash.slice(0, 16) + '…');

        S.prefetch_xhr = triggerPreload(url, PREFETCH_TIMEOUT_MS);

        if (movie.number_of_seasons)
          prefetchFilesList(params.torrent_link, hash, movie, params);

        var poll = function () {
          if (
            S.prefetch_link !== params.torrent_link ||
            S.prefetch_index !== idx
          ) {
            stopPrefetchPoll();
            return;
          }
          if (Date.now() - S.prefetch_started_at > PREFETCH_TIMEOUT_MS) {
            log('prefetch: timeout, last %=' + S.prefetch_pct);
            stopPrefetchPoll();
            return;
          }
          tsRequest('get', {hash: hash}, function (info) {
            if (
              S.prefetch_link !== params.torrent_link ||
              S.prefetch_index !== idx
            )
              return;
            var preBytes = info.preloaded_bytes || info.PreloadedBytes || 0;
            var preSize = info.preload_size || info.PreloadSize || 0;
            var pct =
              preSize > 0
                ? Math.min(100, Math.round((preBytes / preSize) * 100))
                : 0;
            S.prefetch_pct = pct;
            S.prefetch_speed = info.download_speed || info.DownloadSpeed || 0;

            if (pct >= target) {
              S.prefetch_target_reached = true;
              log(
                'prefetch: target ' +
                  target +
                  '% reached (' +
                  pct +
                  '%), stopping background poll'
              );
              stopPrefetchPoll();
            }
          });
        };
        poll();
        S.prefetch_poll_iv = setInterval(poll, PREFETCH_POLL_MS);
      },
      function () {
        log('prefetch: hash failed');
      }
    );
  }

  function bufferingEnabled() {
    return getBoolPref(BUFFER_SETTING_KEY, true);
  }
  function bufferThreshold() {
    return getIntPref(BUFFER_PCT_KEY, BUFFER_DEFAULT_PCT, 100);
  }

  function showBufferModal(opts) {
    var movie = opts.movie;
    var params = opts.params;
    var streamUrl = opts.url;
    var threshold = bufferThreshold();

    var hash = null;
    var pollIv = 0;
    var aborted = false;
    var launched = false;
    var prevController = null;
    try {
      prevController =
        Lampa.Controller.enabled() && Lampa.Controller.enabled().name;
    } catch (e) {}

    var fileLabel = (params.file_name || '').split('/').pop();
    var pollStartedAt = Date.now();
    var zeroStatsPolls = 0;
    var pollErrors = 0;

    var modal = $(
      '<div class="cw-buf">' +
        '<div class="cw-buf__card">' +
        '<div class="cw-buf__head">' +
        '<div class="cw-buf__spinner"></div>' +
        '<div>' +
        '<div class="cw-buf__title">Подготовка к воспроизведению</div>' +
        '<div class="cw-buf__sub"></div>' +
        '</div>' +
        '</div>' +
        '<div class="cw-buf__file"></div>' +
        '<div class="cw-buf__bar"><div class="cw-buf__bar-fill"></div></div>' +
        '<div class="cw-buf__pct">0%</div>' +
        '<div class="cw-buf__stats">' +
        '<div class="cw-buf__stat"><span class="cw-buf__lab">Скорость</span><span class="cw-buf__val cw-buf__speed">—</span></div>' +
        '<div class="cw-buf__stat"><span class="cw-buf__lab">Пиры</span><span class="cw-buf__val cw-buf__peers">—</span></div>' +
        '<div class="cw-buf__stat"><span class="cw-buf__lab">Загружено</span><span class="cw-buf__val cw-buf__loaded">—</span></div>' +
        '<div class="cw-buf__stat"><span class="cw-buf__lab">Буфер</span><span class="cw-buf__val cw-buf__buf">—</span></div>' +
        '<div class="cw-buf__stat"><span class="cw-buf__lab">Готово через</span><span class="cw-buf__val cw-buf__eta">—</span></div>' +
        '<div class="cw-buf__stat"><span class="cw-buf__lab">Статус</span><span class="cw-buf__val cw-buf__status">подключение…</span></div>' +
        '</div>' +
        '<div class="cw-buf__btns">' +
        '<div class="selector cw-buf__btn cw-buf__btn--launch">Запустить сейчас</div>' +
        '<div class="selector cw-buf__btn cw-buf__btn--cancel">Отмена</div>' +
        '</div>' +
        '<div class="cw-buf__hint">Авто-старт при буфере ≥ ' +
        threshold +
        '%. Изменить: cw.buffer(true, %)</div>' +
        '</div>' +
        '</div>'
    );
    modal.find('.cw-buf__sub').text(opts.title || pickTitle(movie));
    if (fileLabel) modal.find('.cw-buf__file').text(fileLabel);

    function close() {
      aborted = true;
      if (pollIv) {
        clearInterval(pollIv);
        pollIv = 0;
      }
      modal.remove();
      if (S.buffer_close === close) S.buffer_close = null;
      safe('Controller.toggle', function () {
        Lampa.Controller.toggle(prevController || 'content');
      });
    }

    function launchNow() {
      if (launched) return;
      launched = true;
      close();
      opts.onLaunch && opts.onLaunch();
    }

    function cancel() {
      if (launched) return;
      close();
      opts.onCancel && opts.onCancel();
    }

    modal.find('.cw-buf__btn--launch').on('hover:enter', launchNow);
    modal.find('.cw-buf__btn--cancel').on('hover:enter', cancel);

    document.body.appendChild(modal[0]);
    S.buffer_close = close;

    safe('Controller.add', function () {
      Lampa.Controller.add('cw_buffer_modal', {
        invisible: true,
        toggle: function () {
          Lampa.Controller.collectionSet(modal);
          Lampa.Controller.collectionFocus(false, modal);
        },
        left: function () {
          try {
            if (Navigator.canmove('left')) Navigator.move('left');
          } catch (e) {}
        },
        right: function () {
          try {
            if (Navigator.canmove('right')) Navigator.move('right');
          } catch (e) {}
        },
        up: function () {
          try {
            if (Navigator.canmove('up')) Navigator.move('up');
          } catch (e) {}
        },
        down: function () {
          try {
            if (Navigator.canmove('down')) Navigator.move('down');
          } catch (e) {}
        },
        back: cancel,
      });
      Lampa.Controller.toggle('cw_buffer_modal');
    });

    function applyStats(info) {
      var loaded = info.loaded_size || info.LoadedSize || 0;
      var total = info.torrent_size || info.TorrentSize || 0;
      var preBytes = info.preloaded_bytes || info.PreloadedBytes || 0;
      var preSize = info.preload_size || info.PreloadSize || 0;
      var speed = info.download_speed || info.DownloadSpeed || 0;
      var seeders = info.connected_seeders || info.ConnectedSeeders || 0;
      var allPeers =
        info.peers || info.total_peers || info.TotalPeers || info.Peers || 0;
      var stat = info.stat_string || info.StatString || info.stat || '';
      var noBufferStats = !preSize && !preBytes && !speed;
      pollErrors = 0;

      var pct =
        preSize > 0 ? Math.min(100, Math.round((preBytes / preSize) * 100)) : 0;
      var eta =
        preSize > preBytes && speed > 0 ? (preSize - preBytes) / speed : 0;

      modal.find('.cw-buf__pct').text(pct + '%');
      modal.find('.cw-buf__bar-fill').css('width', pct + '%');
      modal.find('.cw-buf__speed').text(fmtSpeed(speed));
      modal.find('.cw-buf__peers').text(seeders + ' / ' + allPeers);
      modal
        .find('.cw-buf__loaded')
        .text(fmtBytes(loaded) + ' / ' + fmtBytes(total));
      modal
        .find('.cw-buf__buf')
        .text(fmtBytes(preBytes) + ' / ' + fmtBytes(preSize));
      modal.find('.cw-buf__eta').text(fmtEta(eta));
      modal
        .find('.cw-buf__status')
        .text(stat || (speed > 0 ? 'загрузка' : 'ожидание пиров'));

      // Если буфер уже накачан до порога — запускаем независимо от скорости
      // (скорость может быть 0 ровно потому что preload УЖЕ завершён).
      // Минимальная скорость нужна только когда буфер ещё мал — чтобы не стартовать на мёртвом торренте.
      if (preSize > 0 && pct >= threshold) {
        log('auto-launch: buffer ' + pct + '% >= threshold ' + threshold + '%');
        launchNow();
      } else if (
        preSize === 0 &&
        loaded > 5 * 1024 * 1024 &&
        speed > BUFFER_MIN_SPEED
      ) {
        log(
          'auto-launch: no preload_size, loaded=' + loaded + ' speed=' + speed
        );
        launchNow();
      } else if (
        preSize > 0 &&
        pct < threshold &&
        speed === 0 &&
        seeders === 0 &&
        allPeers > 0
      ) {
        modal
          .find('.cw-buf__status')
          .text('подключение к пирам (' + allPeers + ' доступно)…');
      } else if (noBufferStats) {
        zeroStatsPolls++;
        if (zeroStatsPolls === 3) {
          log('buffer: zero stats, retriggering preload for current file');
          triggerPreload(streamUrl, 60000);
        }
        if (zeroStatsPolls >= 8 || Date.now() - pollStartedAt > 12000) {
          warn('buffer: no preload stats, keeping modal open');
          modal
            .find('.cw-buf__status')
            .text('TorrServer не отдаёт прогресс буфера. Ждём или нажми «Запустить сейчас» вручную.');
        }
      } else {
        zeroStatsPolls = 0;
      }
    }

    function poll() {
      if (!hash || aborted) return;
      tsRequest(
        'get',
        {hash: hash},
        function (info) {
          if (!aborted && info) applyStats(info);
        },
        function () {
          if (!aborted) {
            pollErrors++;
            modal.find('.cw-buf__status').text('нет связи с TorrServer');
            if (pollErrors >= 3 || Date.now() - pollStartedAt > 12000) {
              warn('buffer: status polling failed, keeping modal open');
              modal
                .find('.cw-buf__status')
                .text('статус буфера недоступен. Автозапуск остановлен, чтобы не открыть чёрный экран.');
            }
          }
        }
      );
    }

    // Хеш торрента можно переиспользовать (он один на весь торрент), а вот
    // preload — НЕТ: он работает per-file. При смене эпизода (того же торрента,
    // другой index) prefetched-флаг не должен мешать запросу нового preload —
    // иначе TorrServer не начнёт качать файл и модалка зависает на 0%.
    var idx = typeof params.file_index === 'number' ? params.file_index : 0;
    var sameTorrent = S.last_prefetched_link === params.torrent_link;
    var sameFile = sameTorrent && S.last_prefetched_index === idx;
    var cachedHash = sameTorrent && S.prefetch_hash ? S.prefetch_hash : null;

    var startPolling = function (h) {
      hash = h;
      stopPrefetchPoll();
      // Всегда триггерим preload для текущего file_index — даже если торрент
      // уже добавлен и для этого файла prefetch «как будто» завершился. На
      // Android/TorrServer action=get иногда возвращает 0/0 после возврата из
      // внешнего плеера, а повторный /stream?preload оживляет именно текущий
      // файл без вреда для уже добавленного торрента.
      triggerPreload(streamUrl, 60000);
      modal
        .find('.cw-buf__status')
        .text(
          sameFile && S.prefetch_target_reached
            ? 'буфер уже накачан (prefetch ' + S.prefetch_pct + '%)'
            : sameFile
            ? 'буферизация (prefetch активен, ' + S.prefetch_pct + '%)'
            : sameTorrent
            ? 'торрент в TorrServer, запрашиваем файл #' + idx + '…'
            : 'подключение к пирам…'
        );
      poll();
      pollIv = setInterval(poll, BUFFER_POLL_MS);
    };

    if (cachedHash) {
      modal
        .find('.cw-buf__status')
        .text('используем prefetch (буфер ' + S.prefetch_pct + '%)…');
      startPolling(cachedHash);
    } else {
      modal.find('.cw-buf__status').text('проверка TorrServer…');
      var attempts = 0;
      var tryAdd = function () {
        attempts++;
        modal
          .find('.cw-buf__status')
          .text(
            attempts === 1
              ? sameTorrent
                ? 'торрент уже добавлен, запрашиваем файл…'
                : 'добавление в TorrServer…'
              : 'повтор #' + attempts + '…'
          );
        getTorrentHash(
          {
            link: params.torrent_link,
            title: pickTitle(movie),
            poster: movie.poster_path,
          },
          function (torrent) {
            if (aborted) return;
            var h = torrent && (torrent.hash || torrent.Hash);
            if (!h) {
              modal.find('.cw-buf__status').text('пустой ответ от TorrServer');
              return;
            }
            if (!S.prefetch_hash) S.prefetch_hash = h;
            startPolling(h);
          },
          function (err) {
            if (aborted) return;
            var msg = err && err.message ? err.message : 'неизвестная ошибка';
            if (attempts < 3) {
              modal
                .find('.cw-buf__status')
                .text('Ошибка: ' + msg.slice(0, 70) + ' — повтор через 2с…');
              setTimeout(tryAdd, 2000);
            } else {
              // Хеш получить не смогли (CORS / линк не magnet). Без хеша
              // polling статуса невозможен, поэтому не запускаем плеер
              // автоматически: иначе пользователь может получить чёрный экран.
              warn(
                'add failed after ' +
                  attempts +
                  ' attempts (' +
                  msg +
                  ') — keeping buffer modal open'
              );
              triggerPreload(streamUrl, 60000);
              modal
                .find('.cw-buf__status')
                .text('не удалось проверить буфер: ' + msg.slice(0, 70) + '. Автозапуск остановлен.');
            }
          }
        );
      };

      tsPing(
        function () {
          if (aborted) return;
          tryAdd();
        },
        function (err) {
          if (aborted) return;
          var msg = err && err.message ? err.message : 'TorrServer недоступен';
          warn('TorrServer ping failed: ' + msg);
          modal
            .find('.cw-buf__status')
            .text(msg + ' — проверь TorrServer и URL в Lampa');
        }
      );
    }
  }

  // =========================================================================
  // 9. Запуск плеера по нажатию «Продолжить»
  // =========================================================================
  // ВАЖНО: data.playlist должен содержать ВСЕ эпизоды СРАЗУ. Lampa.Player
  // авто-переключает на следующий итем плейлиста, но «горячая» подмена
  // плейлиста через Lampa.Player.playlist(...) после старта игнорируется
  // плеером — поэтому если изначально передать [current] + stub, плеер на
  // конце эпизода видит stub без url и закрывается. Поэтому собираем полный
  // плейлист до Lampa.Player.play.
  function startPlayback(movie, params, url, timeline, opts) {
    opts = opts || {};
    var player_type = Lampa.Storage.field('player_torrent');
    var force_inner = player_type === 'inner';
    var isSeries = !!(
      movie.number_of_seasons &&
      params.season &&
      params.episode
    );
    var resumeTime =
      typeof opts.resumeTime === 'number'
        ? opts.resumeTime
        : timeline.time || 0;
    log(
      'startPlayback player_type=' +
        player_type +
        ' position=' +
        (resumeTime || -1) +
        ' series=' +
        isSeries +
        ' singleEpisode=' +
        !!opts.singleEpisode
    );

    var data = {
      url: url,
      title: params.episode_title || params.title || movie.title,
      card: movie,
      torrent_hash: params.torrent_link,
      timeline: timeline,
      season: params.season,
      episode: params.episode,
      position: resumeTime || -1,
    };

    if (force_inner) {
      delete data.torrent_hash;
      var orig = Lampa.Platform.is;
      Lampa.Platform.is = function (w) {
        return w === 'android' ? false : orig(w);
      };
      setTimeout(function () {
        Lampa.Platform.is = orig;
      }, 500);
      safe('setInternal', function () {
        Lampa.Storage.set('internal_torrclient', true);
      });
    }

    var epTitle =
      params.episode_title ||
      (params.season
        ? 'S' + params.season + ' E' + params.episode
        : movie.title || params.title || '');

    var fallbackPlaylist = [
      {
        url: url,
        title: epTitle,
        timeline: timeline,
        season: params.season,
        episode: params.episode,
        card: movie,
        torrent_hash: params.torrent_link,
        position: resumeTime || -1,
      },
    ];

    var doPlay = function (playlist) {
      data.playlist = playlist && playlist.length ? playlist : fallbackPlaylist;
      if (resumeTime > 0) noty('Восстанавливаем: ' + formatTime(resumeTime));
      var epHash = generateHash(movie, params.season, params.episode);
      if (epHash) {
        S.session_play_hash = epHash;
        S.session_play_card = movie;
      }
      attachPlayerListeners();
      Lampa.Player.play(data);
      try {
        Lampa.Player.callback(function () {
          Lampa.Controller.toggle('content');
        });
      } catch (e) {}
      log('player started, playlist=' + data.playlist.length + ' items');
    };

    if (!isSeries || opts.singleEpisode) {
      // singleEpisode: юзер выбрал «Досмотреть текущий» в smart-next confirm.
      // Без playlist'а Lampa.Player не сможет авто-перепрыгнуть на следующую
      // серию когда мы сразу подходим к концу (это и происходило, юзер думал
      // что серия запустилась заново — на самом деле плеер за 2 сек добегал
      // до конца и переходил на S+1 из playlist'а).
      doPlay(fallbackPlaylist);
      return;
    }

    if (S.files[params.torrent_link]) {
      log(
        'using cached files for playlist (' +
          S.files[params.torrent_link].length +
          ')'
      );
      buildPlaylistFromFiles(
        movie,
        params,
        url,
        S.files[params.torrent_link],
        doPlay,
        resumeTime
      );
      return;
    }

    var played = false;
    var startTimeout = setTimeout(function () {
      if (played) return;
      played = true;
      warn('playlist load timeout, starting with current episode only');
      doPlay(fallbackPlaylist);
    }, 3500);

    loadEpisodesPlaylist(
      movie,
      params,
      url,
      function (playlist) {
        if (played) {
          if (playlist && playlist.length > 1) {
            safe('Player.playlist.late', function () {
              Lampa.Player.playlist(playlist);
            });
            noty('Плейлист загружен (' + playlist.length + ' эп.)');
          }
          return;
        }
        played = true;
        clearTimeout(startTimeout);
        doPlay(playlist && playlist.length ? playlist : fallbackPlaylist);
      },
      resumeTime
    );
  }

  function buildPlaylistFromFiles(
    movie,
    currentParams,
    currentUrl,
    files,
    done,
    currentResumeTime
  ) {
    var title = pickTitle(movie);
    var playlist = [];
    var allParams = readParams();
    var hasResume =
      typeof currentResumeTime === 'number' && currentResumeTime > 0;

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      safe('parseFile', function () {
        var info = Lampa.Torserver.parse({
          movie: movie,
          files: [file],
          filename: file.path.split('/').pop(),
          path: file.path,
          is_file: true,
        });
        if (movie.number_of_seasons && info.season !== currentParams.season)
          return;

        var epHash = generateHash(movie, info.season, info.episode);
        var tl = Lampa.Timeline.view(epHash) || {
          hash: epHash,
          percent: 0,
          time: 0,
          duration: 0,
        };
        if (!allParams[epHash]) {
          updateEntry(epHash, {
            file_name: file.path,
            torrent_link: currentParams.torrent_link,
            file_index: file.id || 0,
            title: title,
            season: info.season,
            episode: info.episode,
            percent: 0,
            time: 0,
            duration: 0,
          });
        }

        var isCur =
          info.season === currentParams.season &&
          info.episode === currentParams.episode;
        var pos;
        if (isCur) {
          pos = hasResume ? currentResumeTime : tl.time || -1;
          if (hasResume) tl.time = currentResumeTime;
        } else {
          pos = -1;
        }
        playlist.push({
          title: movie.number_of_seasons
            ? 'S' + info.season + ' E' + info.episode
            : movie.title || title,
          season: info.season,
          episode: info.episode,
          timeline: tl,
          torrent_hash: currentParams.torrent_link,
          card: movie,
          url: isCur
            ? currentUrl
            : buildStreamUrl({
                file_name: file.path,
                torrent_link: currentParams.torrent_link,
                file_index: file.id || 0,
              }),
          position: pos,
        });
      });
    }

    if (movie.number_of_seasons)
      playlist.sort(function (a, b) {
        return a.episode - b.episode;
      });
    done(playlist);
  }

  function launchPlayer(movie, params, opts) {
    opts = opts || {};
    var url = buildStreamUrl(params);
    if (!url) return;

    S.last_launched_card = movie;
    S.last_launched_at = Date.now();

    var hash = generateHash(movie, params.season, params.episode);
    var existingEntry = readParams()[hash] || {};
    var existingDuration = existingEntry.duration || params.duration || 0;
    var timeline;
    if (opts.startFresh) {
      timeline = {hash: hash, time: 0, percent: 0, duration: existingDuration};
      updateEntry(hash, {percent: 0, time: 0});
    } else if (typeof opts.resumeTime === 'number') {
      // Явное резюме (smart-next «Продолжить досмотренный»): берём
      // указанную позицию, percent — из Lampa.Timeline или params.
      // Если позиция в пределах 5с от конца — отступаем, чтобы плеер
      // не закрывался мгновенно.
      var lampaView0 =
        safe('Timeline.view', function () {
          return Lampa.Timeline.view(hash);
        }) || null;
      var resumeT = opts.resumeTime;
      if (
        existingDuration > 0 &&
        resumeT > 0 &&
        resumeT > existingDuration - 5
      ) {
        resumeT = Math.max(0, existingDuration - 5);
      }
      timeline = lampaView0 || {hash: hash};
      timeline.time = resumeT;
      timeline.percent =
        lampaView0 && lampaView0.percent > 0
          ? lampaView0.percent
          : params.percent || 0;
      timeline.duration = existingDuration;
      updateEntry(hash, {
        percent: timeline.percent,
        time: timeline.time,
        duration: timeline.duration,
      });
    } else {
      // Обычный путь (как было до v121): доверяем Lampa.Timeline,
      // params.time используем как fallback / как "обогнал" лампу.
      timeline = safe('Timeline.view', function () {
        return Lampa.Timeline.view(hash);
      });
      if (!timeline || (!timeline.time && !timeline.percent)) {
        timeline = timeline || {hash: hash};
        timeline.time = params.time || 0;
        timeline.percent = params.percent || 0;
        timeline.duration = existingDuration;
      } else if (params.time > timeline.time) {
        timeline.time = params.time;
        timeline.percent = params.percent;
      }
      updateEntry(hash, {
        percent: timeline.percent,
        time: timeline.time,
        duration: timeline.duration,
      });
    }

    var go = function () {
      startPlayback(movie, params, url, timeline, opts);
    };

    if (bufferingEnabled() && params.torrent_link && torrUrl()) {
      showBufferModal({
        movie: movie,
        params: params,
        url: url,
        title: params.episode_title || params.title,
        onLaunch: go,
        onCancel: function () {
          log('buffer modal cancelled');
        },
      });
    } else {
      go();
    }
  }

  // =========================================================================
  // 10. Перехват Lampa.Player.play (сохраняем метаданные при старте)
  // =========================================================================
  function patchPlayer() {
    if (!Lampa.Player) {
      warn('Lampa.Player not available');
      return;
    }
    var original = Lampa.Player.play;
    if (!original) {
      warn('Lampa.Player.play not available');
      return;
    }

    Lampa.Player.play = function (p) {
      safe('patchPlayer.intercept', function () {
        S.last_play_url = p && p.url;
        var hasStream = p && p.url && p.url.indexOf('/stream/') !== -1;
        if (!(p && (p.torrent_hash || hasStream))) return;

        S.play_intercepted++;
        var movie =
          p.card ||
          p.movie ||
          (Lampa.Activity.active() && Lampa.Activity.active().movie);
        log(
          'PATCH play title="' +
            pickTitle(movie) +
            '" url=' +
            (p.url ? p.url.slice(0, 120) : '')
        );
        if (!movie) return;

        var hash = generateHash(movie, p.season, p.episode);
        if (!hash) return;

        var tl = Lampa.Timeline.view(hash);
        var fresh = !tl || !tl.percent || tl.percent < 5;
        if (!fresh) return;

        var mFile = p.url && p.url.match(/\/stream\/([^?]+)/);
        var mLink = p.url && p.url.match(/[?&]link=([^&]+)/);
        var mIdx = p.url && p.url.match(/[?&]index=(\d+)/);
        if (!mFile || !mLink) return;

        updateEntry(hash, {
          file_name: decodeURIComponent(mFile[1]),
          torrent_link: mLink[1],
          file_index: mIdx ? parseInt(mIdx[1]) : 0,
          title: pickTitle(movie),
          season: p.season,
          episode: p.episode,
          episode_title: p.title || p.episode_title,
        });
      });
      return original.call(this, p);
    };
    log('Lampa.Player.play patched');
  }

  // =========================================================================
  // 11. Timeline listener — обновление процента/времени (единственная точка)
  // =========================================================================
  // Когда плеер переключается на следующую серию (auto-next в playlist'е,
  // ручной next-episode), Lampa.Timeline.update прилетает для нового hash,
  // которого может не быть в нашем continue_watch_params — например если
  // loadEpisodesPlaylist не успел подгрузить полный список из torrent files
  // или если url playlist'а отличается от /stream/ формата. Создаём
  // минимальную запись на лету: title тянем из последней известной карточки,
  // season/episode оставляем undefined — они проставятся в Player.listener
  // start как только тот сработает. Главное — прогресс не теряется.
  function ensureEntryForLivePlayback(hash) {
    var p = readParams();
    if (p[hash]) return true;
    var card =
      S.last_player_card || S.session_play_card || S.last_launched_card;
    if (!card) return false;
    updateEntry(hash, {title: pickTitle(card)});
    log(
      'timeline: created stub entry for hash=' +
        String(hash).slice(0, 12) +
        '… (auto-next?)'
    );
    return true;
  }

  function attachTimelineListener() {
    safe('Timeline.listener', function () {
      Lampa.Timeline.listener.follow('update', function (e) {
        var hash = e.data && e.data.hash;
        var road = e.data && e.data.road;
        if (!hash || !road || typeof road.percent === 'undefined') return;
        S.timeline_updates++;

        var hashChanged = S.last_player_hash !== hash;

        // Хеш в обновлении — это активная серия в плеере. Если он
        // отличается от того, что у нас зафиксировано как «текущая
        // играющая серия», значит плеер переключился (auto-next /
        // ручной next-episode). Сбрасываем старый hash в storage
        // и сбрасываем throttle, чтобы первый тик новой серии гарантированно
        // прошёл и прогресс не потерялся в гонке throttle vs смена серии.
        if (hashChanged) {
          if (S.last_player_hash) flushHashFromTimeline(S.last_player_hash);
          S.last_player_hash = hash;
          S.last_tick = 0;
          touchEntryTimestamp(hash);
          refreshActiveCardSoon(
            S.last_player_card || S.last_launched_card,
            'timeline hash changed'
          );
        }

        var now = Date.now();
        // Не throttl'им если: hash только что изменился, или процент
        // дёрнулся заметно (≥5%), или серия близка к концу (≥SMART_NEXT_PCT) —
        // эти сэмплы критичны для smart-next и для отображения «Продолжить».
        var pctNum = typeof road.percent === 'number' ? road.percent : 0;
        var bypass = hashChanged || pctNum >= SMART_NEXT_PCT;
        if (!bypass) {
          var p0 = readParams()[hash];
          if (
            p0 &&
            typeof p0.percent === 'number' &&
            Math.abs(pctNum - p0.percent) >= 5
          ) {
            bypass = true;
          }
        }
        if (!bypass && now - S.last_tick < TIMELINE_THROTTLE_MS) return;
        S.last_tick = now;

        if (!ensureEntryForLivePlayback(hash)) return;
        updateEntry(hash, {
          percent: road.percent,
          time: road.time,
          duration: road.duration,
        });
        refreshActiveCardSoon(
          S.last_player_card || S.last_launched_card,
          'timeline update'
        );
      });
      log('Timeline listener attached');
    });
  }

  // Снять текущее состояние эпизода с Lampa.Timeline и записать в наш storage.
  // Вызывается на смене эпизода и на закрытии плеера, чтобы не потерять
  // финальные percent/time (наш Timeline.update-листенер throttle'ится 2с
  // и может пропустить последние тики).
  function flushHashFromTimeline(hash) {
    if (!hash) return;
    safe('flushHashFromTimeline', function () {
      // Сначала пробуем самый надёжный источник — Storage 'file_view*'
      // (его обновляет и внутренний плеер, и нативный bridge для
      // внешних плееров типа ViMu). Lampa.Timeline.view() — fallback,
      // он может возвращать кэш в памяти.
      if (syncEntryFromFileView(hash)) return;
      var tl = Lampa.Timeline.view(hash);
      if (!tl) return;
      var pct = typeof tl.percent === 'number' ? tl.percent : 0;
      var t = tl.time || 0;
      var dur = tl.duration || 0;
      if (!pct && !t && !dur) return;
      if (!ensureEntryForLivePlayback(hash)) return;
      updateEntry(hash, {percent: pct, time: t, duration: dur});
    });
  }

  function flushPendingWrites() {
    if (!TIMERS.save) return;
    clearTimeout(TIMERS.save);
    TIMERS.save = 0;
    if (!S.mem) return;
    safe('flushPendingWrites', function () {
      Lampa.Storage.set(activeKey(), S.mem);
    });
  }

  // Принудительно обновить timestamp у записи. Нужно когда плеер автоматически
  // переключается на следующую серию: её file_name/season/episode уже лежат в
  // storage (их положил префетч/loadEpisodesPlaylist), поэтому updateEntry
  // считает её «не изменившейся» и timestamp остаётся старым. В то же время
  // flushHashFromTimeline предыдущей серии записывает свежий timestamp →
  // findStreamParams возвращает старую серию и smart-next выводит на кнопку
  // «Следующая SxxEyy». touchEntryTimestamp пробивает эту проблему.
  function touchEntryTimestamp(hash) {
    if (!hash) return;
    var p = readParams();
    if (!p[hash]) return;
    p[hash].timestamp = Date.now();
    writeParams(p, true);
  }

  function attachPlayerListeners() {
    detachPlayerListeners();
    LISTENERS.player_start = function (d) {
      if (!d || !d.card) return;
      var hash = generateHash(d.card, d.season, d.episode);
      if (!hash) return;

      var mFile = d.url && d.url.match(/\/stream\/([^?]+)/);
      var mLink = d.url && d.url.match(/[?&]link=([^&]+)/);
      var mIdx = d.url && d.url.match(/[?&]index=(\d+)/);

      if (S.last_player_hash && S.last_player_hash !== hash) {
        flushHashFromTimeline(S.last_player_hash);
        S.last_tick = 0;
      }
      S.last_player_hash = hash;
      S.last_player_card = d.card;

      var patch = {
        title: pickTitle(d.card),
        season: d.season,
        episode: d.episode,
      };
      if (mFile) {
        patch.file_name = decodeURIComponent(mFile[1]);
        if (mLink) patch.torrent_link = mLink[1];
        if (mIdx) patch.file_index = parseInt(mIdx[1], 10);
      } else {
        var existing = readParams()[hash];
        if (existing) {
          if (existing.torrent_link) patch.torrent_link = existing.torrent_link;
          if (existing.file_name) patch.file_name = existing.file_name;
          if (typeof existing.file_index !== 'undefined')
            patch.file_index = existing.file_index;
        }
        log(
          'player start: no /stream/ in url (external player?) — using stored torrent fields if any'
        );
      }
      updateEntry(hash, patch);
      touchEntryTimestamp(hash);
      refreshActiveCardSoon(d.card, 'player start');
    };
    LISTENERS.player_destroy = function () {
      var h = S.last_player_hash || S.session_play_hash;
      var playedCard =
        S.last_player_card || S.session_play_card || S.last_launched_card;
      if (h) {
        flushHashFromTimeline(h);
        flushPendingWrites();
      }
      S.last_player_hash = null;
      S.last_player_card = null;
      S.session_play_hash = null;
      S.session_play_card = null;
      detachPlayerListeners();
      scheduleCardButtonRefresh(playedCard);
      if (h) {
        setTimeout(function () {
          flushHashFromTimeline(h);
          flushPendingWrites();
        }, 700);
        setTimeout(function () {
          flushHashFromTimeline(h);
          flushPendingWrites();
          scheduleCardButtonRefresh(playedCard);
        }, 2200);
        // Открываем exit-summary позже первой волны refresh'ей карточки,
        // чтобы Lampa уже стабильно вернула фокус на карточку и наш Select
        // не закрывался автоматически Lampa-controller'ом.
        setTimeout(function () {
          if (playedCard) maybeShowExitSummary(playedCard, h, 'player.destroy');
        }, 1500);
      }
    };
    safe('Player.listener', function () {
      Lampa.Player.listener.follow('start', LISTENERS.player_start);
      Lampa.Player.listener.follow('destroy', LISTENERS.player_destroy);
    });
  }

  // Когда плеер закрывается, мы должны перерисовать кнопку «Продолжить» на
  // карточке — иначе она остаётся со старыми данными (старая серия / время).
  // Lampa не вызывает full:complite повторно, поэтому делаем это вручную.
  // setTimeout даём, чтобы Lampa успела вернуть active activity на карточку.
  // На Android TV WebView карточка иногда дорисовывается ещё 0.5-1.5с после
  // закрытия внешнего плеера, поэтому одной попытки недостаточно: старый DOM
  // может вернуться поверх нашей кнопки. Делаем несколько дешёвых повторов.
  function scheduleCardButtonRefresh(playedCard) {
    var expectedTitle = pickTitle(playedCard);
    var delays = [250, 800, 1600, 3200, 5200];

    for (var i = 0; i < delays.length; i++) {
      (function (delay) {
        setTimeout(function () {
          safe('refreshOnDestroy', function () {
            // Не дёргаем DOM/контроллер, пока открыт Select-модал
            // (exit-summary / smart-next / context-menu) — иначе наш
            // collectionFocus в lockButtonFocus закроет Select.
            if (S.modal_open) {
              setTimeout(function () {
                scheduleCardButtonRefresh(playedCard);
              }, 800);
              return;
            }
            var act = Lampa.Activity.active && Lampa.Activity.active();
            if (!act) return;
            var movie = act.movie || (act.activity && act.activity.movie);
            var render =
              (act.render && act.render()) ||
              (act.activity && act.activity.render && act.activity.render());
            if (!movie || !render) return;
            if (expectedTitle && pickTitle(movie) !== expectedTitle) return;
            var oldBtn = render.find('.button--continue-watch').first();
            if (oldBtn.length) oldBtn.remove();
            _runInject(movie, render, {skipPrefetch: true});
            log(
              'card refresh after player destroy: delay=' +
                delay +
                ' title="' +
                pickTitle(movie) +
                '"'
            );
          });
        }, delay);
      })(delays[i]);
    }
  }

  function detachPlayerListeners() {
    if (LISTENERS.player_start)
      safe('unfollow.start', function () {
        Lampa.Player.listener.remove('start', LISTENERS.player_start);
      });
    if (LISTENERS.player_destroy)
      safe('unfollow.destroy', function () {
        Lampa.Player.listener.remove('destroy', LISTENERS.player_destroy);
      });
    LISTENERS.player_start = null;
    LISTENERS.player_destroy = null;
  }

  // =========================================================================
  // 12. Кнопка «Продолжить» на карточке
  // =========================================================================
  function buildButtonHtml(dashArray, label) {
    return (
      '<div class="full-start__button selector button--continue-watch">' +
      '<svg class="cw-btn__ico" viewBox="0 0 24 24" width="22" height="22" fill="none">' +
      '<path d="M8 5v14l11-7L8 5z" fill="currentColor"/>' +
      '<circle class="cw-btn__ring" cx="12" cy="12" r="10.5" stroke="currentColor" ' +
      'stroke-width="1.5" fill="none" stroke-dasharray="' +
      dashArray +
      ' 65.97" ' +
      'transform="rotate(-90 12 12)"/>' +
      '</svg><div class="cw-btn__lbl">' +
      label +
      '</div></div>'
    );
  }

  function smartNextConfirmEnabled() {
    return getBoolPref(SMART_NEXT_CONFIRM_KEY, true);
  }
  function exitSummaryEnabled() {
    return getBoolPref(EXIT_SUMMARY_KEY, true);
  }

  // Компактный confirm-модал по центру экрана (DOM, не Lampa.Select).
  // Lampa.Select на новых сборках открывается правым sidebar'ом — для простого
  // «да/нет» это слишком тяжело. Свой DOM-модал проще, лучше управляется
  // фокусом и не конфликтует с остальной разметкой Lampa Activity.
  // opts: { title, subtitle?, primary:{label, onPick}, secondary:{label, onPick}, footer?:{label, onPick}, onClose? }
  function showCenterConfirm(opts) {
    var prevController = null;
    try {
      prevController =
        Lampa.Controller.enabled() && Lampa.Controller.enabled().name;
    } catch (e) {}

    var hasFooter = !!(opts.footer && opts.footer.label);
    var modal = $(
      '<div class="cw-cnf">' +
        '<div class="cw-cnf__card">' +
        '<div class="cw-cnf__title"></div>' +
        '<div class="cw-cnf__sub"></div>' +
        '<div class="cw-cnf__btns">' +
        '<div class="selector cw-cnf__btn cw-cnf__btn--primary"></div>' +
        '<div class="selector cw-cnf__btn cw-cnf__btn--secondary"></div>' +
        '</div>' +
        (hasFooter ? '<div class="selector cw-cnf__foot"></div>' : '') +
        '</div>' +
        '</div>'
    );

    modal.find('.cw-cnf__title').text(opts.title || '');
    if (opts.subtitle) modal.find('.cw-cnf__sub').text(opts.subtitle);
    else modal.find('.cw-cnf__sub').remove();
    modal.find('.cw-cnf__btn--primary').text(opts.primary.label);
    modal.find('.cw-cnf__btn--secondary').text(opts.secondary.label);
    if (hasFooter) modal.find('.cw-cnf__foot').text(opts.footer.label);

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      S.modal_open = false;
      modal.remove();
      safe('Controller.toggle', function () {
        Lampa.Controller.toggle(prevController || 'content');
      });
      if (typeof opts.onClose === 'function') safe('cnf.onClose', opts.onClose);
    }
    function pickAndClose(fn) {
      close();
      if (typeof fn === 'function') safe('cnf.pick', fn);
    }

    modal.find('.cw-cnf__btn--primary').on('hover:enter', function () {
      pickAndClose(opts.primary.onPick);
    });
    modal.find('.cw-cnf__btn--secondary').on('hover:enter', function () {
      pickAndClose(opts.secondary.onPick);
    });
    if (hasFooter)
      modal.find('.cw-cnf__foot').on('hover:enter', function () {
        pickAndClose(opts.footer.onPick);
      });

    document.body.appendChild(modal[0]);
    S.modal_open = true;
    log('center confirm open: ' + opts.title);

    safe('Controller.add.cnf', function () {
      Lampa.Controller.add('cw_center_confirm', {
        invisible: true,
        toggle: function () {
          Lampa.Controller.collectionSet(modal);
          var primary = modal.find('.cw-cnf__btn--primary')[0];
          Lampa.Controller.collectionFocus(primary, modal);
        },
        left: function () {
          try {
            if (Navigator.canmove('left')) Navigator.move('left');
          } catch (e) {}
        },
        right: function () {
          try {
            if (Navigator.canmove('right')) Navigator.move('right');
          } catch (e) {}
        },
        up: function () {
          try {
            if (Navigator.canmove('up')) Navigator.move('up');
          } catch (e) {}
        },
        down: function () {
          try {
            if (Navigator.canmove('down')) Navigator.move('down');
          } catch (e) {}
        },
        back: close,
      });
      Lampa.Controller.toggle('cw_center_confirm');
    });

    return close;
  }

  // Открыть Lampa.Select.show с защитой от схлопывания: ставим S.modal_open,
  // чтобы наши refresh'и (refreshActiveCardSoon / scheduleCardButtonRefresh /
  // lockButtonFocus) не дёргали Lampa.Controller.collectionFocus и не
  // переключали фокус с открытого Select на карточку. Перед открытием
  // явно переводим контроллер в 'content' — это стабильное состояние,
  // от которого Select.show корректно делает Controller.toggle('select').
  function openSelectModal(opts, label) {
    if (!Lampa.Select || !Lampa.Select.show) return false;
    var name = label || 'select';
    var origOnSelect = opts.onSelect;
    var origOnBack = opts.onBack;
    var closed = false;
    var markClosed = function () {
      if (closed) return;
      closed = true;
      S.modal_open = false;
      log('modal closed: ' + name);
    };
    opts.onSelect = function (item) {
      markClosed();
      safe(name + '.onSelect', function () {
        if (origOnSelect) origOnSelect(item);
      });
    };
    opts.onBack = function () {
      markClosed();
      safe(name + '.onBack', function () {
        if (origOnBack) origOnBack();
      });
    };
    S.modal_open = true;
    log('modal open: ' + name);
    safe(name + '.toggle', function () {
      if (Lampa.Controller && Lampa.Controller.enabled) {
        var cur = Lampa.Controller.enabled();
        if (!cur || cur.name !== 'content') Lampa.Controller.toggle('content');
      }
    });
    var ok = false;
    safe(name + '.show', function () {
      Lampa.Select.show(opts);
      ok = true;
    });
    if (!ok) S.modal_open = false;
    return ok;
  }

  // Модалка «Сохранено» при выходе из плеера. Показывается один раз за сеанс
  // плеера (cooldown EXIT_SUMMARY_COOLDOWN_MS + dedupe по hash) и только если
  // мы реально что-то посмотрели (≥ EXIT_SUMMARY_MIN_TIME_S сек или percent>0).
  // Триггеры: Player.destroy (внутренний плеер) и file_view-change (внешний
  // плеер на Android, где Player.listener не работает — см. issue 244).
  function maybeShowExitSummary(card, hash, reason) {
    if (!exitSummaryEnabled()) return false;
    if (!card || !hash) return false;
    var p = readParams()[hash];
    if (!p) return false;
    var pct = typeof p.percent === 'number' ? p.percent : 0;
    var t = p.time || 0;
    if (pct <= 0 && t < EXIT_SUMMARY_MIN_TIME_S) return false;

    var now = Date.now();
    if (
      S.last_exit_summary_hash === hash &&
      now - S.last_exit_summary_at < EXIT_SUMMARY_COOLDOWN_MS
    )
      return false;
    S.last_exit_summary_at = now;
    S.last_exit_summary_hash = hash;

    showExitSummary(card, hash, p, reason);
    return true;
  }

  function showExitSummary(movie, hash, params, reason) {
    var pct = Math.floor(params.percent || 0);
    if (params.percent >= 100) pct = 100;
    var time = params.time || 0;
    var dur = params.duration || 0;
    var ep =
      params.season && params.episode
        ? 'S' + params.season + ' E' + params.episode
        : '';
    var posStr = formatTime(time) + (dur ? ' / ' + formatTime(dur) : '');

    var titleLine = ep ? pickTitle(movie) + ' · ' + ep : pickTitle(movie);
    var subLine =
      pct >= 100
        ? 'Эпизод просмотрен полностью'
        : 'Сохранено: ' + posStr + (pct > 0 ? ' · ' + pct + '%' : '');

    log(
      'exit-summary: notify (' +
        (reason || '?') +
        ') hash=' +
        String(hash).slice(0, 12) +
        '… pct=' +
        pct +
        ' time=' +
        time
    );
    noty(titleLine + ' · ' + subLine);
  }

  // Компактный confirm по центру: предыдущий эпизод почти досмотрен,
  // спрашиваем «Продолжить» (досмотреть текущий) или «Следующий»
  // (запустить следующий с начала). Без правого sidebar'а Lampa.Select.
  function showSmartNextConfirm(movie, target) {
    var prev = target.params;
    var nxt = target.nextParams;
    var ep =
      prev.season && prev.episode
        ? 'S' + prev.season + ' E' + prev.episode
        : '';
    var nep =
      nxt.season && nxt.episode ? 'S' + nxt.season + ' E' + nxt.episode : '';

    // Снимаем актуальную позицию из НАШЕГО storage + Lampa.Timeline в момент клика.
    // Lampa мог обнулить time при ended (percent=100, time=0) — берём максимум,
    // чтобы при выборе «Продолжить» резюмить именно с реальной позиции, а не с 0.
    var prevHash = generateHash(movie, prev.season, prev.episode);
    var resumeFor = function () {
      var fresh = readParams()[prevHash] || prev;
      var lampa =
        safe('Timeline.view', function () {
          return Lampa.Timeline.view(prevHash);
        }) || {};
      return Math.max(fresh.time || 0, lampa.time || 0);
    };

    showCenterConfirm({
      title: 'Эпизод ' + ep + ' просмотрен на ' + target.currentPercent + '%',
      subtitle: 'Перейти к следующему эпизоду?',
      primary: {
        label: 'Следующий ' + nep,
        onPick: function () {
          launchPlayer(movie, cloneFresh(nxt), {startFresh: true});
        },
      },
      secondary: {
        label: 'Продолжить ' + ep,
        onPick: function () {
          var t = resumeFor();
          log('smart-next: resume "' + ep + '" at ' + t + 's');
          launchPlayer(movie, prev, {resumeTime: t, singleEpisode: true});
        },
      },
      footer: {
        label: 'Не спрашивать больше',
        onPick: function () {
          safe('cwSmartNextOff', function () {
            Lampa.Storage.set(SMART_NEXT_CONFIRM_KEY, false);
          });
          launchPlayer(movie, cloneFresh(nxt), {startFresh: true});
        },
      },
    });
  }

  function onClickContinue(movie, btn, render, target) {
    if (TIMERS.click) return;
    target = target || pickContinueTarget(movie);
    if (!target) {
      noty('Нет истории');
      return;
    }
    if (btn) $(btn).css('opacity', 0.5);
    TIMERS.click = setTimeout(function () {
      TIMERS.click = 0;
      if (btn) $(btn).css('opacity', 1);
    }, CLICK_DEBOUNCE_MS);

    if (target.hasNext && target.nextParams && smartNextConfirmEnabled()) {
      showSmartNextConfirm(movie, target);
      return;
    }
    // hasNext + confirm выкл = тихий прыжок к следующему (старое поведение)
    if (target.hasNext && target.nextParams) {
      launchPlayer(movie, cloneFresh(target.nextParams), {startFresh: true});
      return;
    }
    launchPlayer(movie, target.params);
  }

  function showContextMenu(movie, target, btn, render) {
    var current = target.params;
    var isSeries = !!(
      movie.number_of_seasons &&
      current.season &&
      current.episode
    );
    var items = [];
    var curHash = generateHash(movie, current.season, current.episode);
    var ep = isSeries ? 'S' + current.season + ' E' + current.episode : '';

    if (isSeries) {
      var nxt =
        target.nextParams ||
        findNextEpisodeParams(movie, current) ||
        findNextEpisodeFromFiles(movie, current);
      if (
        nxt &&
        (nxt.season !== current.season || nxt.episode !== current.episode)
      )
        items.push({
          title:
            'Завершить и запустить следующий: S' +
            nxt.season +
            ' E' +
            nxt.episode,
          action: function () {
            var freshCurrent =
              findEpisodeParams(movie, current.season, current.episode) ||
              current;
            var freshNxt =
              findNextEpisodeParams(movie, freshCurrent) ||
              findNextEpisodeFromFiles(movie, freshCurrent);
            if (
              !freshNxt ||
              (freshNxt.season === freshCurrent.season &&
                freshNxt.episode === freshCurrent.episode)
            ) {
              warn('next episode disappeared, falling back to closure nxt');
              freshNxt = nxt;
            }
            log(
              'next-action: cur S' +
                freshCurrent.season +
                'E' +
                freshCurrent.episode +
                ' -> nxt S' +
                freshNxt.season +
                'E' +
                freshNxt.episode +
                ' file=' +
                (freshNxt.file_name || '?').slice(-40)
            );
            markWatched(curHash, freshCurrent);
            launchPlayer(movie, cloneFresh(freshNxt), {startFresh: true});
          },
        });
      var prev = findPrevEpisodeParams(movie, current);
      if (prev)
        items.push({
          title:
            'Вернуться к предыдущему: S' +
            prev.season +
            ' E' +
            prev.episode +
            ' (с начала)',
          action: function () {
            launchPlayer(movie, cloneFresh(prev), {startFresh: true});
          },
        });
      items.push({
        title: 'Сбросить прогресс эпизода (' + ep + ')',
        action: function () {
          resetEntry(curHash);
          noty('Прогресс эпизода сброшен — теперь с начала');
          refreshCardButton(movie, render, btn);
        },
      });
    } else {
      items.push({
        title: 'Отметить фильм как просмотренный',
        action: function () {
          markWatched(curHash, current);
          noty('Фильм помечен как просмотренный');
          refreshCardButton(movie, render, btn);
        },
      });
      items.push({
        title: 'Сбросить прогресс фильма (с начала)',
        action: function () {
          resetEntry(curHash);
          noty(
            'Прогресс сброшен. Нажмите «Продолжить» чтобы запустить с начала'
          );
          refreshCardButton(movie, render, btn);
        },
      });
    }

    if (!items.length) return;

    openSelectModal(
      {
        title: 'Действия с прогрессом',
        items: items,
        onSelect: function (item) {
          if (item && typeof item.action === 'function') {
            safe('contextAction', function () {
              item.action();
            });
          }
        },
        onBack: function () {},
      },
      'context-menu'
    );
  }

  // skipPrefetch: после деструктивных действий (reset/markWatched/delete) НЕ
  // запускаем фоновый prefetch — иначе он стартует Lampa.Torserver.hash
  // одновременно с тем, что чуть позже сделает buffer-modal по клику юзера,
  // и TorrServer/Lampa-обёртка ловит «ошибку добавления торрента».
  function refreshCardButton(movie, render, oldBtn) {
    if (oldBtn) oldBtn.remove();
    safe('refreshCardButton', function () {
      _runInject(movie, render, {skipPrefetch: true});
    });
  }

  function injectButtonAt(render, btn) {
    var c = render
      .find('.full-start-new__buttons, .full-start__buttons')
      .first();
    if (c.length) {
      c.prepend(btn);
      return 'prepend:buttons';
    }

    var playSelectors = [
      '.full-start-new__button--play',
      '.full-start__button--play',
      '.button--play',
      '[data-button="play"]',
      '[data-action="play"]',
    ];
    for (var i = 0; i < playSelectors.length; i++) {
      var p = render.find(playSelectors[i]).first();
      if (p.length) {
        p.before(btn);
        return 'before:' + playSelectors[i];
      }
    }

    var torr = render.find('.view--torrent').first();
    if (torr.length) {
      torr.before(btn);
      return 'before:view--torrent';
    }

    var fb = render.find('.full-start__button').first();
    if (fb.length) {
      fb.before(btn);
      return 'before-first:full-start__button';
    }

    return null;
  }

  function refreshFocusCollection(render, focusEl) {
    try {
      if (!window.Lampa || !Lampa.Controller || !Lampa.Controller.collectionSet)
        return;
      var ctrl = Lampa.Controller.enabled && Lampa.Controller.enabled();
      var ctrlName = ctrl && ctrl.name;
      if (
        ctrlName !== 'full' &&
        ctrlName !== 'full_start' &&
        ctrlName !== 'content'
      )
        return;
      Lampa.Controller.collectionSet(render);
      if (focusEl) {
        try {
          Lampa.Controller.collectionFocus(focusEl, render);
        } catch (err2) {
          warn('collectionFocus error', err2 && err2.message);
        }
      }
      log(
        'controller collection refreshed (ctrl=' +
          ctrlName +
          ', focused=' +
          !!focusEl +
          ')'
      );
    } catch (err) {
      warn('refreshFocusCollection error', err && err.message);
    }
  }

  // Lampa внутри full-activity повторно зовёт collectionFocus после нашего
  // full:complite-хука и сбивает фокус на дефолт. Дожимаем несколькими
  // перепроверками на расширяющихся интервалах, останавливаемся как только
  // фокус «прилип» к нашей кнопке.
  function lockButtonFocus(render, btn) {
    var delays = [0, 80, 180, 320, 520, 800];
    for (var i = 0; i < delays.length; i++) {
      (function (delay) {
        setTimeout(function () {
          if (!btn[0] || !btn[0].isConnected) return;
          if (btn.hasClass('focus')) return;
          refreshFocusCollection(render, btn[0]);
        }, delay);
      })(delays[i]);
    }
  }

  function _runInject(movie, render, opts) {
    opts = opts || {};
    if (!movie || !render || !render.find) return;
    if (render.find('.button--continue-watch').length) return;

    var target = pickContinueTarget(movie);
    if (!target) {
      log('no continue target for "' + pickTitle(movie) + '"');
      return;
    }
    var params = target.params;

    // Префетчим то, что юзер скорее всего запустит:
    // - smart-next кейс (есть nextParams) → next эпизод того же торрента
    //   (его file_index в TorrServer ещё не warmed up, на нём и будет ожидание).
    // - иначе current (тот же файл, что показывает кнопка).
    // У nextParams может не быть torrent_link/file_name (stub-запись) —
    // prefetchTorrent сам это обработает (early return), без падения.
    if (!opts.skipPrefetch) {
      var prefetchTargetParams = target.nextParams || params;
      prefetchTorrent(movie, prefetchTargetParams);
    }

    var percent = 0,
      timeStr = '';
    var hash = generateHash(movie, params.season, params.episode);
    var view = safe('Timeline.view', function () {
      return Lampa.Timeline.view(hash);
    });
    if (view && view.percent > 0) {
      percent = view.percent;
      timeStr = formatTime(view.time);
    } else if (params.time) {
      percent = params.percent || 0;
      timeStr = formatTime(params.time);
    }

    var label = 'Продолжить';
    if (params.season && params.episode)
      label += ' S' + params.season + ' E' + params.episode;
    if (timeStr)
      label += ' <span class="cw-btn__time">(' + timeStr + ')</span>';

    var btn = $(buildButtonHtml(((percent * 65.97) / 100).toFixed(2), label));
    btn.on('hover:enter', function () {
      onClickContinue(movie, this, render, target);
    });
    btn.on('hover:long', function () {
      showContextMenu(movie, target, btn, render);
    });

    var anchor = injectButtonAt(render, btn);
    if (!anchor) {
      log('button INJECT failed: no anchor');
      return;
    }

    S.button_injected++;
    log(
      'button INJECTED #' +
        S.button_injected +
        ' anchor=' +
        anchor +
        ' hasNext=' +
        !!target.hasNext +
        ' %=' +
        percent
    );

    lockButtonFocus(render, btn);
  }

  function injectButton(e) {
    S.full_events++;
    var movie = e.data && e.data.movie;
    var render = e.object && e.object.activity && e.object.activity.render
      ? e.object.activity.render()
      : null;
    S.last_full_title = pickTitle(movie);
    S.last_full_movie = movie || null;
    S.last_full_render = render || null;
    log(
      'full:complite #' + S.full_events + ' title="' + S.last_full_title + '"'
    );

    requestAnimationFrame(function () {
      safe('injectButton', function () {
        var latestRender =
          render ||
          (e.object &&
            e.object.activity &&
            e.object.activity.render &&
            e.object.activity.render());
        _runInject(movie, latestRender);
      });
    });
  }

  function attachFullListener() {
    safe('full listener', function () {
      Lampa.Listener.follow('full', function (e) {
        if (e.type === 'complite') injectButton(e);
      });
      log('full:complite listener attached');
    });
  }

  // =========================================================================
  // 13. Профили / Storage listener / миграция
  // =========================================================================
  function attachProfileListener() {
    safe('profile listener', function () {
      Lampa.Listener.follow('profile_select', function () {
        S.mem = null;
        S.title_index = null;
        S.ts_url = null;
        S.files = {};
        ensureSync();
        migrateOld();
        log('profile changed');
      });
    });
  }

  // Lampa Android (форк lampa-app/LAMPA) для внешних плееров (ViMu, MX,
  // DDD и др.) при возврате из плеера зовёт Lampa.Timeline.update(timeline)
  // через WebView — это записывает 'file_view*' в Storage и триггерит
  // 'change'-эвент. Lampa.Player.listener в этом сценарии не работает
  // (см. https://github.com/yumata/lampa-source/issues/244), поэтому
  // file_view-канал — самый надёжный сигнал «прогресс реально сохранён».
  function isFileViewKey(name) {
    if (typeof name !== 'string') return false;
    return (
      name === TIMELINE_STORE_KEY ||
      name.indexOf(TIMELINE_STORE_KEY + '_') === 0
    );
  }

  function timelineStorageKeys(preferredKey) {
    var keys = [];
    var push = function (k) {
      if (k && keys.indexOf(k) === -1) keys.push(k);
    };
    if (isFileViewKey(preferredKey)) push(preferredKey);
    push(TIMELINE_STORE_KEY);
    try {
      var a = Lampa.Account;
      var profile =
        a &&
        a.Permit &&
        a.Permit.account &&
        a.Permit.account.profile &&
        a.Permit.account.profile.id;
      if (typeof profile !== 'undefined') push(TIMELINE_STORE_KEY + '_' + profile);
    } catch (e) {}
    return keys;
  }

  function syncEntryFromFileView(hash, preferredKey) {
    if (!hash) return false;
    var road = null;
    var keys = timelineStorageKeys(preferredKey);
    for (var i = 0; i < keys.length; i++) {
      var fv =
        safe('fv.read', function () {
          return Lampa.Storage.get(keys[i], {});
        }) || {};
      if (fv && fv[hash]) {
        road = fv[hash];
        break;
      }
    }
    if (!road || typeof road !== 'object') return false;
    var pct = typeof road.percent === 'number' ? road.percent : 0;
    var t = road.time || 0;
    var dur = road.duration || 0;
    if (!pct && !t && !dur) return false;
    if (!ensureEntryForLivePlayback(hash)) return false;
    var existing = readParams()[hash];
    if (
      pct >= 100 &&
      t === 0 &&
      dur === 0 &&
      existing &&
      existing.time > 0
    ) {
      t = existing.time;
      dur = existing.duration || dur;
    }
    updateEntry(hash, {percent: pct, time: t, duration: dur});
    return true;
  }

  function onFileViewChanged(name) {
    var card =
      S.last_player_card || S.session_play_card || S.last_launched_card;
    var h = S.last_player_hash || S.session_play_hash;
    if (h) syncEntryFromFileView(h, name);
    if (!card) return;
    S.last_card_refresh_at = 0;
    refreshActiveCardSoon(card, 'file_view changed');
  }

  function attachStorageListener() {
    safe('storage listener', function () {
      Lampa.Storage.listener.follow('change', function (e) {
        if (!e || !e.name) return;
        if (
          typeof e.name === 'string' &&
          e.name.indexOf('continue_watch_params') === 0
        ) {
          S.mem = null;
          S.title_index = null;
        }
        if (e.name === 'account') {
          S.mem = null;
          S.title_index = null;
          ensureSync();
          migrateOld();
        }
        if (
          e.name === 'torrserver_url' ||
          e.name === 'torrserver_url_two' ||
          e.name === 'torrserver_use_link'
        ) {
          S.ts_url = null;
        }
        if (isFileViewKey(e.name)) {
          S.file_view_changes++;
          log('storage change: ' + e.name + ' (file_view) — syncing progress');
          onFileViewChanged(e.name);
        }
      });
    });
  }

  function migrateOld() {
    safe('migrateOld', function () {
      if (
        !(
          S.account_ready &&
          Lampa.Account &&
          Lampa.Account.Permit &&
          Lampa.Account.Permit.sync
        )
      )
        return;
      if (Lampa.Storage.get(MIGRATION_FLAG_KEY, false)) return;
      var oldData = Lampa.Storage.get('continue_watch_params', {});
      var newKey = activeKey();
      var newData = Lampa.Storage.get(newKey, {});
      if (Object.keys(oldData).length && !Object.keys(newData).length) {
        Lampa.Storage.set(newKey, oldData);
        log('migration: copied to', newKey);
      }
      Lampa.Storage.set(MIGRATION_FLAG_KEY, true);
    });
  }

  // =========================================================================
  // 14. Manifest
  // =========================================================================
  function registerManifest() {
    safe('Manifest', function () {
      if (!Lampa.Manifest) return;
      Lampa.Manifest.plugins = {
        type: 'video',
        version: PLUGIN_VERSION,
        name: PLUGIN_NAME,
        description:
          'Кнопка «Продолжить» на карточке. © 2026 · Sergey0s · github.com/Sergey0s',
        component: COMPONENT_ID,
      };
    });
  }

  // =========================================================================
  // 15. Экран диагностики (Lampa.Component)
  // =========================================================================
    function DiagComponent(object) {
      // ВАЖНО (см. lampa-source/src/interaction/activity/activity.js → create):
      //   let comp = Component.create(object)        // здесь конструктор
      //   object.activity = new ActivitySlide(...)
      //   comp.activity = object.activity            // ← activity появляется ПОСЛЕ
      //   object.activity.create()                   // → comp.create(body)
      // Поэтому в конструкторе обращаться к `this.activity` ещё нельзя, и весь
      // тяжёлый рендер обязан жить внутри create()/start(); любое исключение
      // в конструкторе приведёт Lampa к подмене на `nocomponent` («Здесь пусто»).
      var self = this;
      var outer = $('<div class="cw-diag"></div>');
      var body = $('<div class="cw-diag__scroll"></div>');
      var focusIndex = 0;
      var built = false;

      function dismissEmpty(allowToggle) {
        try {
          if (self.activity && self.activity.loader) self.activity.loader(false);
        } catch (e) {}
        try {
          if (allowToggle && self.activity && self.activity.toggle) self.activity.toggle();
        } catch (e) {}
      }

    function row(label, value, accent) {
      return $(
        '<div class="selector cw-diag__row' +
          (accent ? ' cw-diag__row--accent' : '') +
          '">' +
          '<div class="cw-diag__label">' +
          label +
          '</div>' +
          '<div class="cw-diag__value">' +
          value +
          '</div></div>'
      );
    }

    function scrollFocusedIntoView() {
      var focused = body.find('.focus').first();
      if (!focused.length) focused = body.find('.selector').first();
      if (!focused.length) return;
      try {
        var el = focused[0];
        var top = el.offsetTop;
        var bottom = top + el.offsetHeight;
        var viewTop = body.scrollTop();
        var viewBottom = viewTop + body.innerHeight();
        if (top < viewTop) body.scrollTop(Math.max(0, top - 20));
        else if (bottom > viewBottom)
          body.scrollTop(bottom - body.innerHeight() + 20);
      } catch (e) {}
    }

    function focusDiag(index) {
      var items = body.find('.selector');
      if (!items.length) return;
      if (index < 0) index = 0;
      if (index >= items.length) index = items.length - 1;
      focusIndex = index;
      items.removeClass('focus');
      var el = items.eq(focusIndex);
      el.addClass('focus');
      scrollFocusedIntoView();
    }

    function moveDiag(delta) {
      focusDiag(focusIndex + delta);
    }

    function enterDiag() {
      var el = body.find('.selector').eq(focusIndex);
      if (!el.length) return;
      el.trigger('hover:enter');
    }

    function entry(p, hash) {
      var sub =
        p.season && p.episode ? 'S' + p.season + ' E' + p.episode : 'фильм';
      var meta =
        (p.percent ? Math.round(p.percent) : 0) +
        '% · ' +
        (p.time ? formatTime(p.time) : '0:00') +
        ' / ' +
        (p.duration ? formatTime(p.duration) : '?') +
        ' · ' +
        (p.timestamp ? new Date(p.timestamp).toLocaleString() : '—');
      var torr = p.torrent_link
        ? 'магнет: ' +
          (p.torrent_link.length > 60
            ? p.torrent_link.slice(0, 60) + '…'
            : p.torrent_link)
        : 'без магнета';
      return (
        '<div class="selector cw-diag__entry">' +
          '<div class="cw-diag__entry-title">' +
          (p.title || '—') +
          ' · <span class="cw-diag__sub">' +
          sub +
          '</span></div>' +
          '<div class="cw-diag__entry-meta">' +
          meta +
          '</div>' +
          '<div class="cw-diag__entry-meta cw-diag__entry-torr">hash: ' +
          hash +
          ' · ' +
          torr +
          '</div></div>'
      );
    }

    this.create = function () {
      buildBody();
      dismissEmpty(true);
    };
    this.render = function () {
      return outer;
    };

    this.start = function () {
      try { buildBody(); } catch (e) { cwError('DiagComponent.start.buildBody', e); }
      try { dismissEmpty(false); } catch (e) { cwError('DiagComponent.start.dismissEmpty', e); }
      try {
      Lampa.Controller.add(COMPONENT_ID, {
        // invisible:true — выключаем Lampa Navigator для нашего экрана.
        // Мы сами рулим up/down/enter через focusDiag/moveDiag/enterDiag и
        // не вызываем collectionSet/collectionFocus, иначе Navigator бесконечно
        // фокусирует наш .selector → triggers .on('focus', '.selector') →
        // снова collectionFocus → stack overflow (см. v136 RangeError).
        invisible: true,
        toggle: function () {
          focusDiag(focusIndex || 0);
        },
        left: function () {
          Lampa.Controller.toggle('menu');
        },
        up: function () {
          moveDiag(-1);
        },
        down: function () {
          moveDiag(1);
        },
        right: function () {
          moveDiag(1);
        },
        enter: enterDiag,
        ok: enterDiag,
        back: function () {
          Lampa.Activity.backward();
        },
      });
      Lampa.Controller.toggle(COMPONENT_ID);
      } catch (e) { cwError('DiagComponent.start.controller', e); }
    };

    this.pause = function () {};
    this.stop = function () {};
    this.destroy = function () {
      try { outer.remove(); } catch (e) { cwError('DiagComponent.destroy', e); }
    };

    function buildBody() {
      if (built) return;
      built = true;
      try {

    // ---- timing трассировка (см. v135) ----
    var __timings = [];
    var __t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var __tPrev = __t0;
    function __mark(label) {
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      __timings.push({ label: label, ms: now - __tPrev, total: now - __t0 });
      __tPrev = now;
    }

    var params = readParams();                                      __mark('readParams (' + Object.keys(params).length + ')');
    var keys = Object.keys(params).sort(function (a, b) {
      return (params[b].timestamp || 0) - (params[a].timestamp || 0);
    });                                                              __mark('sort keys');
    var tsU = torrUrl();                                             __mark('torrUrl');

    body.append(
      '<div class="cw-diag__title">Продолжить · v' + PLUGIN_VERSION + '</div>'
    );
    body.append(row('Ключ хранилища', S.active_key || '—', true));
    body.append(row('Записей в storage', '<b>' + keys.length + '</b>', true));
    body.append(
      row(
        'TorrServer URL',
        tsU || '<span style="color:#f66">не настроен</span>',
        true
      )
    );

    if (!tsU) {
      var t = dumpTorrKeys();
      var names = Object.keys(t);
      body.append(
        row(
          'torr-ключи в storage',
          names.length
            ? names
                .map(function (k) {
                  return k + '=' + t[k];
                })
                .join(' · ')
            : '<span style="color:#f66">не найдено</span>'
        )
      );
    }

    body.append(row('События full:complite', S.full_events));
    body.append(row('Кнопок вставлено', S.button_injected));
    body.append(row('Перехватов Player.play()', S.play_intercepted));
    body.append(row('Последняя карточка', S.last_full_title || '—'));
    body.append(
      row(
        'Последний play.url',
        S.last_play_url
          ? S.last_play_url.length > 90
            ? S.last_play_url.slice(0, 90) + '…'
            : S.last_play_url
          : '—'
      )
    );
    if (S.last_lookup) {
      body.append(
        row(
          'Последний поиск',
          S.last_lookup.kind +
            ' · "' +
            S.last_lookup.title +
            '" · ' +
            (S.last_lookup.found
              ? '<span style="color:#7c7">найдено</span>'
              : '<span style="color:#f66">не найдено</span>') +
            ' · keys=' +
            S.last_lookup.total +
            (S.last_lookup.reason ? ' · ' + S.last_lookup.reason : '')
        )
      );
    }

    __mark('top rows');

    var actNow =
      Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active();
    var activeMovie =
      actNow && (actNow.movie || (actNow.activity && actNow.activity.movie));
    if (activeMovie) {
      var inspectTarget = pickContinueTarget(activeMovie);
      if (inspectTarget && inspectTarget.params) {
        var cur = inspectTarget.params;
        var curHash = generateHash(activeMovie, cur.season, cur.episode);
        var curTl =
          safe('diag.curTimeline', function () {
            return Lampa.Timeline.view(curHash);
          }) || {};
        var fv =
          safe('diag.fileView', function () {
            return Lampa.Storage.get(TIMELINE_STORE_KEY, {});
          }) || {};
        var curFv = fv[curHash] || {};
        var currentLabel =
          (cur.season ? 'S' + cur.season + ' E' + cur.episode : 'фильм') +
          ' · params ' +
          (cur.percent || 0) +
          '% ' +
          formatTime(cur.time || 0) +
          ' · timeline ' +
          (curTl.percent || 0) +
          '% ' +
          formatTime(curTl.time || 0) +
          ' · file_view ' +
          (curFv.percent || 0) +
          '% ' +
          formatTime(curFv.time || 0) +
          ' · index=' +
          (typeof cur.file_index === 'number' ? cur.file_index : '—') +
          ' · file=' +
          (cur.file_name
            ? '<span style="color:#7c7">yes</span>'
            : '<span style="color:#f66">no</span>');
        body.append(row('▸ inspect: current', currentLabel, true));

        if (inspectTarget.nextParams) {
          var nxt = inspectTarget.nextParams;
          body.append(
            row(
              '▸ inspect: next',
              'S' +
                nxt.season +
                ' E' +
                nxt.episode +
                ' · index=' +
                (typeof nxt.file_index === 'number' ? nxt.file_index : '—') +
                ' · file=' +
                (nxt.file_name
                  ? '<span style="color:#7c7">yes</span>'
                  : '<span style="color:#f66">no</span>') +
                (nxt.synthetic_next ? ' · synthetic' : '') +
                ' · smart-next=' +
                (inspectTarget.hasNext
                  ? '<span style="color:#7c7">yes</span>'
                  : 'no'),
              true
            )
          );
        } else {
          body.append(
            row(
              '▸ inspect: next',
              inspectTarget.hasNext
                ? '<span style="color:#f66">hasNext=true, но nextParams пустой</span>'
                : '<span style="opacity:.6">не выбран</span>',
              true
            )
          );
        }
      } else {
        body.append(
          row(
            '▸ inspect: active card',
            '"' +
              pickTitle(activeMovie) +
              '" · <span style="color:#f66">continue target не найден</span>',
            true
          )
        );
      }
    } else {
      body.append(
        row(
          '▸ inspect: active card',
          '<span style="opacity:.6">нет активной карточки</span>',
          true
        )
      );
    }

    body.append(
      row(
        'Debug log',
        DEBUG
          ? 'включён · cw.debug(false) чтобы выключить'
          : 'выключен · cw.debug(true) чтобы включить'
      )
    );
    body.append(
      row(
        'Окно буферизации',
        (bufferingEnabled()
          ? '<span style="color:#7c7">ВКЛ</span>'
          : '<span style="color:#f66">ВЫКЛ</span>') +
          ' · порог авто-старта: <b>' +
          bufferThreshold() +
          '%</b> · <span style="opacity:.6">cw.buffer(true|false, %)</span>'
      )
    );
    var prefetchStatus = '';
    if (S.last_prefetched_link) {
      prefetchStatus =
        ' · буфер: <b>' +
        S.prefetch_pct +
        '%</b>' +
        ' · скорость: ' +
        fmtSpeed(S.prefetch_speed) +
        (S.prefetch_target_reached
          ? ' · <span style="color:#7c7">цель достигнута</span>'
          : S.prefetch_poll_iv
          ? ' · <span style="color:#fc7">в процессе…</span>'
          : '');
    }
    body.append(
      row(
        'Фоновый prefetch',
        (prefetchEnabled()
          ? '<span style="color:#7c7">ВКЛ</span>'
          : '<span style="color:#f66">ВЫКЛ</span>') +
          ' · цель: <b>' +
          prefetchTarget() +
          '%</b>' +
          ' · запусков: <b>' +
          S.prefetched +
          '</b>' +
          prefetchStatus +
          ' · <span style="opacity:.6">cw.prefetch(true|false, %)</span>'
      )
    );

    if (S.last_prefetched_link) {
      var pfState = S.prefetch_target_reached
        ? '<span style="color:#7c7">готово</span>'
        : S.prefetch_poll_iv
        ? '<span style="color:#fc7">качается…</span>'
        : '<span style="opacity:.6">остановлен</span>';
      var sinceMs = S.prefetch_started_at
        ? Date.now() - S.prefetch_started_at
        : 0;
      var sinceStr = sinceMs ? Math.round(sinceMs / 1000) + 'с назад' : '—';
      var linkLabel =
        (S.last_prefetched_link || '').slice(0, 60) +
        (S.last_prefetched_link.length > 60 ? '…' : '');
      var hashLabel = S.prefetch_hash
        ? S.prefetch_hash.slice(0, 16) + '…'
        : '<span style="opacity:.6">нет</span>';
      var matchedEntry = (function () {
        var p = readParams();
        var ix = S.title_index || buildIndex();
        for (var t in ix) {
          var hashes = ix[t];
          for (var k = 0; k < hashes.length; k++) {
            var rec = p[hashes[k]];
            if (
              rec &&
              rec.torrent_link === S.last_prefetched_link &&
              (typeof rec.file_index !== 'number' ||
                rec.file_index === S.last_prefetched_index)
            ) {
              return rec;
            }
          }
        }
        return null;
      })();
      var epLabel =
        matchedEntry && matchedEntry.season
          ? '"' + matchedEntry.title + '" S' + matchedEntry.season + ' E' + matchedEntry.episode
          : matchedEntry
          ? '"' + matchedEntry.title + '"'
          : '<span style="opacity:.6">не привязан к нашей записи</span>';
      body.append(
        row(
          '▸ активный prefetch-таргет',
          pfState +
            ' · буфер: <b>' +
            S.prefetch_pct +
            '%</b>' +
            ' · скорость: ' +
            fmtSpeed(S.prefetch_speed) +
            ' · стартовал: ' +
            sinceStr +
            '<br><span style="opacity:.7;font-family:monospace;font-size:.85em">' +
            'index=<b>' +
            (S.last_prefetched_index === null ? '—' : S.last_prefetched_index) +
            '</b>' +
            ' · hash=' +
            hashLabel +
            ' · файл: ' +
            epLabel +
            '<br>link=' +
            linkLabel +
            '</span>'
        )
      );
    } else {
      body.append(
        row(
          '▸ активный prefetch-таргет',
          '<span style="opacity:.6">не запущен</span>'
        )
      );
    }

    var mem = memorySnapshot();
    body.append(
      row(
        'Eco cleanup',
        (ecoModeEnabled()
          ? '<span style="color:#7c7">ВКЛ</span>'
          : '<span style="color:#f66">ВЫКЛ</span>') +
          ' · cleanups: <b>' +
          S.cleanup_count +
          '</b>' +
          (S.last_cleanup_at
            ? ' · ' +
              S.last_cleanup_reason +
              ' · ' +
              new Date(S.last_cleanup_at).toLocaleTimeString()
            : '') +
          ' · files cache: <b>' +
          Object.keys(S.files).length +
          '</b>' +
          ' · pending: <b>' +
          Object.keys(S.files_pending).length +
          '</b>' +
          ' · active poll: <b>' +
          (S.prefetch_poll_iv ? 'yes' : 'no') +
          '</b>' +
          ' · <span style="opacity:.6">cw.eco(true|false), cw.cleanup()</span>'
      )
    );
    body.append(
      row(
        'JS heap',
        mem
          ? fmtBytes(mem.used) +
              ' / ' +
              fmtBytes(mem.total) +
              ' · limit ' +
              fmtBytes(mem.limit)
          : '<span style="opacity:.6">performance.memory недоступен в этом WebView</span>'
      )
    );

    var uptimeMs = S.boot_at ? Date.now() - S.boot_at : 0;
    var uptimeMin = uptimeMs / 60000;
    var heapDelta = mem && S.boot_heap_used ? mem.used - S.boot_heap_used : 0;
    var heapPerMin = uptimeMin > 0.5 && heapDelta ? heapDelta / uptimeMin : 0;

    // Активные «удержания» (то что прямо сейчас держит CPU/память):
    // - prefetch poll-интервал (1.5с тики опроса TorrServer)
    // - storage debounce (отложенная запись в Lampa.Storage)
    // - открытый buffer-modal (свой 1с poll внутри)
    // - открытый Select/center-confirm модал
    // - in-flight XHR запросы к TorrServer
    var holds = [];
    if (S.prefetch_poll_iv)
      holds.push(
        'prefetch poll (' + (PREFETCH_POLL_MS / 1000).toFixed(1) + 'с)'
      );
    if (TIMERS.save) holds.push('storage debounce');
    if (TIMERS.click) holds.push('click debounce');
    if (S.buffer_close) holds.push('buffer modal poll');
    if (S.modal_open) holds.push('confirm modal');
    if (S.active_xhrs > 0) holds.push(S.active_xhrs + ' XHR в полёте');

    var rate = function (n) {
      if (uptimeMin < 0.5) return n + '';
      return n + ' (' + (n / uptimeMin).toFixed(1) + '/мин)';
    };

    body.append(
      row(
        '▸ нагрузка плагина',
        'uptime: <b>' +
          fmtUptime(uptimeMs) +
          '</b>' +
          (heapDelta
            ? ' · heap: <b>' +
              fmtSignedBytes(heapDelta) +
              '</b>' +
              (heapPerMin ? ' (' + fmtSignedBytes(heapPerMin) + '/мин)' : '')
            : '') +
          ' · WebView: ' +
          (document.hidden
            ? '<span style="color:#fc7">hidden</span>'
            : '<span style="color:#7c7">visible</span>') +
          '<br><span style="opacity:.7;font-family:monospace;font-size:.85em">' +
          'активно: ' +
          (holds.length
            ? '<b>' + holds.join(' · ') + '</b>'
            : '<span style="opacity:.6">ничего</span>') +
          '<br>события: timeline=' +
          rate(S.timeline_updates) +
          ' · file_view=' +
          rate(S.file_view_changes) +
          ' · full:complite=' +
          S.full_events +
          '<br>сеть: TorrServer=' +
          S.ts_requests +
          ' (ошибок ' +
          S.ts_request_errors +
          ')' +
          ' · XHR в полёте: <b>' +
          S.active_xhrs +
          '</b>' +
          ' · plugin keys: <b>' +
          Object.keys(S.mem || {}).length +
          '</b>' +
          '</span>'
      )
    );

    body.append(
      row(
        'Smart next-episode',
        'порог: <b>' +
          SMART_NEXT_PCT +
          '%</b>' +
          ' · подтверждение: ' +
          (smartNextConfirmEnabled()
            ? '<span style="color:#7c7">ВКЛ</span>'
            : '<span style="color:#f66">ВЫКЛ</span>') +
          ' · long-press на «Продолжить» — контекстное меню' +
          ' · <span style="opacity:.6">cw.smartNextConfirm(true|false)</span>'
      )
    );
    body.append(
      row(
        'Уведомление при выходе',
        (exitSummaryEnabled()
          ? '<span style="color:#7c7">ВКЛ</span>'
          : '<span style="color:#f66">ВЫКЛ</span>') +
          ' · показывается один раз за сеанс плеера' +
          (S.last_exit_summary_at
            ? ' · последнее: ' +
              new Date(S.last_exit_summary_at).toLocaleTimeString()
            : '') +
          ' · <span style="opacity:.6">cw.exitSummary(true|false)</span>'
      )
    );
    body.append(
      row(
        'TorrServer add',
        'magnet → infohash на клиенте + GET /stream?preload (simple CORS, без preflight); перед add в модалке — GET /echo health-check'
      )
    );

    __mark('middle blocks');

    body.append('<div class="cw-diag__sect">Сохранённые записи</div>');
    if (!keys.length) {
      body.append(
        '<div class="cw-diag__empty">Записей нет. Запустите воспроизведение через Торренты — здесь должна появиться запись.</div>'
      );
    } else {
      var entriesHtml = '';
      var entriesLimit = Math.min(keys.length, 50);
      for (var i = 0; i < entriesLimit; i++) {
        entriesHtml += entry(params[keys[i]], keys[i]);
      }
      if (keys.length > 50) {
        entriesHtml +=
          '<div class="cw-diag__empty">…и ещё ' + (keys.length - 50) + '</div>';
      }
      body.append(entriesHtml);
    }
    __mark('saved entries (' + Math.min(keys.length, 50) + ')');

    var clearBtn = $(
      '<div class="selector cw-diag__btn">Очистить все записи</div>'
    );
    clearBtn.on('hover:enter', function () {
      safe('clear', function () {
        Lampa.Storage.set(S.active_key || 'continue_watch_params', {});
      });
      S.mem = null;
      S.title_index = null;
      noty('Очищено');
      Lampa.Activity.replace({
        component: COMPONENT_ID,
        title: 'Продолжить · диагностика',
      });
    });
    body.append(clearBtn);

    body.on('wheel', function (e) {
      var oe = e.originalEvent || e;
      body.scrollTop(body.scrollTop() + (oe.deltaY || 0));
    });
    body.on('hover:focus focus mouseenter', '.selector', function () {
      var idx = body.find('.selector').index(this);
      if (idx >= 0) focusIndex = idx;
      setTimeout(scrollFocusedIntoView, 0);
    });
    outer.append(body);
    __mark('attach listeners + outer');

    var __timingsHtml = '';
    for (var __i = 0; __i < __timings.length; __i++) {
      var __t = __timings[__i];
      var __color = __t.ms > 200 ? '#f66' : (__t.ms > 50 ? '#fc7' : '#7c7');
      __timingsHtml +=
        '<div style="display:flex;justify-content:space-between;font-family:monospace;font-size:.85em;padding:.15em .3em;border-bottom:1px dashed rgba(255,255,255,.06)">' +
        '<span style="opacity:.75">' + __t.label + '</span>' +
        '<span style="color:' + __color + ';font-weight:bold">' + __t.ms.toFixed(1) + ' ms</span>' +
        '</div>';
    }
    var __totalMs = ((window.performance && performance.now) ? performance.now() : Date.now()) - __t0;
    body.prepend(
      '<div class="cw-diag__row cw-diag__row--accent" style="display:block;margin-bottom:.6em">' +
      '<div style="display:flex;justify-content:space-between;font-weight:bold;margin-bottom:.4em">' +
      '<span>▸ build timing</span><span style="color:' + (__totalMs > 500 ? '#f66' : '#7c7') + '">total ' + __totalMs.toFixed(1) + ' ms</span>' +
      '</div>' + __timingsHtml + '</div>'
    );

      } catch (err) {
        log('DiagComponent build error:', err && err.message);
        try {
          body.empty();
          body.append(
            '<div class="cw-diag__title">Продолжить · диагностика v' + PLUGIN_VERSION + '</div>'
          );
          body.append(
            '<div class="cw-diag__empty">⚠ ошибка построения диагностики: ' +
            ((err && err.message) || 'unknown') + '</div>'
          );
          if (err && err.stack) {
            body.append(
              '<div class="cw-diag__empty" style="font-family:monospace;font-size:.78em;opacity:.55;white-space:pre-wrap;word-break:break-all">' +
              String(err.stack).replace(/</g, '&lt;') + '</div>'
            );
          }
          outer.append(body);
        } catch (e2) {}
      }
    }
  }

  // =========================================================================
  // 16. Меню + стили
  // =========================================================================
  function addStyles() {
    var css =
      '.cw-diag{height:100%;padding:0}' +
      '.cw-diag__scroll{height:100%;max-height:100vh;overflow-y:auto;padding:1.5em;padding-bottom:6rem;box-sizing:border-box}' +
      '.cw-diag__title{font-size:1.6em;font-weight:bold;margin-bottom:1em}' +
      '.cw-diag__row{display:flex;justify-content:space-between;padding:.5em .8em;margin-bottom:.3em;background:rgba(255,255,255,.04);border-radius:.4em;font-size:.95em}' +
      '.cw-diag__row--accent{background:rgba(124,58,237,.15)}' +
      '.cw-diag__row.focus{background:#fff;color:#000}' +
      '.cw-diag__label{opacity:.7}' +
      '.cw-diag__value{font-family:monospace;text-align:right;max-width:60%;word-break:break-all}' +
      '.cw-diag__sect{margin:1.4em 0 .7em;font-size:1.2em;font-weight:bold;border-left:4px solid #7c3aed;padding-left:.5em}' +
      '.cw-diag__empty{padding:1em;opacity:.6;font-style:italic}' +
      '.cw-diag__entry{padding:.7em 1em;margin-bottom:.4em;background:rgba(255,255,255,.05);border-radius:.5em}' +
      '.cw-diag__entry.focus{background:#fff;color:#000}' +
      '.cw-diag__entry-title{font-weight:bold;margin-bottom:.2em}' +
      '.cw-diag__entry-meta{opacity:.75;font-size:.85em;font-family:monospace}' +
      '.cw-diag__entry.focus .cw-diag__entry-meta{opacity:.85}' +
      '.cw-diag__entry-torr{margin-top:.2em;word-break:break-all}' +
      '.cw-diag__sub{opacity:.7;font-weight:normal}' +
      '.cw-diag__btn{display:inline-block;padding:.7em 1.4em;margin-top:1.5em;background:rgba(220,50,50,.2);border-radius:.5em;cursor:pointer}' +
      '.cw-diag__btn.focus{background:#fff;color:#000}' +
      '.cw-menu-ver{margin-left:.4em;font-size:.7em;opacity:.55;font-weight:normal}' +
      '.button--continue-watch .cw-btn__ico{margin-right:.5em}' +
      '.button--continue-watch .cw-btn__ring{opacity:.5}' +
      '.button--continue-watch .cw-btn__time{opacity:.7;font-size:.9em;margin-left:.3em}' +
      '.cw-cnf{position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1em}' +
      '.cw-cnf__card{background:#1a1a1f;border-radius:1em;padding:1.4em 1.6em;min-width:26em;max-width:34em;box-shadow:0 12px 40px rgba(0,0,0,.6);color:#fff;text-align:center}' +
      '.cw-cnf__title{font-size:1.2em;font-weight:bold;margin-bottom:.4em}' +
      '.cw-cnf__sub{opacity:.75;font-size:1em;margin-bottom:1.2em}' +
      '.cw-cnf__btns{display:flex;gap:.6em}' +
      '.cw-cnf__btn{flex:1;padding:.85em 1em;text-align:center;border-radius:.5em;background:rgba(255,255,255,.08);cursor:pointer;font-size:1em;line-height:1.2}' +
      '.cw-cnf__btn--primary{background:rgba(124,58,237,.4)}' +
      '.cw-cnf__btn.focus{background:#fff;color:#000}' +
      '.cw-cnf__foot{margin-top:.9em;font-size:.85em;opacity:.55;cursor:pointer;padding:.4em}' +
      '.cw-cnf__foot.focus{opacity:1;color:#fff;background:rgba(255,255,255,.1);border-radius:.4em}' +
      '.cw-buf{position:fixed;inset:0;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1em;font-size:1em}' +
      '.cw-buf__card{background:#1a1a1f;border-radius:1em;padding:1.6em 2em;min-width:38em;max-width:48em;box-shadow:0 12px 40px rgba(0,0,0,.6);color:#fff}' +
      '.cw-buf__head{display:flex;align-items:center;gap:1em;margin-bottom:1em}' +
      '.cw-buf__title{font-size:1.4em;font-weight:bold}' +
      '.cw-buf__sub{opacity:.7;font-size:1em;margin-top:.2em}' +
      '.cw-buf__file{opacity:.55;font-size:.85em;font-family:monospace;word-break:break-all;margin-bottom:1em}' +
      '.cw-buf__spinner{width:2.6em;height:2.6em;border:.3em solid rgba(124,58,237,.25);border-top-color:#7c3aed;border-radius:50%;animation:cw-spin .9s linear infinite;flex-shrink:0}' +
      '@keyframes cw-spin{to{transform:rotate(360deg)}}' +
      '.cw-buf__bar{height:.7em;background:rgba(255,255,255,.08);border-radius:.4em;overflow:hidden;margin:.2em 0 .4em}' +
      '.cw-buf__bar-fill{height:100%;background:linear-gradient(90deg,#7c3aed,#a78bfa);border-radius:.4em;transition:width .3s ease;width:0%}' +
      '.cw-buf__pct{font-size:1.6em;font-weight:bold;text-align:right;margin-bottom:1em}' +
      '.cw-buf__stats{display:grid;grid-template-columns:1fr 1fr;gap:.5em 1.5em;margin-bottom:1.4em}' +
      '.cw-buf__stat{display:flex;justify-content:space-between;padding:.3em 0;border-bottom:1px dashed rgba(255,255,255,.08);font-size:.95em}' +
      '.cw-buf__lab{opacity:.6}' +
      '.cw-buf__val{font-family:monospace;font-weight:bold}' +
      '.cw-buf__btns{display:flex;gap:.7em}' +
      '.cw-buf__btn{flex:1;padding:.85em 1em;text-align:center;border-radius:.5em;background:rgba(255,255,255,.08);cursor:pointer;font-size:1em}' +
      '.cw-buf__btn--launch{background:rgba(124,58,237,.4)}' +
      '.cw-buf__btn.focus{background:#fff;color:#000}' +
      '.cw-buf__hint{margin-top:.9em;font-size:.8em;opacity:.45;text-align:center;font-family:monospace}';
    $('<style>' + css + '</style>').appendTo('head');
  }

  function tryAddMenu() {
    if ($('.menu .menu__item[data-action="' + MENU_DATA_ACTION + '"]').length)
      return true;
    var list = $('.menu .menu__list').eq(0);
    if (!list.length) return false;

    var item = $(
      '<li class="menu__item selector" data-action="' +
        MENU_DATA_ACTION +
        '">' +
        '<div class="menu__ico">' +
        '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M8 5v14l11-7L8 5z" fill="currentColor"/>' +
        '<circle cx="12" cy="12" r="10.5" stroke="currentColor" stroke-width="1.5" fill="none"/>' +
        '</svg>' +
        '</div>' +
        '<div class="menu__text">' +
        PLUGIN_NAME +
        ' <span class="cw-menu-ver">v' +
        PLUGIN_VERSION +
        '</span></div>' +
        '</li>'
    );
    item.on('hover:enter', function () {
      safe('Activity.push', function () {
        Lampa.Activity.push({
          url: '',
          title: 'Продолжить · диагностика v' + PLUGIN_VERSION,
          component: COMPONENT_ID,
          page: 1,
        });
      });
    });
    list.append(item);
    log('menu button added');
    return true;
  }

  function addMenuRobust() {
    if (tryAddMenu()) return;
    var attempts = 0;
    var iv = 0;
    var mo = null;
    var cleanup = function () {
      if (iv) {
        clearInterval(iv);
        iv = 0;
      }
      if (mo) {
        try {
          mo.disconnect();
        } catch (e) {}
        mo = null;
      }
    };
    var tick = function () {
      attempts++;
      if (tryAddMenu() || attempts >= MENU_RETRY_MAX) cleanup();
    };
    try {
      mo = new MutationObserver(function () {
        if (tryAddMenu()) cleanup();
      });
      mo.observe(document.documentElement, {childList: true, subtree: true});
    } catch (e) {}
    iv = setInterval(tick, MENU_RETRY_MS);
  }

  // =========================================================================
  // 17. Debug API (window.cw)
  // =========================================================================
  function exposeCw() {
    window.cw = {
      version: PLUGIN_VERSION,
      state: S,
      debug: function (v) {
        DEBUG = !!v;
        log('debug=' + DEBUG);
        if (window.console) console.log('[CW] debug=' + DEBUG);
      },
      errors: function (n) {
        var arr = (window.cw_errors || []).slice(-(n || 20));
        try { console.table(arr); } catch (e) { console.log(arr); }
        return arr;
      },
      toast: function (msg, kind) { cwToast(msg, kind || 'info'); },
      dump: function () {
        var p = readParams();
        console.log('[CW] key:', S.active_key, 'count:', Object.keys(p).length);
        console.log('[CW] entries:', p);
        return p;
      },
      find: function (q) {
        var p = readParams();
        var r = {};
        var qLow = String(q || '').toLowerCase();
        for (var h in p)
          if ((p[h].title || '').toLowerCase().indexOf(qLow) !== -1)
            r[h] = p[h];
        console.log('[CW] find("' + q + '"):', r);
        return r;
      },
      inspect: function (q) {
        var act =
          Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active();
        var activeMovie =
          act && (act.movie || (act.activity && act.activity.movie));
        var titleQuery = String(
          q || pickTitle(activeMovie) || ''
        ).toLowerCase();
        var params = readParams();
        var out = {
          version: PLUGIN_VERSION,
          active_title: pickTitle(activeMovie),
          query: titleQuery,
          key: S.active_key,
          target: null,
          entries: [],
          prefetch: {
            enabled: prefetchEnabled(),
            target: prefetchTarget(),
            last_pct: S.prefetch_pct,
            reached: S.prefetch_target_reached,
            polling: !!S.prefetch_poll_iv,
            last_index: S.last_prefetched_index,
            speed: S.prefetch_speed,
          },
          runtime: {
            modal_open: S.modal_open,
            buffer_open: !!S.buffer_close,
            active_xhrs: S.active_xhrs,
            timeline_updates: S.timeline_updates,
            file_view_changes: S.file_view_changes,
          },
        };

        var movie = activeMovie;
        if (!movie && titleQuery) {
          movie = {
            title: titleQuery,
            name: titleQuery,
            number_of_seasons: true,
          };
        }

        if (movie) {
          var target = pickContinueTarget(movie);
          if (target) {
            out.target = {
              current: target.params
                ? {
                    season: target.params.season,
                    episode: target.params.episode,
                    percent: target.params.percent,
                    time: target.params.time,
                    duration: target.params.duration,
                    file_index: target.params.file_index,
                    has_file: !!(
                      target.params.file_name && target.params.torrent_link
                    ),
                  }
                : null,
              hasNext: !!target.hasNext,
              next: target.nextParams
                ? {
                    season: target.nextParams.season,
                    episode: target.nextParams.episode,
                    percent: target.nextParams.percent,
                    time: target.nextParams.time,
                    duration: target.nextParams.duration,
                    file_index: target.nextParams.file_index,
                    has_file: !!(
                      target.nextParams.file_name &&
                      target.nextParams.torrent_link
                    ),
                    synthetic: !!target.nextParams.synthetic_next,
                  }
                : null,
              currentPercent: target.currentPercent,
              lookup: S.last_lookup,
            };
          } else {
            out.target = {missing: true, lookup: S.last_lookup};
          }
        }

        var fv =
          safe('inspect.file_view', function () {
            return Lampa.Storage.get(TIMELINE_STORE_KEY, {});
          }) || {};
        var qLow = titleQuery;
        for (var h in params) {
          var rec = params[h];
          if (!rec || !rec.title) continue;
          if (qLow && String(rec.title).toLowerCase().indexOf(qLow) === -1)
            continue;
          var tl =
            safe('inspect.timeline', function () {
              return Lampa.Timeline.view(h);
            }) || null;
          out.entries.push({
            hash: h,
            title: rec.title,
            season: rec.season,
            episode: rec.episode,
            percent: rec.percent,
            time: rec.time,
            duration: rec.duration,
            file_index: rec.file_index,
            has_file: !!(rec.file_name && rec.torrent_link),
            synthetic_next: !!rec.synthetic_next,
            timestamp: rec.timestamp,
            timeline: tl
              ? {percent: tl.percent, time: tl.time, duration: tl.duration}
              : null,
            file_view: fv[h]
              ? {
                  percent: fv[h].percent,
                  time: fv[h].time,
                  duration: fv[h].duration,
                }
              : null,
          });
        }
        out.entries.sort(function (a, b) {
          if ((a.season || 0) !== (b.season || 0))
            return (a.season || 0) - (b.season || 0);
          if ((a.episode || 0) !== (b.episode || 0))
            return (a.episode || 0) - (b.episode || 0);
          return (b.timestamp || 0) - (a.timestamp || 0);
        });
        console.log('[CW] inspect:', out);
        return out;
      },
      clear: function () {
        safe('clear', function () {
          Lampa.Storage.set(S.active_key || 'continue_watch_params', {});
        });
        S.mem = null;
        S.title_index = null;
        console.log('[CW] cleared');
      },
      torr: torrUrl,
      torrKeys: dumpTorrKeys,
      buffer: function (enabled, pct) {
        if (typeof enabled !== 'undefined')
          Lampa.Storage.set(BUFFER_SETTING_KEY, !!enabled);
        if (typeof pct === 'number') Lampa.Storage.set(BUFFER_PCT_KEY, pct);
        console.log(
          '[CW] buffer modal:',
          bufferingEnabled() ? 'ON' : 'OFF',
          'threshold:',
          bufferThreshold() + '%'
        );
        return {enabled: bufferingEnabled(), threshold: bufferThreshold()};
      },
      prefetch: function (enabled, target) {
        if (typeof enabled !== 'undefined') {
          Lampa.Storage.set(PREFETCH_KEY, !!enabled);
          if (!enabled) {
            stopPrefetchPoll();
            S.last_prefetched_link = null;
          }
        }
        if (typeof target === 'number')
          Lampa.Storage.set(PREFETCH_TARGET_KEY, target);
        console.log(
          '[CW] prefetch:',
          prefetchEnabled() ? 'ON' : 'OFF',
          'target:',
          prefetchTarget() + '%',
          'count:',
          S.prefetched,
          'last_pct:',
          S.prefetch_pct + '%',
          'reached:',
          S.prefetch_target_reached
        );
        return {
          enabled: prefetchEnabled(),
          target: prefetchTarget(),
          count: S.prefetched,
          last_pct: S.prefetch_pct,
          last_speed: S.prefetch_speed,
          target_reached: S.prefetch_target_reached,
          last_link: S.last_prefetched_link,
          last_index: S.last_prefetched_index,
        };
      },
      eco: function (enabled) {
        if (typeof enabled !== 'undefined')
          Lampa.Storage.set(ECO_MODE_KEY, !!enabled);
        console.log('[CW] eco cleanup:', ecoModeEnabled() ? 'ON' : 'OFF');
        return {
          enabled: ecoModeEnabled(),
          cleanups: S.cleanup_count,
          last_reason: S.last_cleanup_reason,
        };
      },
      smartNextConfirm: function (enabled) {
        if (typeof enabled !== 'undefined')
          Lampa.Storage.set(SMART_NEXT_CONFIRM_KEY, !!enabled);
        console.log(
          '[CW] smart-next confirm:',
          smartNextConfirmEnabled() ? 'ON' : 'OFF'
        );
        return {enabled: smartNextConfirmEnabled(), threshold: SMART_NEXT_PCT};
      },
      exitSummary: function (enabled) {
        if (typeof enabled !== 'undefined')
          Lampa.Storage.set(EXIT_SUMMARY_KEY, !!enabled);
        console.log('[CW] exit summary:', exitSummaryEnabled() ? 'ON' : 'OFF');
        return {
          enabled: exitSummaryEnabled(),
          last_at: S.last_exit_summary_at,
          last_hash: S.last_exit_summary_hash,
        };
      },
      cleanup: function (reason) {
        cleanupRuntime(reason || 'manual');
        console.log('[CW] runtime cleanup done:', S.last_cleanup_reason);
        return {
          cleanups: S.cleanup_count,
          files_cache: Object.keys(S.files).length,
          pending: Object.keys(S.files_pending).length,
          active_poll: !!S.prefetch_poll_iv,
          memory: memorySnapshot(),
        };
      },
      inject: function () {
        var act = Lampa.Activity.active();
        var movie = act && act.movie;
        if (!movie) return console.log('[CW] no active card');
        Lampa.Listener.send('full', {
          type: 'complite',
          data: {movie: movie},
          object: {activity: act},
        });
      },
    };
  }

  // =========================================================================
  // 18. Boot
  // =========================================================================
  function boot() {
    if (S.booted) return;
    S.booted = true;
    S.account_ready = true;
    S.boot_at = Date.now();
    var bootMem = memorySnapshot();
    S.boot_heap_used = bootMem ? bootMem.used : 0;

    if (DEBUG) {
      log('--- boot v' + PLUGIN_VERSION + ' ---');
      log(
        'Lampa.Player=' +
          !!Lampa.Player +
          ' .Timeline=' +
          !!Lampa.Timeline +
          ' .Torserver=' +
          !!Lampa.Torserver +
          ' .Component=' +
          !!Lampa.Component +
          ' menu_in_dom=' +
          ($('.menu .menu__list').length > 0)
      );
    }

    addStyles();
    hookLampaNoty();
    safe('Component.add', function () {
      Lampa.Component.add(COMPONENT_ID, DiagComponent);
      if (MENU_DATA_ACTION !== COMPONENT_ID)
        Lampa.Component.add(MENU_DATA_ACTION, DiagComponent);
    });
    registerManifest();
    addMenuRobust();
    exposeCw();

    ensureSync();
    attachStorageListener();
    attachLifecycleCleanup();
    patchPlayer();
    attachFullListener();
    attachTimelineListener();
    attachProfileListener();
    migrateOld();

    setTimeout(cleanupOldParams, 10000);

    if (DEBUG)
      log(
        '--- boot complete, entries=' +
          Object.keys(readParams()).length +
          ' torrserver=' +
          (torrUrl() || 'NONE') +
          ' ---'
      );
  }

  var waitLampaDelayMs = 100;
  function waitLampa() {
    if (safeLampa()) {
      waitLampaDelayMs = 100;
      startBootstrap();
      return;
    }
    waitLampaDelayMs = Math.min(Math.floor(waitLampaDelayMs * 1.4), 500);
    setTimeout(waitLampa, waitLampaDelayMs);
  }

  function startBootstrap() {
    safe('app listener', function () {
      Lampa.Listener.follow('app', function (e) {
        if (e.type === 'ready') boot();
      });
    });
    if (window.appready) boot();
  }

  waitLampa();
})();
