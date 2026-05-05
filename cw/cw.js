/*
 * Кнопка «Продолжить» на карточке фильма/сериала, восстановление позиции,
 * фоновый prefetch торрента, окно буферизации.
 * © 2026 · Sergey0s · github.com/Sergey0s
 *
 */
(function () {
    'use strict';

    var PLUGIN_VERSION = '100';

    if (window.continue_watch_plugin) return;
    window.continue_watch_plugin = PLUGIN_VERSION;

    // =========================================================================
    // 1. Константы
    // =========================================================================
    var PLUGIN_ID      = 'continue_watch';
    var COMPONENT_ID   = 'continue_watch_diag';
    var PLUGIN_NAME    = 'Продолжить';

    var MAX_AGE_MS          = 60 * 24 * 60 * 60 * 1000;
    var STORAGE_DEBOUNCE_MS = 2000;
    var TIMELINE_THROTTLE_MS = 2000;
    var CLICK_DEBOUNCE_MS   = 1000;
    var MENU_RETRY_MAX      = 40;
    var MENU_RETRY_MS       = 500;

    var BUFFER_DEFAULT_PCT = 10;
    var BUFFER_MIN_SPEED   = 50 * 1024;
    var BUFFER_POLL_MS     = 1000;
    var BUFFER_SETTING_KEY = 'cw_buffer_modal';
    var BUFFER_PCT_KEY     = 'cw_buffer_pct';

    var PREFETCH_KEY        = 'cw_prefetch';
    var PREFETCH_TARGET_KEY = 'cw_prefetch_target';
    var PREFETCH_TARGET_DEF = 5;
    var PREFETCH_POLL_MS    = 1500;
    var PREFETCH_TIMEOUT_MS = 120000;

    var SMART_NEXT_PCT     = 92;
    var TIMELINE_STORE_KEY = 'file_view';

    var MIGRATION_FLAG_KEY = 'continue_watch_params__migrated_to_profiles';
    var TORR_ALT_KEYS = [
        'torrserver_url', 'torrserver_url_two',
        'torrserver', 'torr_server', 'torr_url',
        'ts_url', 'tsurl'
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
        prefetch_hash: null,
        prefetch_link: null,
        prefetch_pct: 0,
        prefetch_speed: 0,
        prefetch_started_at: 0,
        prefetch_target_reached: false,
        prefetch_poll_iv: 0,
        prefetch_xhr: null,
        last_full_title: null,
        last_play_url: null,
        last_lookup: null,
        last_tick: 0,
        last_player_hash: null,
        files_pending: {}
    };

    var TIMERS = { save: 0, click: 0 };
    var LISTENERS = { player_start: null, player_destroy: null };

    // =========================================================================
    // 3. Logger (ленивый — не строит timestamp когда DEBUG=false)
    // =========================================================================
    function _ts() {
        var d = new Date();
        var p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
        var p3 = function (n) { return n < 10 ? '00' + n : (n < 100 ? '0' + n : '' + n); };
        return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) + '.' + p3(d.getMilliseconds());
    }

    function log() {
        if (!DEBUG || !window.console || !console.log) return;
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[CW ' + _ts() + ']');
        try { console.log.apply(console, args); } catch (e) {}
    }

    function warn() {
        if (!window.console || !console.warn) return;
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[CW ' + _ts() + ']');
        try { console.warn.apply(console, args); } catch (e) {}
    }

    function safe(name, fn) {
        try { return fn(); } catch (e) { warn(name + ' failed:', e); }
    }

    // =========================================================================
    // 4. Утилиты
    // =========================================================================
    function pickTitle(movie) {
        if (!movie) return '';
        return movie.original_name || movie.original_title || movie.name || movie.title || '';
    }

    function noty(text) {
        try { Lampa.Noty.show(text); } catch (e) {}
    }

    function formatTime(seconds) {
        if (!seconds) return '';
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var s = Math.floor(seconds % 60);
        var mm = (m < 10 ? '0' : '') + m;
        var ss = (s < 10 ? '0' : '') + s;
        return h > 0 ? (h + ':' + mm + ':' + ss) : (m + ':' + ss);
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

    function safeLampa() {
        return typeof window.Lampa !== 'undefined' && Lampa && Lampa.Storage && Lampa.Listener;
    }

    function getBoolPref(key, def) {
        var v = safe('storageGet', function () { return Lampa.Storage.get(key, def); });
        return v !== false && v !== 'false' && v !== 0 && v !== '0';
    }

    function getIntPref(key, def, max) {
        var v = safe('storageGet', function () { return Lampa.Storage.get(key, def); });
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
            if (S.account_ready && a && a.Permit && a.Permit.sync && a.Permit.account && a.Permit.account.profile &&
                typeof a.Permit.account.profile.id !== 'undefined') {
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
            safe('Storage.sync', function () { Lampa.Storage.sync(k, 'object_object'); });
            S.synced_key = k;
        }
    }

    function readParams() {
        ensureSync();
        if (!S.mem) {
            S.mem = safe('Storage.get', function () { return Lampa.Storage.get(activeKey(), {}); }) || {};
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
            safe('Storage.set', function () { Lampa.Storage.set(k, data); });
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
            var critical = (data.percent && data.percent > 90);
            writeParams(params, critical);
            if (DEBUG) log((isNew ? 'NEW ' : 'UPD ') + 'hash=' + hash +
                ' S=' + data.season + ' E=' + data.episode +
                ' %=' + data.percent + ' t=' + data.time);
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
            if (changed) { writeParams(params, true); log('cleanup: removed stale entries'); }
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
            url = useTwo ? (u2 || u1) : (u1 || u2);

            if (!url) {
                for (var i = 0; i < TORR_ALT_KEYS.length; i++) {
                    var c = normUrl(Lampa.Storage.get(TORR_ALT_KEYS[i]));
                    if (c) { url = c; log('TorrServer in alt key:', TORR_ALT_KEYS[i], '->', c); break; }
                }
            }
        });
        S.ts_url = url || '';
        return S.ts_url;
    }

    function dumpTorrKeys() {
        var found = {};
        for (var i = 0; i < TORR_ALT_KEYS.length; i++) {
            var v = safe('torrDump', function () { return Lampa.Storage.get(TORR_ALT_KEYS[i]); });
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
            var best = null, bestTs = 0;
            var hashes = ix[title] || [];
            for (var i = 0; i < hashes.length; i++) {
                var p = params[hashes[i]];
                if (p && p.season && p.episode && p.timestamp > bestTs) {
                    bestTs = p.timestamp;
                    best = p;
                }
            }
            S.last_lookup = { kind: 'series', title: title, total: Object.keys(params).length, matched: hashes.length, found: !!best };
            log('lookup series title="' + title + '" matched=' + hashes.length + ' found=' + !!best);
            return best;
        }

        var hash = Lampa.Utils.hash(title);
        var f = params[hash] || null;
        S.last_lookup = { kind: 'movie', title: title, hash: hash, total: Object.keys(params).length, found: !!f };
        log('lookup movie title="' + title + '" found=' + !!f);
        return f;
    }

    function findEpisodeParams(movie, season, episode) {
        if (!movie || !season || !episode) return null;
        var title = pickTitle(movie);
        var params = readParams();
        var ix = S.title_index || buildIndex();
        var hashes = ix[title] || [];
        for (var i = 0; i < hashes.length; i++) {
            var ep = params[hashes[i]];
            if (ep && ep.season === season && ep.episode === episode) return ep;
        }
        return null;
    }

    function findNextEpisodeParams(movie, current) {
        if (!current || !current.season || !current.episode) return null;
        var nxt = findEpisodeParams(movie, current.season, current.episode + 1);
        if (nxt) return nxt;
        return findEpisodeParams(movie, current.season + 1, 1);
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
            var bestEp = 0, best = null;
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
    function pickContinueTarget(movie) {
        var current = findStreamParams(movie);
        if (!current) return null;

        var pct = (typeof current.percent === 'number') ? current.percent : 0;
        var isSeries = !!(movie.number_of_seasons && current.season && current.episode);

        if (pct >= SMART_NEXT_PCT) {
            if (!isSeries) return null;
            var next = findNextEpisodeParams(movie, current);
            if (!next) return null;
            return { params: next, isNext: true, fromEpisode: { season: current.season, episode: current.episode } };
        }
        return { params: current, isNext: false };
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
                Lampa.Timeline.update({ hash: hash, percent: 0, time: 0, duration: existingDuration });
            }
        });
        safe('Timeline.storage.delete', function () {
            var fv = Lampa.Storage.get(TIMELINE_STORE_KEY, {});
            if (fv && fv[hash]) { delete fv[hash]; Lampa.Storage.set(TIMELINE_STORE_KEY, fv); }
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
                Lampa.Timeline.update({ hash: hash, percent: 100, time: dur, duration: dur });
            }
        });
        safe('Timeline.mark.storage', function () {
            var fv = Lampa.Storage.get(TIMELINE_STORE_KEY, {});
            fv[hash] = { hash: hash, percent: 100, time: dur, duration: dur };
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
        return url + '/stream/' + encodeURIComponent(p.file_name) + '?' + q.join('&');
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
    function magnetToHash(magnet) {
        if (!magnet) return null;
        var raw = String(magnet);
        var variants = [raw];
        try { variants.push(decodeURIComponent(raw)); } catch (e) {}
        try { variants.push(decodeURIComponent(decodeURIComponent(raw))); } catch (e) {}

        for (var i = 0; i < variants.length; i++) {
            var s = variants[i];
            var hex = s.match(/[?&]xt=urn:bt[im]h:([a-fA-F0-9]{40})/i) || s.match(/urn:bt[im]h:([a-fA-F0-9]{40})/i);
            if (hex) return hex[1].toLowerCase();
            var b32 = s.match(/[?&]xt=urn:bt[im]h:([a-zA-Z2-7]{32})/i) || s.match(/urn:bt[im]h:([a-zA-Z2-7]{32})/i);
            if (b32) {
                var h = base32ToHex(b32[1].toUpperCase());
                if (h) return h;
            }
        }
        return null;
    }

    function base32ToHex(str) {
        var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        var bits = '';
        for (var i = 0; i < str.length; i++) {
            var v = alphabet.indexOf(str.charAt(i));
            if (v < 0) return null;
            var b = v.toString(2);
            while (b.length < 5) b = '0' + b;
            bits += b;
        }
        var hex = '';
        for (var j = 0; j + 4 <= bits.length; j += 4) {
            hex += parseInt(bits.substr(j, 4), 2).toString(16);
        }
        return hex.toLowerCase().slice(0, 40);
    }

    // Async-only API для совместимости с прошлым кодом (prefetch / modal).
    // Если magnet валидный — отдаём хеш моментально без сети.
    // Если хеш извлечь не получилось — фолбэк через tsAddTorrent (POST /torrents
    // add). На большинстве TorrServer'ов он не работает из-за CORS, но для
    // нестандартных ссылок другого варианта нет.
    var inflightHash = {};

    function getTorrentHash(opts, onSuccess, onError) {
        var link = opts && opts.link;
        if (!link) { if (onError) onError(new Error('пустая ссылка')); return; }

        var localHash = magnetToHash(link);
        if (localHash) {
            log('hash from magnet: ' + localHash.slice(0, 16) + '…');
            if (onSuccess) onSuccess({ hash: localHash });
            return;
        }

        warn('hash not extractable from link, falling back to POST add. link prefix: ' +
            String(link).slice(0, 160));

        if (inflightHash[link]) {
            inflightHash[link].cb.push(onSuccess);
            if (onError) inflightHash[link].err.push(onError);
            log('hash dedup: subscribed to in-flight request for ' + String(link).slice(0, 60));
            return;
        }
        inflightHash[link] = { cb: [onSuccess], err: onError ? [onError] : [] };

        tsAddTorrent(link, opts.title, opts.poster, function (json) {
            var entry = inflightHash[link];
            delete inflightHash[link];
            if (!entry) return;
            json.hash = json.hash || json.Hash;
            for (var i = 0; i < entry.cb.length; i++) {
                try { entry.cb[i](json); } catch (e) { warn('getTorrentHash cb', e); }
            }
        }, function (err) {
            var entry = inflightHash[link];
            delete inflightHash[link];
            warn('getTorrentHash failed: ' + (err && err.message));
            if (!entry) return;
            for (var i = 0; i < entry.err.length; i++) {
                try { entry.err[i](err); } catch (e) {}
            }
        });
    }

    function tsAddTorrent(link, title, poster, onOk, onErr) {
        var url = torrUrl();
        if (!url) { if (onErr) onErr(new Error('TorrServer URL не настроен')); return; }
        var xhr = new XMLHttpRequest();
        try {
            xhr.open('POST', url + '/torrents', true);
            xhr.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
            xhr.timeout = 15000;
            xhr.onload = function () {
                var raw = xhr.responseText || '';
                if (xhr.status >= 200 && xhr.status < 300) {
                    var json = null;
                    try { json = raw ? JSON.parse(raw) : {}; } catch (e) {}
                    if (json && (json.hash || json.Hash)) { if (onOk) onOk(json); }
                    else if (onErr) onErr(new Error('пустой hash в ответе: ' + raw.slice(0, 120)));
                } else if (onErr) {
                    onErr(new Error('HTTP ' + xhr.status + ' ' + raw.slice(0, 120)));
                }
            };
            xhr.onerror = function () { if (onErr) onErr(new Error('CORS на /torrents add (TorrServer жив, но не пускает) или сеть упала')); };
            xhr.ontimeout = function () { if (onErr) onErr(new Error('TorrServer не ответил (15с)')); };
            xhr.send(JSON.stringify({ action: 'add', link: link, title: title || '', poster: poster || '' }));
        } catch (e) { if (onErr) onErr(e); }
    }

    // =========================================================================
    // 8. Плейлист эпизодов сериала (тихая догрузка в фоне)
    // =========================================================================
    function loadEpisodesPlaylist(movie, currentParams, currentUrl, done) {
        var title = pickTitle(movie);
        var allParams = readParams();
        var playlist = [];

        for (var hash in allParams) {
            var p = allParams[hash];
            if (p.title === title && p.season && p.episode) {
                var epHash = generateHash(movie, p.season, p.episode);
                var tl = Lampa.Timeline.view(epHash);
                var isCur = (p.season === currentParams.season && p.episode === currentParams.episode);
                playlist.push({
                    title: p.episode_title || ('S' + p.season + ' E' + p.episode),
                    season: p.season, episode: p.episode,
                    timeline: tl, torrent_hash: p.torrent_hash || p.torrent_link,
                    card: movie, url: isCur ? currentUrl : buildStreamUrl(p),
                    position: isCur ? (tl ? (tl.time || -1) : -1) : -1
                });
            }
        }

        if (!currentParams.torrent_link) { done(playlist); return; }

        var processFiles = function (files) {
            S.files[currentParams.torrent_link] = files;
            setTimeout(function () { delete S.files[currentParams.torrent_link]; }, 300000);

            var seen = {};
            for (var j = 0; j < playlist.length; j++) seen[playlist[j].season + '_' + playlist[j].episode] = 1;

            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                safe('parseFile', function () {
                    var info = Lampa.Torserver.parse({
                        movie: movie, files: [file],
                        filename: file.path.split('/').pop(),
                        path: file.path, is_file: true
                    });
                    if (movie.number_of_seasons && info.season !== currentParams.season) return;
                    var key = info.season + '_' + info.episode;
                    if (seen[key]) return;

                    var epHash = generateHash(movie, info.season, info.episode);
                    var tl = Lampa.Timeline.view(epHash) || { hash: epHash, percent: 0, time: 0, duration: 0 };

                    if (!allParams[epHash]) {
                        updateEntry(epHash, {
                            file_name: file.path,
                            torrent_link: currentParams.torrent_link,
                            file_index: file.id || 0,
                            title: title,
                            season: info.season, episode: info.episode,
                            percent: 0, time: 0, duration: 0
                        });
                    }

                    var isCur = (info.season === currentParams.season && info.episode === currentParams.episode);
                    playlist.push({
                        title: movie.number_of_seasons ? ('S' + info.season + ' E' + info.episode) : (movie.title || title),
                        season: info.season, episode: info.episode,
                        timeline: tl, torrent_hash: currentParams.torrent_link, card: movie,
                        url: (isCur || (file.id === currentParams.file_index && !movie.number_of_seasons)) ? currentUrl :
                            buildStreamUrl({ file_name: file.path, torrent_link: currentParams.torrent_link, file_index: file.id || 0 }),
                        position: isCur ? (tl.time || -1) : -1
                    });
                    seen[key] = 1;
                });
            }

            if (movie.number_of_seasons) playlist.sort(function (a, b) { return a.episode - b.episode; });
            done(playlist);
        };

        if (S.files[currentParams.torrent_link]) { processFiles(S.files[currentParams.torrent_link]); return; }

        getTorrentHash({
            link: currentParams.torrent_link, title: title,
            poster: movie.poster_path
        }, function (torrent) {
            if (!torrent || !torrent.hash) { done(playlist); return; }
            var tries = 0;
            var fetch = function () {
                safe('Torserver.files', function () {
                    Lampa.Torserver.files(torrent.hash, function (json) {
                        if (json && json.file_stats && json.file_stats.length) processFiles(json.file_stats);
                        else if (tries++ < 5) setTimeout(fetch, tries * 1000);
                        else done(playlist);
                    }, function () {
                        if (tries++ < 5) setTimeout(fetch, tries * 1000);
                        else done(playlist);
                    });
                });
            };
            fetch();
        }, function () { done(playlist); });
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
        if (!url) { onErr && onErr(new Error('no torrserver')); return; }
        var xhr = new XMLHttpRequest();
        try {
            xhr.open('POST', url + '/torrents', true);
            xhr.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
            xhr.timeout = 5000;
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    var json = null;
                    try { json = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch (e) {}
                    onOk && onOk(json || {});
                } else if (onErr) onErr(new Error('http ' + xhr.status));
            };
            xhr.onerror = function () { onErr && onErr(new Error('network')); };
            xhr.ontimeout = function () { onErr && onErr(new Error('timeout')); };
            var payload = { action: action };
            if (body) for (var k in body) payload[k] = body[k];
            xhr.send(JSON.stringify(payload));
        } catch (e) { onErr && onErr(e); }
    }

    // GET /echo — TorrServer health-check. Simple CORS, без preflight'а.
    // Используем чтобы отличить «сервер мёртв» от «сервер жив, но CORS режет».
    function tsPing(onAlive, onDead) {
        var url = torrUrl();
        if (!url) { onDead && onDead(new Error('TorrServer URL не настроен')); return; }
        var xhr = new XMLHttpRequest();
        try {
            xhr.open('GET', url + '/echo', true);
            xhr.timeout = 3000;
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 400) onAlive && onAlive();
                else onDead && onDead(new Error('TorrServer ответил HTTP ' + xhr.status));
            };
            xhr.onerror = function () { onDead && onDead(new Error('TorrServer недоступен (сеть)')); };
            xhr.ontimeout = function () { onDead && onDead(new Error('TorrServer не ответил за 3с')); };
            xhr.send();
        } catch (e) { onDead && onDead(e); }
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
        } catch (e) { return null; }
    }

    function prefetchEnabled() { return getBoolPref(PREFETCH_KEY, true); }
    function prefetchTarget()  { return getIntPref(PREFETCH_TARGET_KEY, PREFETCH_TARGET_DEF, 100); }

    function stopPrefetchPoll() {
        if (S.prefetch_poll_iv) { clearInterval(S.prefetch_poll_iv); S.prefetch_poll_iv = 0; }
        if (S.prefetch_xhr) { try { S.prefetch_xhr.abort(); } catch (e) {} S.prefetch_xhr = null; }
    }

    // Заранее тянем file_stats у TorrServer'а, чтобы при клике «Продолжить»
    // плейлист эпизодов был готов синхронно. Иначе Lampa.Player.play получает
    // короткий [current] плейлист и автоматический next-episode не работает —
    // плеер просто закрывается на конце текущего файла.
    function prefetchFilesList(torrentLink, hash) {
        if (!hash || !torrentLink) return;
        if (S.files[torrentLink] || S.files_pending[torrentLink]) return;
        if (!Lampa.Torserver || !Lampa.Torserver.files) return;
        S.files_pending[torrentLink] = true;
        safe('Torserver.files.prefetch', function () {
            Lampa.Torserver.files(hash, function (json) {
                delete S.files_pending[torrentLink];
                if (json && json.file_stats && json.file_stats.length) {
                    S.files[torrentLink] = json.file_stats;
                    log('files prefetched: ' + json.file_stats.length + ' for ' + torrentLink.slice(0, 60));
                    setTimeout(function () { delete S.files[torrentLink]; }, 600000);
                }
            }, function () {
                delete S.files_pending[torrentLink];
            });
        });
    }

    function prefetchTorrent(movie, params) {
        if (!prefetchEnabled()) return;
        if (!params || !params.torrent_link || !params.file_name) return;
        if (!torrUrl()) return;
        if (S.last_prefetched_link === params.torrent_link && S.prefetch_target_reached) {
            log('prefetch skip: same link, target already reached');
            return;
        }
        if (S.last_prefetched_link === params.torrent_link && S.prefetch_poll_iv) {
            log('prefetch skip: same link, polling already in progress');
            return;
        }

        var url = buildStreamUrl(params);
        if (!url) return;

        stopPrefetchPoll();
        S.last_prefetched_link = params.torrent_link;
        S.prefetched++;
        S.prefetch_link = params.torrent_link;
        S.prefetch_hash = null;
        S.prefetch_pct = 0;
        S.prefetch_speed = 0;
        S.prefetch_target_reached = false;
        S.prefetch_started_at = Date.now();

        var title = pickTitle(movie);
        var target = prefetchTarget();
        log('prefetch start: "' + title + '" target=' + target + '%');

        getTorrentHash({
            link: params.torrent_link,
            title: title,
            poster: movie.poster_path
        }, function (torrent) {
            var hash = torrent && (torrent.hash || torrent.Hash);
            if (!hash) { log('prefetch: no hash returned'); return; }
            if (S.last_prefetched_link !== params.torrent_link) { log('prefetch: card changed, abort'); return; }

            S.prefetch_hash = hash;
            log('prefetch: hash=' + hash.slice(0, 16) + '…');

            S.prefetch_xhr = triggerPreload(url, PREFETCH_TIMEOUT_MS);

            if (movie.number_of_seasons) prefetchFilesList(params.torrent_link, hash);

            var poll = function () {
                if (S.prefetch_link !== params.torrent_link) { stopPrefetchPoll(); return; }
                if (Date.now() - S.prefetch_started_at > PREFETCH_TIMEOUT_MS) {
                    log('prefetch: timeout, last %=' + S.prefetch_pct);
                    stopPrefetchPoll();
                    return;
                }
                tsRequest('get', { hash: hash }, function (info) {
                    if (S.prefetch_link !== params.torrent_link) return;
                    var preBytes = info.preloaded_bytes || info.PreloadedBytes || 0;
                    var preSize = info.preload_size || info.PreloadSize || 0;
                    var pct = preSize > 0 ? Math.min(100, Math.round(preBytes / preSize * 100)) : 0;
                    S.prefetch_pct = pct;
                    S.prefetch_speed = info.download_speed || info.DownloadSpeed || 0;

                    if (pct >= target) {
                        S.prefetch_target_reached = true;
                        log('prefetch: target ' + target + '% reached (' + pct + '%), stopping background poll');
                        stopPrefetchPoll();
                    }
                });
            };
            poll();
            S.prefetch_poll_iv = setInterval(poll, PREFETCH_POLL_MS);
        }, function () {
            log('prefetch: hash failed');
        });
    }

    function bufferingEnabled() { return getBoolPref(BUFFER_SETTING_KEY, true); }
    function bufferThreshold()  { return getIntPref(BUFFER_PCT_KEY, BUFFER_DEFAULT_PCT, 100); }

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
        try { prevController = Lampa.Controller.enabled() && Lampa.Controller.enabled().name; } catch (e) {}

        var fileLabel = (params.file_name || '').split('/').pop();

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
                    '<div class="cw-buf__hint">Авто-старт при буфере ≥ ' + threshold + '%. Изменить: cw.buffer(true, %)</div>' +
                '</div>' +
            '</div>'
        );
        modal.find('.cw-buf__sub').text(opts.title || pickTitle(movie));
        if (fileLabel) modal.find('.cw-buf__file').text(fileLabel);

        function close() {
            aborted = true;
            if (pollIv) { clearInterval(pollIv); pollIv = 0; }
            modal.remove();
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

        safe('Controller.add', function () {
            Lampa.Controller.add('cw_buffer_modal', {
                invisible: true,
                toggle: function () {
                    Lampa.Controller.collectionSet(modal);
                    Lampa.Controller.collectionFocus(false, modal);
                },
                left:  function () { try { if (Navigator.canmove('left'))  Navigator.move('left');  } catch (e) {} },
                right: function () { try { if (Navigator.canmove('right')) Navigator.move('right'); } catch (e) {} },
                up:    function () { try { if (Navigator.canmove('up'))    Navigator.move('up');    } catch (e) {} },
                down:  function () { try { if (Navigator.canmove('down'))  Navigator.move('down');  } catch (e) {} },
                back:  cancel
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
            var allPeers = info.peers || info.total_peers || info.TotalPeers || info.Peers || 0;
            var stat = info.stat_string || info.StatString || info.stat || '';

            var pct = preSize > 0 ? Math.min(100, Math.round(preBytes / preSize * 100)) : 0;
            var eta = (preSize > preBytes && speed > 0) ? (preSize - preBytes) / speed : 0;

            modal.find('.cw-buf__pct').text(pct + '%');
            modal.find('.cw-buf__bar-fill').css('width', pct + '%');
            modal.find('.cw-buf__speed').text(fmtSpeed(speed));
            modal.find('.cw-buf__peers').text(seeders + ' / ' + allPeers);
            modal.find('.cw-buf__loaded').text(fmtBytes(loaded) + ' / ' + fmtBytes(total));
            modal.find('.cw-buf__buf').text(fmtBytes(preBytes) + ' / ' + fmtBytes(preSize));
            modal.find('.cw-buf__eta').text(fmtEta(eta));
            modal.find('.cw-buf__status').text(stat || (speed > 0 ? 'загрузка' : 'ожидание пиров'));

            // Если буфер уже накачан до порога — запускаем независимо от скорости
            // (скорость может быть 0 ровно потому что preload УЖЕ завершён).
            // Минимальная скорость нужна только когда буфер ещё мал — чтобы не стартовать на мёртвом торренте.
            if (preSize > 0 && pct >= threshold) {
                log('auto-launch: buffer ' + pct + '% >= threshold ' + threshold + '%');
                launchNow();
            } else if (preSize === 0 && loaded > 5 * 1024 * 1024 && speed > BUFFER_MIN_SPEED) {
                log('auto-launch: no preload_size, loaded=' + loaded + ' speed=' + speed);
                launchNow();
            } else if (preSize > 0 && pct < threshold && speed === 0 && seeders === 0 && allPeers > 0) {
                modal.find('.cw-buf__status').text('подключение к пирам (' + allPeers + ' доступно)…');
            }
        }

        function poll() {
            if (!hash || aborted) return;
            tsRequest('get', { hash: hash }, function (info) {
                if (!aborted && info) applyStats(info);
            }, function () {
                if (!aborted) modal.find('.cw-buf__status').text('нет связи с TorrServer');
            });
        }

        var prefetched = (S.last_prefetched_link === params.torrent_link);
        var cachedHash = (prefetched && S.prefetch_hash) ? S.prefetch_hash : null;

        var startPolling = function (h) {
            hash = h;
            stopPrefetchPoll();
            if (!prefetched) triggerPreload(streamUrl, 60000);
            modal.find('.cw-buf__status').text(
                S.prefetch_target_reached ? 'буфер уже накачан (prefetch ' + S.prefetch_pct + '%)' :
                prefetched ? 'буферизация (prefetch активен, ' + S.prefetch_pct + '%)' : 'подключение к пирам…'
            );
            poll();
            pollIv = setInterval(poll, BUFFER_POLL_MS);
        };

        if (cachedHash) {
            modal.find('.cw-buf__status').text('используем prefetch (буфер ' + S.prefetch_pct + '%)…');
            startPolling(cachedHash);
        } else {
            modal.find('.cw-buf__status').text('проверка TorrServer…');
            tsPing(function () {
                if (aborted) return;
                tryAdd();
            }, function (err) {
                if (aborted) return;
                var msg = (err && err.message) ? err.message : 'TorrServer недоступен';
                warn('TorrServer ping failed: ' + msg);
                modal.find('.cw-buf__status').text(msg + ' — проверь TorrServer и URL в Lampa');
            });

            var attempts = 0;
            var tryAdd = function () {
                attempts++;
                modal.find('.cw-buf__status').text(
                    attempts === 1 ? (prefetched ? 'торрент уже подгружается…' : 'добавление в TorrServer…')
                                   : 'повтор #' + attempts + '…'
                );
                getTorrentHash({
                    link: params.torrent_link,
                    title: pickTitle(movie),
                    poster: movie.poster_path
                }, function (torrent) {
                    if (aborted) return;
                    var h = torrent && (torrent.hash || torrent.Hash);
                    if (!h) { modal.find('.cw-buf__status').text('пустой ответ от TorrServer'); return; }
                    if (!S.prefetch_hash) S.prefetch_hash = h;
                    startPolling(h);
                }, function (err) {
                    if (aborted) return;
                    var msg = (err && err.message) ? err.message : 'неизвестная ошибка';
                    if (attempts < 3) {
                        modal.find('.cw-buf__status').text('Ошибка: ' + msg.slice(0, 70) + ' — повтор через 2с…');
                        setTimeout(tryAdd, 2000);
                    } else {
                        // Хеш получить не смогли (CORS / линк не magnet). Без хеша
                        // polling статуса невозможен. Триггерим preload и сразу
                        // открываем плеер: video-элемент при загрузке /stream сам
                        // заставит TorrServer добавить торрент (media-loads не
                        // подчиняются CORS).
                        warn('add failed after ' + attempts + ' attempts (' + msg + ') — falling back to direct player launch');
                        triggerPreload(streamUrl, 60000);
                        modal.find('.cw-buf__status').text('пропускаем модалку, запускаем плеер…');
                        setTimeout(launchNow, 400);
                    }
                });
            };
            tryAdd();
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
    function startPlayback(movie, params, url, timeline) {
        var player_type = Lampa.Storage.field('player_torrent');
        var force_inner = (player_type === 'inner');
        var isSeries = !!(movie.number_of_seasons && params.season && params.episode);
        log('startPlayback player_type=' + player_type + ' position=' + (timeline.time || -1) +
            ' series=' + isSeries);

        var data = {
            url: url,
            title: params.episode_title || params.title || movie.title,
            card: movie, torrent_hash: params.torrent_link,
            timeline: timeline,
            season: params.season, episode: params.episode,
            position: timeline.time || -1
        };

        if (force_inner) {
            delete data.torrent_hash;
            var orig = Lampa.Platform.is;
            Lampa.Platform.is = function (w) { return w === 'android' ? false : orig(w); };
            setTimeout(function () { Lampa.Platform.is = orig; }, 500);
            safe('setInternal', function () { Lampa.Storage.set('internal_torrclient', true); });
        }

        var epTitle = params.episode_title ||
            (params.season ? ('S' + params.season + ' E' + params.episode) : (movie.title || params.title || ''));

        var fallbackPlaylist = [{
            url: url, title: epTitle, timeline: timeline,
            season: params.season, episode: params.episode,
            card: movie, torrent_hash: params.torrent_link
        }];

        var doPlay = function (playlist) {
            data.playlist = (playlist && playlist.length) ? playlist : fallbackPlaylist;
            if (timeline.time > 0) noty('Восстанавливаем: ' + formatTime(timeline.time));
            Lampa.Player.play(data);
            attachPlayerListeners();
            try { Lampa.Player.callback(function () { Lampa.Controller.toggle('content'); }); } catch (e) {}
            log('player started, playlist=' + data.playlist.length + ' items');
        };

        if (!isSeries) { doPlay(fallbackPlaylist); return; }

        if (S.files[params.torrent_link]) {
            log('using cached files for playlist (' + S.files[params.torrent_link].length + ')');
            buildPlaylistFromFiles(movie, params, url, S.files[params.torrent_link], doPlay);
            return;
        }

        var played = false;
        var startTimeout = setTimeout(function () {
            if (played) return;
            played = true;
            warn('playlist load timeout, starting with current episode only');
            doPlay(fallbackPlaylist);
        }, 3500);

        loadEpisodesPlaylist(movie, params, url, function (playlist) {
            if (played) {
                if (playlist && playlist.length > 1) {
                    safe('Player.playlist.late', function () { Lampa.Player.playlist(playlist); });
                    noty('Плейлист загружен (' + playlist.length + ' эп.)');
                }
                return;
            }
            played = true;
            clearTimeout(startTimeout);
            doPlay(playlist && playlist.length ? playlist : fallbackPlaylist);
        });
    }

    function buildPlaylistFromFiles(movie, currentParams, currentUrl, files, done) {
        var title = pickTitle(movie);
        var playlist = [];
        var allParams = readParams();

        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            safe('parseFile', function () {
                var info = Lampa.Torserver.parse({
                    movie: movie, files: [file],
                    filename: file.path.split('/').pop(),
                    path: file.path, is_file: true
                });
                if (movie.number_of_seasons && info.season !== currentParams.season) return;

                var epHash = generateHash(movie, info.season, info.episode);
                var tl = Lampa.Timeline.view(epHash) || { hash: epHash, percent: 0, time: 0, duration: 0 };
                if (!allParams[epHash]) {
                    updateEntry(epHash, {
                        file_name: file.path,
                        torrent_link: currentParams.torrent_link,
                        file_index: file.id || 0,
                        title: title,
                        season: info.season, episode: info.episode,
                        percent: 0, time: 0, duration: 0
                    });
                }

                var isCur = (info.season === currentParams.season && info.episode === currentParams.episode);
                playlist.push({
                    title: movie.number_of_seasons ? ('S' + info.season + ' E' + info.episode) : (movie.title || title),
                    season: info.season, episode: info.episode,
                    timeline: tl, torrent_hash: currentParams.torrent_link, card: movie,
                    url: isCur ? currentUrl :
                        buildStreamUrl({ file_name: file.path, torrent_link: currentParams.torrent_link, file_index: file.id || 0 }),
                    position: isCur ? (tl.time || -1) : -1
                });
            });
        }

        if (movie.number_of_seasons) playlist.sort(function (a, b) { return a.episode - b.episode; });
        done(playlist);
    }

    function launchPlayer(movie, params, opts) {
        opts = opts || {};
        var url = buildStreamUrl(params);
        if (!url) return;

        var hash = generateHash(movie, params.season, params.episode);
        var existingEntry = readParams()[hash] || {};
        var existingDuration = existingEntry.duration || params.duration || 0;
        var timeline;
        if (opts.startFresh) {
            timeline = { hash: hash, time: 0, percent: 0, duration: existingDuration };
            updateEntry(hash, { percent: 0, time: 0 });
        } else {
            timeline = Lampa.Timeline.view(hash);
            if (!timeline || (!timeline.time && !timeline.percent)) {
                timeline = timeline || { hash: hash };
                timeline.time = params.time || 0;
                timeline.percent = params.percent || 0;
                timeline.duration = existingDuration;
            } else if (params.time > timeline.time) {
                timeline.time = params.time;
                timeline.percent = params.percent;
            }
            updateEntry(hash, { percent: timeline.percent, time: timeline.time, duration: timeline.duration });
        }

        var go = function () { startPlayback(movie, params, url, timeline); };

        if (bufferingEnabled() && params.torrent_link && torrUrl()) {
            showBufferModal({
                movie: movie, params: params, url: url,
                title: params.episode_title || params.title,
                onLaunch: go,
                onCancel: function () { log('buffer modal cancelled'); }
            });
        } else {
            go();
        }
    }

    // =========================================================================
    // 10. Перехват Lampa.Player.play (сохраняем метаданные при старте)
    // =========================================================================
    function patchPlayer() {
        if (!Lampa.Player) { warn('Lampa.Player not available'); return; }
        var original = Lampa.Player.play;
        if (!original) { warn('Lampa.Player.play not available'); return; }

        Lampa.Player.play = function (p) {
            safe('patchPlayer.intercept', function () {
                S.last_play_url = p && p.url;
                var hasStream = p && p.url && p.url.indexOf('/stream/') !== -1;
                if (!(p && (p.torrent_hash || hasStream))) return;

                S.play_intercepted++;
                var movie = p.card || p.movie || (Lampa.Activity.active() && Lampa.Activity.active().movie);
                log('PATCH play title="' + pickTitle(movie) + '" url=' + (p.url ? p.url.slice(0, 120) : ''));
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
                    season: p.season, episode: p.episode,
                    episode_title: p.title || p.episode_title
                });
            });
            return original.call(this, p);
        };
        log('Lampa.Player.play patched');
    }

    // =========================================================================
    // 11. Timeline listener — обновление процента/времени (единственная точка)
    // =========================================================================
    function attachTimelineListener() {
        safe('Timeline.listener', function () {
            Lampa.Timeline.listener.follow('update', function (e) {
                var hash = e.data && e.data.hash;
                var road = e.data && e.data.road;
                if (!hash || !road || typeof road.percent === 'undefined') return;

                var now = Date.now();
                if (now - S.last_tick < TIMELINE_THROTTLE_MS) return;
                S.last_tick = now;

                var p = readParams();
                if (!p[hash]) return;
                updateEntry(hash, { percent: road.percent, time: road.time, duration: road.duration });
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
            var tl = Lampa.Timeline.view(hash);
            if (!tl) return;
            var pct = (typeof tl.percent === 'number') ? tl.percent : 0;
            var t = tl.time || 0;
            var dur = tl.duration || 0;
            if (!pct && !t && !dur) return;
            var p = readParams();
            if (!p[hash]) return;
            updateEntry(hash, { percent: pct, time: t, duration: dur });
        });
    }

    function flushPendingWrites() {
        if (!TIMERS.save) return;
        clearTimeout(TIMERS.save);
        TIMERS.save = 0;
        if (!S.mem) return;
        safe('flushPendingWrites', function () { Lampa.Storage.set(activeKey(), S.mem); });
    }

    function attachPlayerListeners() {
        detachPlayerListeners();
        LISTENERS.player_start = function (d) {
            if (!d || !d.card) return;
            var hash = generateHash(d.card, d.season, d.episode);
            var mFile = d.url && d.url.match(/\/stream\/([^?]+)/);
            if (!mFile) return;

            if (S.last_player_hash && S.last_player_hash !== hash) {
                flushHashFromTimeline(S.last_player_hash);
            }
            S.last_player_hash = hash;

            var mLink = d.url && d.url.match(/[?&]link=([^&]+)/);
            var mIdx = d.url && d.url.match(/[?&]index=(\d+)/);
            var patch = {
                file_name: decodeURIComponent(mFile[1]),
                title: pickTitle(d.card),
                season: d.season, episode: d.episode
            };
            if (mLink) patch.torrent_link = mLink[1];
            if (mIdx) patch.file_index = parseInt(mIdx[1]);
            updateEntry(hash, patch);
        };
        LISTENERS.player_destroy = function () {
            if (S.last_player_hash) {
                flushHashFromTimeline(S.last_player_hash);
                S.last_player_hash = null;
            }
            flushPendingWrites();
            detachPlayerListeners();
        };
        safe('Player.listener', function () {
            Lampa.Player.listener.follow('start', LISTENERS.player_start);
            Lampa.Player.listener.follow('destroy', LISTENERS.player_destroy);
        });
    }

    function detachPlayerListeners() {
        if (LISTENERS.player_start) safe('unfollow.start', function () { Lampa.Player.listener.remove('start', LISTENERS.player_start); });
        if (LISTENERS.player_destroy) safe('unfollow.destroy', function () { Lampa.Player.listener.remove('destroy', LISTENERS.player_destroy); });
        LISTENERS.player_start = null;
        LISTENERS.player_destroy = null;
    }

    // =========================================================================
    // 12. Кнопка «Продолжить» на карточке
    // =========================================================================
    function buildButtonHtml(dashArray, label) {
        return '<div class="full-start__button selector button--continue-watch">' +
            '<svg class="cw-btn__ico" viewBox="0 0 24 24" width="22" height="22" fill="none">' +
                '<path d="M8 5v14l11-7L8 5z" fill="currentColor"/>' +
                '<circle class="cw-btn__ring" cx="12" cy="12" r="10.5" stroke="currentColor" ' +
                    'stroke-width="1.5" fill="none" stroke-dasharray="' + dashArray + ' 65.97" ' +
                    'transform="rotate(-90 12 12)"/>' +
            '</svg><div class="cw-btn__lbl">' + label + '</div></div>';
    }

    function onClickContinue(movie, btn) {
        if (TIMERS.click) return;
        var target = pickContinueTarget(movie);
        if (!target) { noty('Нет истории'); return; }
        if (btn) $(btn).css('opacity', 0.5);
        TIMERS.click = setTimeout(function () {
            TIMERS.click = 0;
            if (btn) $(btn).css('opacity', 1);
        }, CLICK_DEBOUNCE_MS);
        launchPlayer(movie, target.params);
    }

    function showContextMenu(movie, target, btn, render) {
        var current = target.params;
        var isSeries = !!(movie.number_of_seasons && current.season && current.episode);
        var items = [];
        var curHash = generateHash(movie, current.season, current.episode);
        var ep = isSeries ? ('S' + current.season + ' E' + current.episode) : '';

        if (isSeries) {
            var nxt = target.isNext ? null : findNextEpisodeParams(movie, current);
            if (nxt && (nxt.season !== current.season || nxt.episode !== current.episode)) items.push({
                title: 'Завершить и запустить следующий: S' + nxt.season + ' E' + nxt.episode,
                action: function () {
                    var freshCurrent = findEpisodeParams(movie, current.season, current.episode) || current;
                    var freshNxt = findNextEpisodeParams(movie, freshCurrent);
                    if (!freshNxt || (freshNxt.season === freshCurrent.season && freshNxt.episode === freshCurrent.episode)) {
                        warn('next episode disappeared, falling back to closure nxt');
                        freshNxt = nxt;
                    }
                    log('next-action: cur S' + freshCurrent.season + 'E' + freshCurrent.episode +
                        ' -> nxt S' + freshNxt.season + 'E' + freshNxt.episode +
                        ' file=' + (freshNxt.file_name || '?').slice(-40));
                    markWatched(curHash, freshCurrent);
                    launchPlayer(movie, cloneFresh(freshNxt), { startFresh: true });
                }
            });
            var prev = findPrevEpisodeParams(movie, current);
            if (prev) items.push({
                title: 'Вернуться к предыдущему: S' + prev.season + ' E' + prev.episode + ' (с начала)',
                action: function () { launchPlayer(movie, cloneFresh(prev), { startFresh: true }); }
            });
            items.push({
                title: 'Сбросить прогресс эпизода (' + ep + ')',
                action: function () {
                    resetEntry(curHash);
                    noty('Прогресс эпизода сброшен — теперь с начала');
                    refreshCardButton(movie, render, btn);
                }
            });
        } else {
            items.push({
                title: 'Отметить фильм как просмотренный',
                action: function () {
                    markWatched(curHash, current);
                    noty('Фильм помечен как просмотренный');
                    refreshCardButton(movie, render, btn);
                }
            });
            items.push({
                title: 'Сбросить прогресс фильма (с начала)',
                action: function () {
                    resetEntry(curHash);
                    noty('Прогресс сброшен. Нажмите «Продолжить» чтобы запустить с начала');
                    refreshCardButton(movie, render, btn);
                }
            });
        }

        if (!items.length) return;

        safe('Select.show', function () {
            if (!Lampa.Select || !Lampa.Select.show) {
                warn('Lampa.Select unavailable');
                return;
            }
            Lampa.Select.show({
                title: 'Действия с прогрессом',
                items: items,
                onSelect: function (item) {
                    safe('Controller.toggle', function () { Lampa.Controller.toggle('content'); });
                    if (item && typeof item.action === 'function') {
                        safe('contextAction', function () { item.action(); });
                    }
                },
                onBack: function () {
                    safe('Controller.toggle', function () { Lampa.Controller.toggle('content'); });
                }
            });
        });
    }

    // skipPrefetch: после деструктивных действий (reset/markWatched/delete) НЕ
    // запускаем фоновый prefetch — иначе он стартует Lampa.Torserver.hash
    // одновременно с тем, что чуть позже сделает buffer-modal по клику юзера,
    // и TorrServer/Lampa-обёртка ловит «ошибку добавления торрента».
    function refreshCardButton(movie, render, oldBtn) {
        if (oldBtn) oldBtn.remove();
        safe('refreshCardButton', function () { _runInject(movie, render, { skipPrefetch: true }); });
    }

    function injectButtonAt(render, btn) {
        var c = render.find('.full-start-new__buttons, .full-start__buttons').first();
        if (c.length) {
            c.prepend(btn);
            return 'prepend:buttons';
        }

        var playSelectors = [
            '.full-start-new__button--play',
            '.full-start__button--play',
            '.button--play',
            '[data-button="play"]',
            '[data-action="play"]'
        ];
        for (var i = 0; i < playSelectors.length; i++) {
            var p = render.find(playSelectors[i]).first();
            if (p.length) { p.before(btn); return 'before:' + playSelectors[i]; }
        }

        var torr = render.find('.view--torrent').first();
        if (torr.length) { torr.before(btn); return 'before:view--torrent'; }

        var fb = render.find('.full-start__button').first();
        if (fb.length) { fb.before(btn); return 'before-first:full-start__button'; }

        return null;
    }

    function refreshFocusCollection(render, focusEl) {
        try {
            if (!window.Lampa || !Lampa.Controller || !Lampa.Controller.collectionSet) return;
            var ctrl = Lampa.Controller.enabled && Lampa.Controller.enabled();
            var ctrlName = ctrl && ctrl.name;
            if (ctrlName !== 'full' && ctrlName !== 'full_start' && ctrlName !== 'content') return;
            Lampa.Controller.collectionSet(render);
            if (focusEl) {
                try { Lampa.Controller.collectionFocus(focusEl, render); }
                catch (err2) { warn('collectionFocus error', err2 && err2.message); }
            }
            log('controller collection refreshed (ctrl=' + ctrlName + ', focused=' + (!!focusEl) + ')');
        } catch (err) { warn('refreshFocusCollection error', err && err.message); }
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
        if (!target) { log('no continue target for "' + pickTitle(movie) + '"'); return; }
        var params = target.params;

        if (!opts.skipPrefetch) prefetchTorrent(movie, params);

        var percent = 0, timeStr = '';
        if (!target.isNext) {
            var hash = generateHash(movie, params.season, params.episode);
            var view = safe('Timeline.view', function () { return Lampa.Timeline.view(hash); });
            if (view && view.percent > 0) { percent = view.percent; timeStr = formatTime(view.time); }
            else if (params.time) { percent = params.percent || 0; timeStr = formatTime(params.time); }
        }

        var label = target.isNext ? 'Следующая' : 'Продолжить';
        if (params.season && params.episode) label += ' S' + params.season + ' E' + params.episode;
        if (timeStr) label += ' <span class="cw-btn__time">(' + timeStr + ')</span>';

        var btn = $(buildButtonHtml((percent * 65.97 / 100).toFixed(2), label));
        btn.on('hover:enter', function () { onClickContinue(movie, this); });
        btn.on('hover:long', function () { showContextMenu(movie, target, btn, render); });

        var anchor = injectButtonAt(render, btn);
        if (!anchor) { log('button INJECT failed: no anchor'); return; }

        S.button_injected++;
        log('button INJECTED #' + S.button_injected + ' anchor=' + anchor +
            ' isNext=' + target.isNext + ' %=' + percent);

        lockButtonFocus(render, btn);
    }

    function injectButton(e) {
        S.full_events++;
        var movie = e.data && e.data.movie;
        S.last_full_title = pickTitle(movie);
        log('full:complite #' + S.full_events + ' title="' + S.last_full_title + '"');

        requestAnimationFrame(function () {
            safe('injectButton', function () { _runInject(movie, e.object.activity.render()); });
        });
    }

    function attachFullListener() {
        safe('full listener', function () {
            Lampa.Listener.follow('full', function (e) { if (e.type === 'complite') injectButton(e); });
            log('full:complite listener attached');
        });
    }

    // =========================================================================
    // 13. Профили / Storage listener / миграция
    // =========================================================================
    function attachProfileListener() {
        safe('profile listener', function () {
            Lampa.Listener.follow('profile_select', function () {
                S.mem = null; S.title_index = null;
                S.ts_url = null; S.files = {};
                ensureSync(); migrateOld();
                log('profile changed');
            });
        });
    }

    function attachStorageListener() {
        safe('storage listener', function () {
            Lampa.Storage.listener.follow('change', function (e) {
                if (!e.name) return;
                if (typeof e.name === 'string' && e.name.indexOf('continue_watch_params') === 0) {
                    S.mem = null; S.title_index = null;
                }
                if (e.name === 'account') { S.mem = null; S.title_index = null; ensureSync(); migrateOld(); }
                if (e.name === 'torrserver_url' || e.name === 'torrserver_url_two' || e.name === 'torrserver_use_link') {
                    S.ts_url = null;
                }
            });
        });
    }

    function migrateOld() {
        safe('migrateOld', function () {
            if (!(S.account_ready && Lampa.Account && Lampa.Account.Permit && Lampa.Account.Permit.sync)) return;
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
                description: 'Кнопка «Продолжить» на карточке. © 2026 · Sergey0s · github.com/Sergey0s',
                component: COMPONENT_ID
            };
        });
    }

    // =========================================================================
    // 15. Экран диагностики (Lampa.Component)
    // =========================================================================
    function DiagComponent() {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var outer = $('<div class="cw-diag"></div>');
        var body = $('<div class="cw-diag__body"></div>');

        function row(label, value, accent) {
            return $('<div class="cw-diag__row' + (accent ? ' cw-diag__row--accent' : '') + '">' +
                '<div class="cw-diag__label">' + label + '</div>' +
                '<div class="cw-diag__value">' + value + '</div></div>');
        }

        function entry(p, hash) {
            var sub = (p.season && p.episode) ? ('S' + p.season + ' E' + p.episode) : 'фильм';
            var meta = (p.percent ? Math.round(p.percent) : 0) + '% · ' +
                (p.time ? formatTime(p.time) : '0:00') + ' / ' + (p.duration ? formatTime(p.duration) : '?') + ' · ' +
                (p.timestamp ? new Date(p.timestamp).toLocaleString() : '—');
            var torr = p.torrent_link ? ('магнет: ' + (p.torrent_link.length > 60 ? p.torrent_link.slice(0, 60) + '…' : p.torrent_link)) : 'без магнета';
            return $('<div class="selector cw-diag__entry">' +
                '<div class="cw-diag__entry-title">' + (p.title || '—') + ' · <span class="cw-diag__sub">' + sub + '</span></div>' +
                '<div class="cw-diag__entry-meta">' + meta + '</div>' +
                '<div class="cw-diag__entry-meta cw-diag__entry-torr">hash: ' + hash + ' · ' + torr + '</div></div>');
        }

        this.create = function () {};
        this.render = function () { return outer; };

        this.start = function () {
            safe('bg', function () { Lampa.Background.immediately(Lampa.Utils.cardImgBackground({ img: '' })); });
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(false, scroll.render());
                },
                left: function () { Lampa.Controller.toggle('menu'); },
                up: function () { Navigator.move('up'); },
                down: function () { Navigator.move('down'); },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};
        this.destroy = function () { scroll.destroy(); outer.remove(); };

        var params = readParams();
        var keys = Object.keys(params).sort(function (a, b) { return (params[b].timestamp || 0) - (params[a].timestamp || 0); });
        var tsU = torrUrl();

        body.append('<div class="cw-diag__title">Продолжить · v' + PLUGIN_VERSION + '</div>');
        body.append(row('Ключ хранилища', S.active_key || '—', true));
        body.append(row('Записей в storage', '<b>' + keys.length + '</b>', true));
        body.append(row('TorrServer URL', tsU || '<span style="color:#f66">не настроен</span>', true));

        if (!tsU) {
            var t = dumpTorrKeys();
            var names = Object.keys(t);
            body.append(row('torr-ключи в storage', names.length ?
                names.map(function (k) { return k + '=' + t[k]; }).join(' · ') :
                '<span style="color:#f66">не найдено</span>'));
        }

        body.append(row('События full:complite', S.full_events));
        body.append(row('Кнопок вставлено', S.button_injected));
        body.append(row('Перехватов Player.play()', S.play_intercepted));
        body.append(row('Последняя карточка', S.last_full_title || '—'));
        body.append(row('Последний play.url', S.last_play_url ?
            (S.last_play_url.length > 90 ? S.last_play_url.slice(0, 90) + '…' : S.last_play_url) : '—'));
        if (S.last_lookup) {
            body.append(row('Последний поиск',
                S.last_lookup.kind + ' · "' + S.last_lookup.title + '" · ' +
                (S.last_lookup.found ? '<span style="color:#7c7">найдено</span>' : '<span style="color:#f66">не найдено</span>') +
                ' · keys=' + S.last_lookup.total));
        }
        body.append(row('Debug log', DEBUG ? 'включён · cw.debug(false) чтобы выключить' : 'выключен · cw.debug(true) чтобы включить'));
        body.append(row('Окно буферизации',
            (bufferingEnabled() ? '<span style="color:#7c7">ВКЛ</span>' : '<span style="color:#f66">ВЫКЛ</span>') +
            ' · порог авто-старта: <b>' + bufferThreshold() + '%</b> · <span style="opacity:.6">cw.buffer(true|false, %)</span>'));
        var prefetchStatus = '';
        if (S.last_prefetched_link) {
            prefetchStatus = ' · буфер: <b>' + S.prefetch_pct + '%</b>' +
                ' · скорость: ' + fmtSpeed(S.prefetch_speed) +
                (S.prefetch_target_reached ? ' · <span style="color:#7c7">цель достигнута</span>' :
                    (S.prefetch_poll_iv ? ' · <span style="color:#fc7">в процессе…</span>' : ''));
        }
        body.append(row('Фоновый prefetch',
            (prefetchEnabled() ? '<span style="color:#7c7">ВКЛ</span>' : '<span style="color:#f66">ВЫКЛ</span>') +
            ' · цель: <b>' + prefetchTarget() + '%</b>' +
            ' · запусков: <b>' + S.prefetched + '</b>' +
            prefetchStatus +
            ' · <span style="opacity:.6">cw.prefetch(true|false, %)</span>'));

        body.append(row('Smart next-episode', 'порог: <b>' + SMART_NEXT_PCT + '%</b> · long-press на «Продолжить» — контекстное меню'));
        body.append(row('TorrServer add', 'magnet → infohash на клиенте + GET /stream?preload (simple CORS, без preflight); перед add в модалке — GET /echo health-check'));

        body.append('<div class="cw-diag__sect">Сохранённые записи</div>');
        if (!keys.length) {
            body.append('<div class="cw-diag__empty">Записей нет. Запустите воспроизведение через Торренты — здесь должна появиться запись.</div>');
        } else {
            for (var i = 0; i < Math.min(keys.length, 50); i++) body.append(entry(params[keys[i]], keys[i]));
            if (keys.length > 50) body.append('<div class="cw-diag__empty">…и ещё ' + (keys.length - 50) + '</div>');
        }

        var clearBtn = $('<div class="selector cw-diag__btn">Очистить все записи</div>');
        clearBtn.on('hover:enter', function () {
            safe('clear', function () { Lampa.Storage.set(S.active_key || 'continue_watch_params', {}); });
            S.mem = null; S.title_index = null;
            noty('Очищено');
            Lampa.Activity.replace({ component: COMPONENT_ID, title: 'Продолжить · диагностика' });
        });
        body.append(clearBtn);

        scroll.append(body);
        outer.append(scroll.render());
    }

    // =========================================================================
    // 16. Меню + стили
    // =========================================================================
    function addStyles() {
        var css =
            '.cw-diag{padding:1.5em;padding-bottom:6rem}' +
            '.cw-diag__title{font-size:1.6em;font-weight:bold;margin-bottom:1em}' +
            '.cw-diag__row{display:flex;justify-content:space-between;padding:.5em .8em;margin-bottom:.3em;background:rgba(255,255,255,.04);border-radius:.4em;font-size:.95em}' +
            '.cw-diag__row--accent{background:rgba(124,58,237,.15)}' +
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
        if ($('.menu .menu__item[data-action="' + PLUGIN_ID + '"]').length) return true;
        var list = $('.menu .menu__list').eq(0);
        if (!list.length) return false;

        var item = $(
            '<li class="menu__item selector" data-action="' + PLUGIN_ID + '">' +
                '<div class="menu__ico">' +
                    '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                        '<path d="M8 5v14l11-7L8 5z" fill="currentColor"/>' +
                        '<circle cx="12" cy="12" r="10.5" stroke="currentColor" stroke-width="1.5" fill="none"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="menu__text">' + PLUGIN_NAME +
                    ' <span class="cw-menu-ver">v' + PLUGIN_VERSION + '</span></div>' +
            '</li>'
        );
        item.on('hover:enter', function () {
            safe('Activity.push', function () {
                Lampa.Activity.push({
                    url: '', title: 'Продолжить · диагностика v' + PLUGIN_VERSION,
                    component: COMPONENT_ID, page: 1
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
        var iv = setInterval(function () {
            attempts++;
            if (tryAddMenu() || attempts >= MENU_RETRY_MAX) clearInterval(iv);
        }, MENU_RETRY_MS);
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
                for (var h in p) if ((p[h].title || '').toLowerCase().indexOf(qLow) !== -1) r[h] = p[h];
                console.log('[CW] find("' + q + '"):', r);
                return r;
            },
            clear: function () {
                safe('clear', function () { Lampa.Storage.set(S.active_key || 'continue_watch_params', {}); });
                S.mem = null; S.title_index = null;
                console.log('[CW] cleared');
            },
            torr: torrUrl,
            torrKeys: dumpTorrKeys,
            buffer: function (enabled, pct) {
                if (typeof enabled !== 'undefined') Lampa.Storage.set(BUFFER_SETTING_KEY, !!enabled);
                if (typeof pct === 'number') Lampa.Storage.set(BUFFER_PCT_KEY, pct);
                console.log('[CW] buffer modal:', bufferingEnabled() ? 'ON' : 'OFF', 'threshold:', bufferThreshold() + '%');
                return { enabled: bufferingEnabled(), threshold: bufferThreshold() };
            },
            prefetch: function (enabled, target) {
                if (typeof enabled !== 'undefined') {
                    Lampa.Storage.set(PREFETCH_KEY, !!enabled);
                    if (!enabled) { stopPrefetchPoll(); S.last_prefetched_link = null; }
                }
                if (typeof target === 'number') Lampa.Storage.set(PREFETCH_TARGET_KEY, target);
                console.log('[CW] prefetch:', prefetchEnabled() ? 'ON' : 'OFF',
                    'target:', prefetchTarget() + '%',
                    'count:', S.prefetched,
                    'last_pct:', S.prefetch_pct + '%',
                    'reached:', S.prefetch_target_reached);
                return {
                    enabled: prefetchEnabled(), target: prefetchTarget(),
                    count: S.prefetched, last_pct: S.prefetch_pct,
                    last_speed: S.prefetch_speed, target_reached: S.prefetch_target_reached,
                    last_link: S.last_prefetched_link
                };
            },
            inject: function () {
                var act = Lampa.Activity.active();
                var movie = act && act.movie;
                if (!movie) return console.log('[CW] no active card');
                Lampa.Listener.send('full', { type: 'complite', data: { movie: movie }, object: { activity: act } });
            }
        };
    }

    // =========================================================================
    // 18. Boot
    // =========================================================================
    function boot() {
        if (S.booted) return;
        S.booted = true;
        S.account_ready = true;

        if (DEBUG) {
            log('--- boot v' + PLUGIN_VERSION + ' ---');
            log('Lampa.Player=' + !!Lampa.Player + ' .Timeline=' + !!Lampa.Timeline +
                ' .Torserver=' + !!Lampa.Torserver + ' .Component=' + !!Lampa.Component +
                ' menu_in_dom=' + ($('.menu .menu__list').length > 0));
        }

        addStyles();
        safe('Component.add', function () { Lampa.Component.add(COMPONENT_ID, DiagComponent); });
        registerManifest();
        addMenuRobust();
        exposeCw();

        ensureSync();
        attachStorageListener();
        patchPlayer();
        attachFullListener();
        attachTimelineListener();
        attachProfileListener();
        migrateOld();

        setTimeout(cleanupOldParams, 10000);

        if (DEBUG) log('--- boot complete, entries=' + Object.keys(readParams()).length + ' torrserver=' + (torrUrl() || 'NONE') + ' ---');
    }

    function waitLampa() {
        if (safeLampa()) startBootstrap();
        else setTimeout(waitLampa, 100);
    }

    function startBootstrap() {
        safe('app listener', function () {
            Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') boot(); });
        });
        if (window.appready) boot();
    }

    waitLampa();
})();
