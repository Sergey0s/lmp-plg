/*!
 * © 2026 · Автор: Sergey0s
 */
(function () {
    'use strict';

    if (window.wrestling_weekly_plugin) return;
    window.wrestling_weekly_plugin = true;

    var PLUGIN_ID = 'wrestling_weekly';
    var PLUGIN_VERSION = '2.1.9';
    var PLUGIN_NAME = 'Рестлинг';
    var COMPONENT_NAME = 'wrestling_weekly';
    var PLUGIN_AUTHOR_LABEL = 'github.com/Sergey0s';
    var PLUGIN_AUTHOR_URL = 'https://' + PLUGIN_AUTHOR_LABEL;

    // Логотипы тайлов рендерятся ~150-180px по высоте — 240px ширины более
    // чем достаточно. Раньше тянули 960px (200-300KB каждый), что давало
    // ~2-3MB трафика только на иконки при первом открытии плагина.
    var IMG_WWE_RAW       = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/WWE_RAW_Logo_2025.svg/240px-WWE_RAW_Logo_2025.svg.png';
    var IMG_WWE_SMACKDOWN = 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/WWE_SmackDown_%282024%29_Logo.svg/240px-WWE_SmackDown_%282024%29_Logo.svg.png';
    var IMG_AEW_DYNAMITE  = 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/AEW_Dynamite_logo_%28simplified%29.jpg/240px-AEW_Dynamite_logo_%28simplified%29.jpg';
    var IMG_AEW_COLLISION = 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/All_Elite_Wrestling_logo_2024.svg/240px-All_Elite_Wrestling_logo_2024.svg.png';
    var IMG_TNA_IMPACT    = 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/TNA_Impact%21_2024.png/240px-TNA_Impact%21_2024.png';
    var IMG_PPV           = 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Standard_WrestleMania_logo_from_2019_to_present.png/240px-Standard_WrestleMania_logo_from_2019_to_present.png';
    var IMG_UFC           = 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/UFC_Logo.svg/240px-UFC_Logo.svg.png';
    var IMG_BKFC          = 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Bkfc-logo.png/240px-Bkfc-logo.png';

    // Backdrop'ы и так размываются (blur(2px)) и затемняются — w300
    // даёт визуально неотличимую картинку при 3-4x меньшем весе.
    var TMDB = 'https://image.tmdb.org/t/p/w300';
    var BG_WWE_RAW       = TMDB + '/dzexW1LJMC5w4oqG2XxUTcGMhL5.jpg';
    var BG_WWE_SMACKDOWN = TMDB + '/2bEaTevFYWY1lLIgsGEIjJddiDw.jpg';
    var BG_AEW_DYNAMITE  = TMDB + '/qQUMMyY4IbSW4a8c1GvmcBdRDDY.jpg';
    var BG_AEW_COLLISION = TMDB + '/dQ8CwU7ADTXJ1Qzf7WiTWgtrvkd.jpg';
    var BG_TNA_IMPACT    = TMDB + '/10dazLg0WJnlirHbgZF7m57iJCu.jpg';
    var BG_PPV           = TMDB + '/uGbpWb3R73LJj7LlQJ7B8cljYJL.jpg';
    var BG_UFC           = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/UFC_74_Respect_Bout.jpg/640px-UFC_74_Respect_Bout.jpg';
    var BG_BKFC          = 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/BKFC_UK_Ring.jpg/640px-BKFC_UK_Ring.jpg';

    var WEEKLY = [
        { id: 'wwe_raw',        title: 'WWE Monday Night Raw',           short: 'WWE Raw',        queries: ['WWE Raw', 'WWE Monday Night Raw'],        airDay: 1, kind: 'weekly', promotion: 'WWE', color: '#E51A22', image: IMG_WWE_RAW,       backdrop: BG_WWE_RAW },
        { id: 'wwe_smackdown',  title: 'WWE Friday Night SmackDown',     short: 'WWE SmackDown',  queries: ['WWE SmackDown', 'WWE Friday Night SmackDown'], airDay: 5, kind: 'weekly', promotion: 'WWE', color: '#0072CE', image: IMG_WWE_SMACKDOWN, backdrop: BG_WWE_SMACKDOWN },
        { id: 'aew_dynamite',   title: 'AEW Dynamite',                   short: 'AEW Dynamite',   queries: ['AEW Dynamite', 'All Elite Wrestling Dynamite'], airDay: 3, kind: 'weekly', promotion: 'AEW', color: '#1F1F1F', image: IMG_AEW_DYNAMITE,  backdrop: BG_AEW_DYNAMITE },
        { id: 'aew_collision',  title: 'AEW Collision',                  short: 'AEW Collision',  queries: ['AEW Collision', 'All Elite Wrestling Collision'], airDay: 6, kind: 'weekly', promotion: 'AEW', color: '#C8102E', image: IMG_AEW_COLLISION, backdrop: BG_AEW_COLLISION },
        { id: 'tna_impact',     title: 'TNA iMPACT! Wrestling',          short: 'TNA Impact',     queries: ['TNA Impact', 'TNA iMPACT Wrestling', 'Impact Wrestling'], airDay: 4, kind: 'weekly', promotion: 'TNA', color: '#2E2E2E', image: IMG_TNA_IMPACT,    backdrop: BG_TNA_IMPACT }
    ];

    var PPV_KEYWORDS = [
        'wrestlemania', 'royal rumble', 'summerslam', 'survivor series',
        'money in the bank', 'elimination chamber', 'backlash', 'crown jewel',
        'bad blood', 'clash at', 'clash in', 'night of champions',
        'saturday night main event', 'saturday night s main event', 'snme',
        'wwe ppv', 'wwe ple',
        'all in', 'double or nothing', 'all out', 'full gear', 'revolution',
        'wrestledream', 'worlds end', 'forbidden door', 'dynasty', 'grand slam',
        'aew ppv',
        'bound for glory', 'hard to kill', 'rebellion', 'slammiversary',
        'genesis', 'victory road', 'no surrender', 'against all odds',
        'tna ppv'
    ];

    var PPV_EXCLUDE = ['raw', 'smackdown', 'dynamite', 'collision', 'impact', 'nxt', 'main event'];

    var SEARCH_TILE = {
        id: 'free_search',
        title: 'Свободный поиск',
        short: '🔍 Поиск',
        kind: 'search',
        color: '#1F2937',
        emoji: '🔍'
    };

    function makeAggregator(config) {
        /*
         * Shared factory for PPV-style aggregator tiles (WWE/AEW/TNA PPV, UFC, BKFC).
         */
        return {
            id: config.id,
            title: config.title,
            short: config.short,
            queries: config.queries,
            ppvKeywords: config.keywords,
            excludeKeywords: config.exclude || [],
            kind: 'ppv',
            promotion: config.promotion,
            freshDays: config.freshDays,
            color: config.color,
            image: config.image,
            backdrop: config.backdrop
        };
    }

    var PPV_AGGREGATE = makeAggregator({
        id: 'ppv_all', title: 'PPV / PLE ивенты', short: 'PPV / PLE', promotion: 'PPV',
        queries: ['WWE', 'AEW', 'TNA Wrestling'],
        keywords: PPV_KEYWORDS, exclude: PPV_EXCLUDE,
        freshDays: 90, color: '#7C3AED', image: IMG_PPV, backdrop: BG_PPV
    });

    var UFC_AGGREGATE = makeAggregator({
        id: 'ufc_all', title: 'UFC турниры', short: 'UFC', promotion: 'UFC',
        queries: ['UFC', 'UFC Fight Night', 'UFC on ESPN', 'UFC on ABC'],
        keywords: ['ufc', 'ultimate fighting championship'],
        freshDays: 90, color: '#D20A0A', image: IMG_UFC, backdrop: BG_UFC
    });

    var BKFC_AGGREGATE = makeAggregator({
        id: 'bkfc_all', title: 'BKFC турниры', short: 'BKFC', promotion: 'BKFC',
        queries: ['BKFC', 'Bare Knuckle Fighting Championship', 'Bare Knuckle FC'],
        keywords: ['bkfc', 'bare knuckle fighting championship', 'bare knuckle'],
        freshDays: 180, color: '#F59E0B', image: IMG_BKFC, backdrop: BG_BKFC
    });

    var DAY_NAMES = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

    var FILTER_DAYS_OPTIONS = [
        { title: '7 дней', value: 7 },
        { title: '14 дней', value: 14 },
        { title: '30 дней', value: 30 },
        { title: '60 дней', value: 60 },
        { title: '90 дней', value: 90 },
        { title: '180 дней', value: 180 },
        { title: '365 дней', value: 365 },
        { title: 'Без ограничения', value: 0 }
    ];

    var SORT_OPTIONS = [
        { title: 'По сидам', value: 'seeders' },
        { title: 'По дате', value: 'date' },
        { title: 'Дата + размер', value: 'date_size' }
    ];

    var FEED_DAYS = 14;
    var FEED_LIMIT = 60;
    // 24 уникальных запроса × concurrency 3 = минимум 8 раундов, каждый
    // с timeout 20s = в худшем случае 160 секунд. Поднимаем concurrency
    // и снижаем timeout — слишком медленные JacRed-серверы должны падать
    // быстрее, а не блокировать UI.
    var FEED_SEARCH_CONCURRENCY = 5;
    var EVENT_QUERY_CONCURRENCY = 2;
    var JACRED_REQUEST_TIMEOUT_MS = 10000;
    var WRESTLING_FEED_KEYWORDS = [
        'wwe', 'aew', 'tna', 'impact wrestling', 'njpw', 'roh', 'ring of honor',
        'all elite wrestling', 'world wrestling entertainment',
        'рестлинг', 'реслинг',
        'ufc', 'ultimate fighting championship',
        'bkfc', 'bare knuckle fighting championship', 'bare knuckle'
    ];
    var FEED_KEYWORDS_NORM = null;
    var FEED_TITLE_MATCH_RE = null;

    var FEED_EXTRA_QUERIES = [
        'WWE NXT', 'WWE Main Event', 'WWE PPV', 'AEW PPV', 'TNA PPV',
        'NJPW', 'Ring of Honor',
        'UFC', 'UFC Fight Night', 'UFC on ESPN', 'UFC on ABC',
        'BKFC', 'Bare Knuckle Fighting Championship'
    ];

    function defaultFilterState(eventKind) {
        if (eventKind === 'weekly') return { freshDays: 60, sortBy: 'date' };
        if (eventKind === 'ppv')    return { freshDays: 90, sortBy: 'date' };
        if (eventKind === 'custom') return { freshDays: 0,  sortBy: 'date' };
        return { freshDays: 60, sortBy: 'date' };
    }

    function getFilterState(eventKind) {
        var key = 'wrestling_filter_' + (eventKind || 'default');
        var saved = Lampa.Storage.get(key, null);
        if (saved && typeof saved === 'object' && typeof saved.freshDays === 'number' && saved.sortBy) {
            return { freshDays: saved.freshDays, sortBy: saved.sortBy };
        }
        return defaultFilterState(eventKind);
    }

    function saveFilterState(eventKind, state) {
        Lampa.Storage.set('wrestling_filter_' + (eventKind || 'default'), state);
    }

    function labelForDays(days) {
        if (!days) return 'Без ограничения';
        return days + ' дней';
    }

    function labelForSort(sort) {
        for (var i = 0; i < SORT_OPTIONS.length; i++) {
            if (SORT_OPTIONS[i].value === sort) return SORT_OPTIONS[i].title;
        }
        return SORT_OPTIONS[0].title;
    }

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '—';
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
    }

    function formatDate(date) {
        if (!date) return '';
        var d = new Date(date);
        if (isNaN(d.getTime())) return '';
        var dd = String(d.getDate()).padStart(2, '0');
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        var yyyy = d.getFullYear();
        return dd + '.' + mm + '.' + yyyy;
    }

    function nextAirDate(airDay) {
        var now = new Date();
        var diff = (airDay - now.getDay() + 7) % 7;
        var next = new Date(now);
        next.setDate(now.getDate() + diff);
        return next;
    }

    function previousAirDate(airDay) {
        var now = new Date();
        var diff = (now.getDay() - airDay + 7) % 7;
        var prev = new Date(now);
        prev.setDate(now.getDate() - diff);
        return prev;
    }

    var NORMALIZE_RE = /[._\-\[\](){}!?,'"`~+=:;\/\\|<>@#$%^&*]+/g;
    var WHITESPACE_RE = /\s+/g;

    function escapeRegExp(s) {
        return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function normalizeText(s) {
        return (s || '')
            .toLowerCase()
            .replace(NORMALIZE_RE, ' ')
            .replace(WHITESPACE_RE, ' ')
            .trim();
    }

    function titleNorm(r) {
        if (r._titleNorm === undefined) r._titleNorm = normalizeText(r.Title);
        return r._titleNorm;
    }

    function tryBuildDate(year, month, day) {
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
        var d = new Date(year, month - 1, day);
        if (isNaN(d.getTime())) return null;
        if (d.getMonth() === month - 1 && d.getDate() === day && d.getFullYear() === year) return d;
        return null;
    }

    var EPISODE_DATE_RE = /\b(?:(20\d{2})[._\-\/ ](\d{1,2})[._\-\/ ](\d{1,2})|(\d{1,2})[._\-\/ ](\d{1,2})[._\-\/ ](20\d{2})|(\d{1,2})[._\-\/ ](\d{1,2})[._\-\/ ](\d{2}))\b/;

    function extractEpisodeDate(rawTitle) {
        if (!rawTitle) return null;
        var m = EPISODE_DATE_RE.exec(String(rawTitle).replace(/_/g, '.'));
        if (!m) return null;

        if (m[1]) return tryBuildDate(+m[1], +m[2], +m[3]);

        if (m[4]) {
            return tryBuildDate(+m[6], +m[5], +m[4])
                || tryBuildDate(+m[6], +m[4], +m[5]);
        }

        var year2 = 2000 + (+m[9]);
        return tryBuildDate(year2, +m[8], +m[7])
            || tryBuildDate(year2, +m[7], +m[8]);
    }

    function pickEffectiveDate(r) {
        var ep = extractEpisodeDate(r.Title);
        if (ep) return { date: ep, source: 'episode' };
        var pubMs = r.PublishDate ? new Date(r.PublishDate).getTime() : 0;
        if (pubMs && !isNaN(pubMs)) return { date: new Date(pubMs), source: 'publish' };
        return { date: null, source: null };
    }

    function ensureEffectiveDate(r) {
        if (r._effectiveDate === undefined) {
            var picked = pickEffectiveDate(r);
            r._effectiveDate = picked.date;
            r._dateSource = picked.source;
        }
        return r._effectiveDate;
    }

    function tokenize(s) {
        var n = normalizeText(s);
        return n ? n.split(' ') : [];
    }

    var TOKEN_RE_CACHE = {};
    function tokenRegex(token) {
        if (!TOKEN_RE_CACHE[token]) {
            TOKEN_RE_CACHE[token] = new RegExp('(^| )' + escapeRegExp(token) + '( |$)');
        }
        return TOKEN_RE_CACHE[token];
    }

    function queryMatchesTitle(tNorm, queryTokens) {
        if (!queryTokens.length) return false;
        for (var i = 0; i < queryTokens.length; i++) {
            if (!tokenRegex(queryTokens[i]).test(tNorm)) return false;
        }
        return true;
    }

    function normalizeJackettUrl(raw) {
        var url = String(raw || '').trim().replace(/\/+$/, '');
        if (!url) return '';
        if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
        return url.replace('jacred.xyz', 'jac.red');
    }

    function hostFromUrl(url) {
        return String(url || '')
            .replace(/^https?:\/\//i, '')
            .replace(/\/.*$/, '')
            .toLowerCase();
    }

    function getJackettConfigs() {
        var list = [
            {
                base: normalizeJackettUrl(Lampa.Storage.get('jackett_url', '')),
                key: String(Lampa.Storage.get('jackett_key', '') || '')
            },
            {
                base: normalizeJackettUrl(Lampa.Storage.get('jackett_url_two', '')),
                key: String(Lampa.Storage.get('jackett_key_two', '') || '')
            }
        ];

        var out = [];
        var seen = {};
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            if (!it.base) continue;
            if (seen[it.base]) continue;
            seen[it.base] = true;
            it.host = hostFromUrl(it.base);
            out.push(it);
        }
        return out;
    }

    function normalizeJacRedItem(item) {
        var magnet = item.magnet || '';
        return {
            Title: item.title || item.name || '',
            Tracker: item.trackerName || item.tracker || '',
            Size: item.size || 0,
            MagnetUri: magnet,
            Link: item.url || '',
            Seeders: parseInt(item.sid || 0, 10) || 0,
            Peers: parseInt(item.pir || 0, 10) || 0,
            PublishDate: item.createTime || item.publishDate || null,
            hash: magnetToHash(magnet)
        };
    }

    var B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    var B32_VAL = (function () {
        var o = {};
        for (var bi = 0; bi < B32_ALPHABET.length; bi++) o[B32_ALPHABET.charAt(bi)] = bi;
        return o;
    }());

    function base32ToHex(str) {
        var bitsParts = [];
        for (var i = 0; i < str.length; i++) {
            var v = B32_VAL[str.charAt(i)];
            if (v === undefined) return '';
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

    // Извлекаем infohash из magnet локально, чтобы не гонять лишний запрос
    // в TorrServer. Поддерживаем 40-char hex (v1) и 32-char base32, плюс
    // случаи URL-encoded magnet и v2 (btmh).
    function magnetToHash(magnet) {
        if (!magnet) return '';
        var s = String(magnet);
        var variants = [s];
        try { variants.push(decodeURIComponent(s)); } catch (e) {}
        try { variants.push(decodeURIComponent(decodeURIComponent(s))); } catch (e) {}
        for (var i = 0; i < variants.length; i++) {
            var v = variants[i];
            var hex = v.match(/[?&]xt=urn:bt[im]h:([a-fA-F0-9]{40})/i) ||
                      v.match(/urn:bt[im]h:([a-fA-F0-9]{40})/i);
            if (hex) return hex[1].toLowerCase();
            var b32 = v.match(/[?&]xt=urn:bt[im]h:([a-zA-Z2-7]{32})/i) ||
                      v.match(/urn:bt[im]h:([a-zA-Z2-7]{32})/i);
            if (b32) {
                var h = base32ToHex(b32[1].toUpperCase());
                if (h) return h;
            }
        }
        return '';
    }

    function wrLog() {
        if (!window.console || !console.log) return;
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[WR]');
        try { console.log.apply(console, args); } catch (e) {}
    }

    var JACRED_CACHE_TTL = 5 * 60 * 1000;
    var JACRED_CACHE_MAX = 40;
    var jacRedCache = {};
    var activeRequests = [];
    var activePlayerLog = null;
    var cleanupCount = 0;
    var lastCleanupReason = '';

    // Персистентный кэш «свежих раздач» в Lampa.Storage — при следующем
    // открытии плагина показываем последний результат МГНОВЕННО, а
    // фоновое обновление подменяет результат когда придёт. Без этого
    // юзер каждый раз смотрит «Загружаю свежие раздачи...» 5-15 секунд
    // пока 24 JacRed-запроса не отработают.
    var FEED_PERSIST_KEY = 'wrestling_feed_cache_v1';
    var FEED_PERSIST_TTL = 15 * 60 * 1000;
    var FEED_PERSIST_TTL_STALE = 6 * 60 * 60 * 1000;

    function loadFeedFromStorage() {
        try {
            var raw = Lampa.Storage.get(FEED_PERSIST_KEY, null);
            if (!raw || typeof raw !== 'object') return null;
            if (!Array.isArray(raw.matches)) return null;
            var age = Date.now() - (raw.ts || 0);
            if (age > FEED_PERSIST_TTL_STALE) return null;
            return {
                matches: raw.matches,
                ts: raw.ts || 0,
                fresh: age < FEED_PERSIST_TTL,
                version: raw.version || ''
            };
        } catch (e) {
            return null;
        }
    }

    function saveFeedToStorage(matches) {
        try {
            var payload = {
                ts: Date.now(),
                version: PLUGIN_VERSION,
                matches: (matches || []).slice(0, FEED_LIMIT)
            };
            Lampa.Storage.set(FEED_PERSIST_KEY, payload);
        } catch (e) {}
    }

    function clearFeedStorage() {
        try { Lampa.Storage.set(FEED_PERSIST_KEY, null); } catch (e) {}
    }

    function removeActiveRequest(network) {
        for (var i = activeRequests.length - 1; i >= 0; i--) {
            if (activeRequests[i] === network) activeRequests.splice(i, 1);
        }
    }

    function pruneJacRedCache() {
        var now = Date.now();
        var keys = Object.keys(jacRedCache);
        var keep = [];
        for (var i = 0; i < keys.length; i++) {
            var item = jacRedCache[keys[i]];
            if (item && (now - item.ts) < JACRED_CACHE_TTL) keep.push(keys[i]);
            else delete jacRedCache[keys[i]];
        }
        if (keep.length <= JACRED_CACHE_MAX) return;
        keep.sort(function (a, b) {
            return (jacRedCache[a].ts || 0) - (jacRedCache[b].ts || 0);
        });
        while (keep.length > JACRED_CACHE_MAX) {
            delete jacRedCache[keep.shift()];
        }
    }

    function memorySnapshot() {
        var m = (window.performance && performance.memory) ? performance.memory : null;
        if (!m) return null;
        return {
            used: m.usedJSHeapSize || 0,
            total: m.totalJSHeapSize || 0,
            limit: m.jsHeapSizeLimit || 0
        };
    }

    function cleanupPlayerLog() {
        if (!activePlayerLog) return;
        try {
            if (Lampa.Player && Lampa.Player.listener && activePlayerLog.listener) {
                Lampa.Player.listener.remove('start', activePlayerLog.listener);
            }
        } catch (e) {}
        if (activePlayerLog.timer) clearTimeout(activePlayerLog.timer);
        activePlayerLog = null;
    }

    function cleanupRuntime(reason) {
        cleanupPlayerLog();
        pruneJacRedCache();
        for (var i = activeRequests.length - 1; i >= 0; i--) {
            try {
                if (activeRequests[i] && typeof activeRequests[i].clear === 'function') activeRequests[i].clear();
            } catch (e) {}
        }
        activeRequests = [];
        cleanupCount++;
        lastCleanupReason = reason || 'manual';
        wrLog('cleanup', lastCleanupReason, 'cache=' + Object.keys(jacRedCache).length, 'mem=', memorySnapshot());
    }

    function searchJacRedSingle(config, query, callback, errorCallback) {
        var cacheKey = config.base + '|' + query;
        var cached = jacRedCache[cacheKey];
        if (cached && (Date.now() - cached.ts) < JACRED_CACHE_TTL) {
            return callback(cached.data.slice(), { host: config.host, cached: true });
        }

        var url = config.base + '/api/v1.0/torrents?search=' + encodeURIComponent(query) +
            '&apikey=' + encodeURIComponent(config.key || 'null');

        var network = new Lampa.Reguest();
        activeRequests.push(network);
        network.timeout(JACRED_REQUEST_TIMEOUT_MS);
        network.silent(url, function (data) {
            removeActiveRequest(network);
            if (!Array.isArray(data)) return errorCallback('JacRed(' + config.host + '): ответ не массив');
            var normalized = data.map(normalizeJacRedItem);
            jacRedCache[cacheKey] = { data: normalized, ts: Date.now() };
            pruneJacRedCache();
            callback(normalized.slice(), { host: config.host, cached: false });
        }, function (xhr) {
            removeActiveRequest(network);
            errorCallback('JacRed(' + config.host + ') недоступен (' + (xhr && xhr.status ? xhr.status : 'нет ответа') + ')');
        });
    }

    function searchJacRed(query, callback, errorCallback) {
        var configs = getJackettConfigs();
        if (!configs.length) return errorCallback('jackett_url не задан в Lampa');

        var pending = configs.length;
        var all = [];
        var seen = {};
        var sourceStats = [];
        var hasSuccess = false;
        var firstError = null;

        function mergeRows(rows) {
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i];
                var key = r.MagnetUri || r.Link || (r.Title + '|' + (r.Size || ''));
                if (!seen[key]) {
                    seen[key] = true;
                    all.push(r);
                }
            }
        }

        function done() {
            if (--pending > 0) return;
            if (!hasSuccess) return errorCallback(firstError || 'JacRed недоступен');
            callback(all, { sources: sourceStats });
        }

        for (var i = 0; i < configs.length; i++) {
            (function (cfg) {
                searchJacRedSingle(cfg, query, function (rows) {
                    hasSuccess = true;
                    sourceStats.push({ host: cfg.host, count: rows.length, ok: true });
                    mergeRows(rows || []);
                    done();
                }, function (err) {
                    firstError = firstError || err;
                    sourceStats.push({ host: cfg.host, count: 0, ok: false, error: err });
                    done();
                });
            })(configs[i]);
        }
    }

    var FEED_QUERIES = null;
    function buildFeedQueries() {
        if (FEED_QUERIES) return FEED_QUERIES;
        var set = {};
        var list = [];
        WEEKLY.forEach(function (ev) {
            ev.queries.forEach(function (q) { if (!set[q]) { set[q] = 1; list.push(q); } });
        });
        FEED_EXTRA_QUERIES.forEach(function (q) { if (!set[q]) { set[q] = 1; list.push(q); } });
        FEED_QUERIES = list;
        return list;
    }

    function ensureFeedKeywordsNorm() {
        if (FEED_KEYWORDS_NORM) return;
        FEED_KEYWORDS_NORM = WRESTLING_FEED_KEYWORDS.concat(PPV_KEYWORDS).map(normalizeText);
        var parts = [];
        for (var fi = 0; fi < FEED_KEYWORDS_NORM.length; fi++) {
            if (!FEED_KEYWORDS_NORM[fi]) continue;
            parts.push(escapeRegExp(FEED_KEYWORDS_NORM[fi]));
        }
        FEED_TITLE_MATCH_RE = parts.length ? new RegExp(parts.join('|')) : null;
    }

    function filterFeedMatches(allResults) {
        var titleRe = FEED_TITLE_MATCH_RE;
        var nowMs = Date.now();
        var cutoff = nowMs - FEED_DAYS * 24 * 60 * 60 * 1000;
        var futureLimit = nowMs + 24 * 60 * 60 * 1000;

        var matches = [];
        for (var i = 0; i < allResults.length; i++) {
            var row = allResults[i];
            var tNorm = titleNorm(row);
            if (!(titleRe && titleRe.test(tNorm))) continue;

            var d = ensureEffectiveDate(row);
            if (!d) continue;
            var ms = d.getTime();
            if (ms > futureLimit || ms < cutoff) continue;

            matches.push(row);
        }

        matches.sort(function (a, b) {
            return b._effectiveDate.getTime() - a._effectiveDate.getTime();
        });

        return matches.slice(0, FEED_LIMIT);
    }

    function loadRecentFeed(callback, opts) {
        opts = opts || {};
        var isCancelled = typeof opts.isCancelled === 'function' ? opts.isCancelled : function () { return false; };
        var concurrency = typeof opts.concurrency === 'number' && opts.concurrency > 0
            ? opts.concurrency : FEED_SEARCH_CONCURRENCY;
        // onPartial(matches, meta) — вызывается каждый раз когда приходит ответ
        // от очередного JacRed-запроса. Позволяет UI отрисовывать «свежие
        // раздачи» инкрементально, не ждать пока отработают все 24 запроса.
        var onPartial = typeof opts.onPartial === 'function' ? opts.onPartial : null;

        ensureFeedKeywordsNorm();
        var queries = buildFeedQueries();
        var total = queries.length;
        var allResults = [];
        var seen = {};
        var nextIx = 0;
        var inflight = 0;
        var finished = 0;
        var lastPartialAt = 0;
        var lastPartialCount = 0;

        function mergeResults(results) {
            if (isCancelled()) return;
            for (var ri = 0; ri < results.length; ri++) {
                var r = results[ri];
                var key = r.MagnetUri || r.Link || r.Title;
                if (!seen[key]) {
                    seen[key] = true;
                    allResults.push(r);
                }
            }
        }

        function tryPartial(isFinal) {
            if (!onPartial || isCancelled()) return;
            var now = Date.now();
            // Throttle: одна перерисовка не чаще раза в 350мс, чтобы не
            // молотить DOM при быстрой пачке cached-ответов. На финал
            // throttle снимаем.
            if (!isFinal && now - lastPartialAt < 350) return;
            var matches = filterFeedMatches(allResults);
            if (!isFinal && matches.length === lastPartialCount) return;
            lastPartialAt = now;
            lastPartialCount = matches.length;
            onPartial(matches, {
                finished: finished,
                total: total,
                final: !!isFinal
            });
        }

        function applyFinish() {
            if (isCancelled()) return;
            var matches = filterFeedMatches(allResults);
            tryPartial(true);
            callback(matches);
        }

        function onQueryDone() {
            finished++;
            tryPartial(false);
            if (finished >= total) applyFinish();
            else kick();
        }

        function runOne(q) {
            searchJacRed(q, function (results) {
                mergeResults(results || []);
                inflight--;
                onQueryDone();
            }, function () {
                inflight--;
                onQueryDone();
            });
        }

        function kick() {
            if (isCancelled()) return;
            while (inflight < concurrency && nextIx < total) {
                inflight++;
                runOne(queries[nextIx++]);
            }
        }

        if (!total) {
            if (!isCancelled()) callback([]);
            return;
        }
        kick();
    }

    function searchLampaParser(query, callback, errorCallback) {
        if (!Lampa.Parser || typeof Lampa.Parser.get !== 'function') {
            return errorCallback('Нет Lampa.Parser');
        }
        Lampa.Parser.get({ search: query, other: true, from_search: true }, function (json) {
            callback((json && Array.isArray(json.Results)) ? json.Results : []);
        }, function (err) {
            errorCallback(err || 'Lampa.Parser ошибка');
        });
    }

    function searchTorrents(event, callback, errorCallback) {
        var queriesToTry = event.queries.slice();
        var total = queriesToTry.length;
        var allResults = [];
        var seen = {};
        var anySuccess = false;
        var firstError = null;
        var sourceMap = {};
        var nextIx = 0;
        var inflight = 0;
        var finished = 0;

        function pushResults(results) {
            for (var pi = 0; pi < results.length; pi++) {
                var r = results[pi];
                var key = r.MagnetUri || r.Link || (r.Title + '|' + (r.Size || ''));
                if (!seen[key]) {
                    seen[key] = true;
                    allResults.push(r);
                }
            }
        }

        function mergeMeta(meta) {
            if (!meta || !meta.sources) return;
            for (var i = 0; i < meta.sources.length; i++) {
                var s = meta.sources[i];
                if (!sourceMap[s.host]) sourceMap[s.host] = { host: s.host, count: 0, ok: false };
                sourceMap[s.host].count += (s.count || 0);
                sourceMap[s.host].ok = sourceMap[s.host].ok || !!s.ok;
            }
        }

        function finish() {
            if (!anySuccess && !allResults.length) {
                return errorCallback(firstError || 'Не удалось получить результаты');
            }
            var sources = [];
            for (var k in sourceMap) sources.push(sourceMap[k]);
            callback(allResults, { sources: sources });
        }

        function onQueryDone() {
            finished++;
            if (finished >= total) finish();
            else kick();
        }

        function runQuery(q) {
            searchJacRed(q, function (results, meta) {
                anySuccess = true;
                pushResults(results || []);
                mergeMeta(meta);
                inflight--;
                onQueryDone();
            }, function (err) {
                searchLampaParser(q, function (results) {
                    anySuccess = true;
                    pushResults(results || []);
                    inflight--;
                    onQueryDone();
                }, function (err2) {
                    firstError = firstError || err2 || err;
                    inflight--;
                    onQueryDone();
                });
            });
        }

        function kick() {
            while (inflight < EVENT_QUERY_CONCURRENCY && nextIx < total) {
                inflight++;
                runQuery(queriesToTry[nextIx++]);
            }
        }

        if (!total) {
            return errorCallback('Нет поисковых запросов');
        }
        kick();
    }

    function precomputeEventKeywords(event) {
        if (event._kwPrepared) return;
        if (event.ppvKeywords && event.ppvKeywords.length) {
            event._includeKwNorm = event.ppvKeywords.map(normalizeText);
            event._excludeKwNorm = (event.excludeKeywords || []).map(normalizeText);
            var escParts = [];
            for (var ii = 0; ii < event._includeKwNorm.length; ii++) {
                if (!event._includeKwNorm[ii]) continue;
                escParts.push(escapeRegExp(event._includeKwNorm[ii]));
            }
            event._includeKwRe = escParts.length ? new RegExp(escParts.join('|')) : null;
        }
        if (event.queries && event.queries.length) {
            event._queryTokenSets = event.queries.map(tokenize);
        }
        event._kwPrepared = true;
    }

    function filterEventResults(results, event, state) {
        state = state || defaultFilterState(event.kind);
        precomputeEventKeywords(event);

        for (var i = 0; i < results.length; i++) ensureEffectiveDate(results[i]);

        var matches;
        if (event._includeKwNorm) {
            var inclRe = event._includeKwRe;
            var excl = event._excludeKwNorm;
            matches = [];
            for (var j = 0; j < results.length; j++) {
                var r = results[j];
                var t = titleNorm(r);
                if (!(inclRe && inclRe.test(t))) continue;
                var bad = false;
                for (var ke = 0; ke < excl.length; ke++) {
                    if (excl[ke] && tokenRegex(excl[ke]).test(t)) { bad = true; break; }
                }
                if (!bad) matches.push(r);
            }
        } else if (event._queryTokenSets) {
            var sets = event._queryTokenSets;
            matches = [];
            for (var m = 0; m < results.length; m++) {
                var rr = results[m];
                var tn = titleNorm(rr);
                for (var s = 0; s < sets.length; s++) {
                    if (queryMatchesTitle(tn, sets[s])) { matches.push(rr); break; }
                }
            }
        } else {
            matches = results.slice();
        }

        var pool = matches;
        if (state.freshDays > 0) {
            var cutoff = Date.now() - state.freshDays * 24 * 60 * 60 * 1000;
            var fresh = [];
            for (var f = 0; f < matches.length; f++) {
                var d = matches[f]._effectiveDate;
                if (d && d.getTime() >= cutoff) fresh.push(matches[f]);
            }
            pool = fresh;
        }

        var sortBy = state.sortBy;
        pool.sort(function (a, b) {
            var da = a._effectiveDate ? a._effectiveDate.getTime() : 0;
            var db = b._effectiveDate ? b._effectiveDate.getTime() : 0;
            if (sortBy === 'date')      return (db - da) || ((b.Seeders || 0) - (a.Seeders || 0));
            if (sortBy === 'date_size') return (db - da) || ((b.Size || 0) - (a.Size || 0));
            return ((b.Seeders || 0) - (a.Seeders || 0)) || (db - da);
        });

        return pool;
    }

    function playTorrent(result, event) {
        var magnet = result.MagnetUri || result.Link;
        if (!magnet) return Lampa.Noty.show('Нет magnet/torrent ссылки');

        if (!result.hash) result.hash = magnetToHash(magnet);

        var seeders = +result.Seeders || 0;
        var sizeGb = ((result.Size || 0) / 1073741824).toFixed(2);
        var preloadMode = '';
        try { preloadMode = String(Lampa.Storage.field('torrserver_preload')); } catch (e) {}

        wrLog('play "' + (result.Title || '').slice(0, 80) + '"',
            'seeders=' + seeders, 'peers=' + (result.Peers || 0),
            'size=' + sizeGb + 'GB',
            'hash=' + (result.hash ? result.hash.slice(0, 16) + '…' : 'нет'),
            'tracker=' + (result.Tracker || '—'),
            'preload_mode=' + preloadMode);

        if (seeders > 0 && seeders < 5) {
            Lampa.Noty.show('Внимание: только ' + seeders + ' сидов — буфер может проседать');
        } else if (seeders === 0) {
            Lampa.Noty.show('У раздачи 0 сидов — воспроизведение скорее всего сорвётся');
        }

        attachOneShotPlayerLog();

        if (!Lampa.Torrent || typeof Lampa.Torrent.start !== 'function') {
            Lampa.Noty.show('Lampa.Torrent.start недоступен — обнови Lampa');
            wrLog('Lampa.Torrent.start unavailable');
            return;
        }

        try {
            Lampa.Torrent.start(result, { title: result.Title || (event && event.title) });
        } catch (e) {
            wrLog('Torrent.start threw:', e && e.message);
            Lampa.Noty.show('Ошибка запуска: ' + (e && e.message ? e.message : e));
        }
    }

    // Один раз ловим Player.start чтобы залогировать реальный URL, который
    // Lampa передаёт в плеер (Vimm на Android), и убедиться что в URL стоит
    // &play. Это нужно для диагностики проблем с буфером.
    function attachOneShotPlayerLog() {
        if (!Lampa.Player || !Lampa.Player.listener) return;
        cleanupPlayerLog();
        var fired = false;
        var listener = function (d) {
            if (fired) return;
            fired = true;
            if (activePlayerLog && activePlayerLog.timer) clearTimeout(activePlayerLog.timer);
            activePlayerLog = null;
            var url = (d && d.url) || '';
            var flag = url.indexOf('&play') >= 0 ? 'play' :
                       url.indexOf('&preload') >= 0 ? 'preload' : 'нет';
            wrLog('player start',
                'url_flag=' + flag,
                'has_card=' + !!(d && d.card),
                'has_torrent_hash=' + !!(d && d.torrent_hash),
                'url=' + url.slice(0, 220));
            try { Lampa.Player.listener.remove('start', listener); } catch (e) {}
        };
        try { Lampa.Player.listener.follow('start', listener); } catch (e) {}
        activePlayerLog = {
            listener: listener,
            timer: setTimeout(function () {
                if (fired) return;
                try { Lampa.Player.listener.remove('start', listener); } catch (e) {}
                activePlayerLog = null;
            }, 90000)
        };
    }

    function ensureScreenBackdropLayer() {
        var layer = document.getElementById('wrestling-screen-bg');
        if (layer) return layer;
        layer = document.createElement('div');
        layer.id = 'wrestling-screen-bg';
        document.body.appendChild(layer);
        return layer;
    }

    function setScreenBackdrop(url) {
        var layer = ensureScreenBackdropLayer();
        if (!url) {
            layer.style.opacity = '0';
            return;
        }
        var img = new Image();
        img.onload = function () {
            layer.style.backgroundImage = 'url(\'' + url + '\')';
            layer.style.opacity = '1';
        };
        img.src = url;
    }

    function clearScreenBackdrop() {
        var layer = document.getElementById('wrestling-screen-bg');
        if (layer) {
            layer.style.opacity = '0';
            layer.style.backgroundImage = '';
        }
    }

    function buildEventCard(event) {
        var hasImage = !!event.image;
        var hasEmoji = !hasImage && !!event.emoji;

        var layers = '';
        if (hasImage) {
            layers += '<div class="wrestling-weekly__tile-img" style="background-image:url(\'' + event.image + '\')"></div>';
        } else if (hasEmoji) {
            layers += '<div class="wrestling-weekly__tile-emoji">' + event.emoji + '</div>';
        }

        var modifierClass = hasImage ? ' wrestling-weekly__tile--with-img' : (hasEmoji ? ' wrestling-weekly__tile--with-emoji' : '');

        var html = $(
            '<div class="selector wrestling-weekly__tile' + modifierClass + '">' +
                layers +
                '<div class="wrestling-weekly__tile-name">' + (event.short || event.title) + '</div>' +
            '</div>'
        );

        html.css({ background: event.color || '#222' });

        if (event.backdrop) {
            html.on('hover:focus', function () { setScreenBackdrop(event.backdrop); });
        }

        if (event.kind === 'search') {
            html.on('hover:enter', function () { openSearchInput('', openCustomSearch); });
        } else {
            html.on('hover:enter', function () { openEventResults(event); });
        }

        return html;
    }

    function openEventResults(event) {
        Lampa.Activity.push({
            url: event.id,
            title: event.title,
            component: COMPONENT_NAME,
            page: 1,
            mode: 'event',
            event: event
        });
    }

    function openSearchInput(initial, onSubmit) {
        if (Lampa.Input && typeof Lampa.Input.edit === 'function') {
            Lampa.Input.edit({
                value: initial || '',
                free: true,
                nosave: true
            }, function (newValue) {
                var v = String(newValue || '').trim();
                if (v) onSubmit(v);
            });
        } else {
            var v = window.prompt('Поисковый запрос:', initial || '');
            if (v && v.trim()) onSubmit(v.trim());
        }
    }

    function openCustomSearch(query) {
        var customEvent = {
            id: 'custom_' + Date.now(),
            title: 'Поиск: ' + query,
            short: query,
            queries: [query],
            kind: 'custom',
            color: '#475569',
            freshDays: 0
        };
        Lampa.Activity.push({
            url: 'custom_' + encodeURIComponent(query),
            title: 'Поиск: ' + query,
            component: COMPONENT_NAME,
            page: 1,
            mode: 'event',
            event: customEvent
        });
    }

    function WrestlingComponent(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        var html = $('<div class="wrestling-weekly"></div>');
        var info = $('<div class="wrestling-weekly__info"></div>');
        var loader = $('<div class="wrestling-weekly__loader">Поиск раздач...</div>');
        var lastFocus = null;
        var componentDestroyed = false;

        var self = this;

        this.create = function () {
            scroll.minus();
            html.append(scroll.render());

            if (object.mode === 'event' && object.event) {
                buildModeEvent(object.event);
            } else {
                buildModeList();
            }

            this.activity.loader(false);
            this.activity.toggle();

            return this.render();
        };

        this.render = function () { return html; };

        function firstFocusable() {
            var els = scroll.render().find('.selector');
            return els.length ? els[0] : false;
        }

        function isInDom(el) {
            return el && document.body && document.body.contains(el);
        }

        function refreshController(delay) {
            setTimeout(function () {
                if (!Lampa.Controller.enabled || Lampa.Controller.enabled().name !== 'content') return;

                Lampa.Controller.collectionSet(scroll.render());

                var target = isInDom(lastFocus) ? lastFocus : firstFocusable();
                if (target) {
                    Lampa.Controller.collectionFocus(target, scroll.render());
                    lastFocus = target;
                }
            }, typeof delay === 'number' ? delay : 50);
        }

        this.refreshController = refreshController;

        this.start = function () {
            Lampa.Controller.add('content', {
                link: self,
                invisible: true,
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    var target = isInDom(lastFocus) ? lastFocus : firstFocusable();
                    if (target) {
                        Lampa.Controller.collectionFocus(target, scroll.render());
                        lastFocus = target;
                    }
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    if (Navigator.canmove('down')) Navigator.move('down');
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () {
                    if (Navigator.canmove('right')) Navigator.move('right');
                },
                back: this.back
            });

            Lampa.Controller.toggle('content');
            refreshController();
        };

        this.back = function () { Lampa.Activity.backward(); };
        this.pause = function () { clearScreenBackdrop(); };
        this.stop  = function () { clearScreenBackdrop(); };

        this.destroy = function () {
            componentDestroyed = true;
            if (Lampa.Parser && typeof Lampa.Parser.clear === 'function') Lampa.Parser.clear();
            clearScreenBackdrop();
            scroll.destroy();
            html.remove();
        };

        function trackFocus(el, options) {
            options = options || {};
            el.on('hover:focus', function () {
                lastFocus = el[0];
                if (scroll && typeof scroll.update === 'function') {
                    try { scroll.update(el, true); } catch (e) {}
                }
                if (options.clearBackdrop) clearScreenBackdrop();
            });
        }

        function buildSection(titleText, list) {
            scroll.append($('<div class="wrestling-weekly__section">' + titleText + '</div>'));
            var grid = $('<div class="wrestling-weekly__grid"></div>');
            list.forEach(function (event) {
                var card = buildEventCard(event);
                trackFocus(card);
                grid.append(card);
            });
            scroll.append(grid);
        }

        function buildModeList() {
            buildSection('Еженедельные шоу', WEEKLY);
            buildSection('PPV / PLE и поиск', [PPV_AGGREGATE, SEARCH_TILE]);
            buildSection('Боевые виды спорта', [UFC_AGGREGATE, BKFC_AGGREGATE]);
            buildRecentFeedSection();
            appendAuthorCredit();
        }

        function appendAuthorCredit() {
            var credit = $(
                '<div class="selector wrestling-weekly__credit wrestling-weekly__footer">' +
                    '© 2026 · Автор: Sergey0s · ' + PLUGIN_AUTHOR_LABEL +
                '</div>'
            );
            credit.on('hover:enter', function () {
                if (Lampa.Platform && typeof Lampa.Platform.open === 'function') {
                    Lampa.Platform.open(PLUGIN_AUTHOR_URL);
                } else {
                    try { window.open(PLUGIN_AUTHOR_URL, '_blank'); } catch (e) {}
                }
            });
            trackFocus(credit, { clearBackdrop: true });
            scroll.append(credit);
        }

        function buildRecentFeedSection() {
            var sectionHeader = $('<div class="wrestling-weekly__section">🔥 Свежие раздачи · последние ' + FEED_DAYS + ' дней <span class="wrestling-weekly__section-count"></span></div>');
            sectionHeader.on('mouseenter mouseover focus', clearScreenBackdrop);
            scroll.append(sectionHeader);
            var feedActions = $('<div class="wrestling-weekly__filters"></div>');
            var refreshFeedBtn = $('<div class="selector wrestling-weekly__filter-btn">🔄 Обновить ленту</div>');
            feedActions.append(refreshFeedBtn);
            trackFocus(refreshFeedBtn, { clearBackdrop: true });
            scroll.append(feedActions);
            var feedContainer = $('<div class="wrestling-weekly__list wrestling-weekly__feed"></div>');
            var feedLoader = $('<div class="wrestling-weekly__loader">Загружаю свежие раздачи...</div>');
            feedContainer.append(feedLoader);
            scroll.append(feedContainer);

            var feedNonce = 0;
            var countLabel = sectionHeader.find('.wrestling-weekly__section-count');

            function setCountLabel(text) {
                countLabel.text(text || '');
            }

            function renderFeed(results, opts) {
                opts = opts || {};
                feedContainer.empty();
                if (!results.length) {
                    if (opts.partial) {
                        feedContainer.append(feedLoader);
                        setCountLabel('· ищу…');
                        return;
                    }
                    feedContainer.append($('<div class="empty"><div class="empty__title">За ' + FEED_DAYS + ' дней свежих раздач не нашлось</div></div>'));
                    setCountLabel('· 0');
                    return;
                }

                var suffix = '';
                if (opts.partial && opts.progress) {
                    suffix = ' · ищу ' + opts.progress.finished + '/' + opts.progress.total;
                } else if (opts.stale) {
                    suffix = ' · кэш, обновляю…';
                }
                setCountLabel('· найдено ' + results.length + suffix);

                var feedEvt = { kind: 'feed', title: 'Свежая раздача' };
                var frag = document.createDocumentFragment();
                for (var i = 0; i < results.length; i++) {
                    var row = buildResultRow(results[i], feedEvt);
                    trackFocus(row, { clearBackdrop: true });
                    frag.appendChild(row[0]);
                }
                feedContainer[0].appendChild(frag);
                refreshController(250);
            }

            function runFeedSearch(forceRefresh) {
                var nonce = ++feedNonce;
                if (forceRefresh) {
                    jacRedCache = {};
                    clearFeedStorage();
                    if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show('Лента: кэш очищен, обновляю…');
                }

                // 1) Мгновенно отрисуем последний персистентный результат
                //    (даже stale) — юзер сразу видит контент, а не лоадер.
                var cached = forceRefresh ? null : loadFeedFromStorage();
                if (cached && cached.matches.length) {
                    renderFeed(cached.matches, { stale: !cached.fresh });
                    // Если кэш свежий — фоновый refresh не нужен.
                    if (cached.fresh) return;
                } else {
                    feedContainer.empty();
                    feedContainer.append(feedLoader);
                    setCountLabel('· обновляю…');
                }

                // 2) Стримим новые результаты по мере прихода ответов от JacRed.
                loadRecentFeed(function (results) {
                    if (nonce !== feedNonce || componentDestroyed) return;
                    renderFeed(results);
                    saveFeedToStorage(results);
                }, {
                    isCancelled: function () {
                        return nonce !== feedNonce || componentDestroyed;
                    },
                    onPartial: function (results, meta) {
                        if (nonce !== feedNonce || componentDestroyed) return;
                        if (!results.length) {
                            setCountLabel('· ищу ' + meta.finished + '/' + meta.total);
                            return;
                        }
                        renderFeed(results, { partial: true, progress: meta });
                    }
                });
            }

            refreshFeedBtn.on('hover:enter', function () { runFeedSearch(true); });
            runFeedSearch(false);
        }

        function buildModeEvent(event) {
            var state = getFilterState(event.kind);

            var metaHtml = '<div class="wrestling-weekly__head">' +
                '<div class="wrestling-weekly__meta">' +
                    '<div class="wrestling-weekly__title">' + event.title + '</div>';

            if (event.kind === 'weekly') {
                var lastAir = previousAirDate(event.airDay);
                var nextAir = nextAirDate(event.airDay);
                metaHtml +=
                    '<div>День эфира: <b>' + DAY_NAMES[event.airDay] + '</b></div>' +
                    '<div>Последний эфир: <b>' + formatDate(lastAir) + '</b></div>' +
                    '<div>Следующий эфир: <b>' + formatDate(nextAir) + '</b></div>';
            } else if (event.kind === 'ppv') {
                metaHtml += '<div>Агрегатор PPV/PLE для всех промоушенов (WWE, AEW, TNA)</div>';
            } else if (event.kind === 'custom') {
                metaHtml += '<div>Свободный поиск · запрос: <b>' + (event.queries && event.queries[0] ? event.queries[0] : '') + '</b></div>';
            }

            metaHtml += '</div></div>';
            info.html(metaHtml);
            info.find('.wrestling-weekly__head').css({ borderLeft: '6px solid ' + (event.color || '#444') });

            scroll.append(info);

            var filterRow = $('<div class="wrestling-weekly__filters"></div>');
            var daysBtn = $('<div class="selector wrestling-weekly__filter-btn"></div>');
            var sortBtn = $('<div class="selector wrestling-weekly__filter-btn"></div>');
            var queryBtn = null;
            var refreshBtn = $('<div class="selector wrestling-weekly__filter-btn">🔄 Обновить</div>');

            function refreshLabels() {
                daysBtn.html('<span class="wrestling-weekly__filter-label">Период:</span> ' + labelForDays(state.freshDays));
                sortBtn.html('<span class="wrestling-weekly__filter-label">Сортировка:</span> ' + labelForSort(state.sortBy));
            }
            refreshLabels();

            filterRow.append(daysBtn).append(sortBtn).append(refreshBtn);

            if (event.kind === 'custom') {
                queryBtn = $('<div class="selector wrestling-weekly__filter-btn"></div>');
                queryBtn.html('<span class="wrestling-weekly__filter-label">Запрос:</span> ' + (event.queries[0] || ''));
                filterRow.append(queryBtn);
            }

            trackFocus(daysBtn, { clearBackdrop: true });
            trackFocus(sortBtn, { clearBackdrop: true });
            trackFocus(refreshBtn, { clearBackdrop: true });
            if (queryBtn) trackFocus(queryBtn, { clearBackdrop: true });

            scroll.append(filterRow);

            var stats = $('<div class="wrestling-weekly__stats"></div>');
            scroll.append(stats);

            var listContainer = $('<div class="wrestling-weekly__list"></div>');
            scroll.append(listContainer);

            scroll.append(loader);

            var rawCache = null;
            var sourceStats = null;
            var searchNonce = 0;

            var RENDER_LIMIT = 200;

            function rerender() {
                if (!rawCache) return;
                var filtered = filterEventResults(rawCache, event, state);

                var statsHtml = 'Найдено по фильтру: <b>' + filtered.length + '</b> · всего от парсера: <b>' + rawCache.length + '</b>';
                if (sourceStats && sourceStats.length) {
                    sourceStats.sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
                    var parts = [];
                    for (var si = 0; si < sourceStats.length; si++) {
                        var src = sourceStats[si];
                        parts.push(src.host + ' <b>' + (src.count || 0) + '</b>');
                    }
                    statsHtml += ' · Источник: ' + parts.join(' · ');
                }
                if (filtered.length > RENDER_LIMIT) {
                    statsHtml += ' · показано первые <b>' + RENDER_LIMIT + '</b> (сузьте фильтр)';
                }
                stats.html(statsHtml);

                listContainer.empty();

                var listToShow = filtered;
                if (!filtered.length && state.freshDays > 0) {
                    listContainer.append($('<div class="empty"><div class="empty__title">За выбранный период совпадений нет</div></div>'));
                    return;
                }
                if (!filtered.length) {
                    listContainer.append($('<div class="empty"><div class="empty__title">Точных совпадений нет. Показываю все результаты парсера:</div></div>'));
                    listToShow = rawCache.slice().sort(function (a, b) { return (b.Seeders || 0) - (a.Seeders || 0); });
                }

                if (!listToShow.length) {
                    listContainer.append($('<div class="empty"><div class="empty__title">Парсер ничего не вернул</div></div>'));
                    return;
                }

                var frag = document.createDocumentFragment();
                var limit = Math.min(listToShow.length, RENDER_LIMIT);
                for (var i = 0; i < limit; i++) {
                    var row = buildResultRow(listToShow[i], event);
                    trackFocus(row, { clearBackdrop: true });
                    frag.appendChild(row[0]);
                }
                listContainer[0].appendChild(frag);

                refreshController();
            }

            daysBtn.on('hover:enter', function () {
                Lampa.Select.show({
                    title: 'Период поиска',
                    items: FILTER_DAYS_OPTIONS.map(function (o) { return { title: o.title, value: o.value, selected: o.value === state.freshDays }; }),
                    onBack: function () { Lampa.Controller.toggle('content'); },
                    onSelect: function (item) {
                        state.freshDays = item.value;
                        saveFilterState(event.kind, state);
                        refreshLabels();
                        Lampa.Controller.toggle('content');
                        rerender();
                    }
                });
            });

            sortBtn.on('hover:enter', function () {
                Lampa.Select.show({
                    title: 'Сортировка',
                    items: SORT_OPTIONS.map(function (o) { return { title: o.title, value: o.value, selected: o.value === state.sortBy }; }),
                    onBack: function () { Lampa.Controller.toggle('content'); },
                    onSelect: function (item) {
                        state.sortBy = item.value;
                        saveFilterState(event.kind, state);
                        refreshLabels();
                        Lampa.Controller.toggle('content');
                        rerender();
                    }
                });
            });

            if (queryBtn) {
                queryBtn.on('hover:enter', function () {
                    openSearchInput(event.queries[0] || '', function (newQuery) {
                        openCustomSearch(newQuery);
                    });
                });
            }

            function runSearch(forceRefresh) {
                var nonce = ++searchNonce;
                if (forceRefresh) {
                    jacRedCache = {};
                    if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show('Кэш очищен, обновляю…');
                }
                loader.show();
                stats.html('Обновляю выдачу…');
                listContainer.empty();
                searchTorrents(event, function (raw, meta) {
                    if (nonce !== searchNonce || componentDestroyed) return;
                    loader.hide();
                    rawCache = raw;
                    sourceStats = (meta && meta.sources) ? meta.sources.slice() : null;
                    rerender();
                }, function (err) {
                    if (nonce !== searchNonce || componentDestroyed) return;
                    loader.hide();
                    listContainer.empty();
                    listContainer.append($('<div class="empty"><div class="empty__title">' + err + '</div></div>'));
                });
            }

            refreshBtn.on('hover:enter', function () { runSearch(true); });
            runSearch(false);
        }

        function buildResultRow(result, event) {
            var seeders = result.Seeders || 0;
            var peers = result.Peers || 0;
            var size = formatBytes(result.Size || result.size);
            var tracker = result.Tracker || result.TrackerId || '';

            var dateLabel;
            if (result._effectiveDate) {
                var prefix = result._dateSource === 'episode' ? 'Эфир' : 'Залит';
                dateLabel = prefix + ': ' + formatDate(result._effectiveDate);
            } else {
                dateLabel = '— нет даты —';
            }

            var row = $(
                '<div class="online selector wrestling-weekly__item">' +
                    '<div class="online__title">' + (result.Title || '') + '</div>' +
                    '<div class="online__details">' +
                        '<span class="wrestling-weekly__pill wrestling-weekly__pill--date">' + dateLabel + '</span>' +
                        '<span class="wrestling-weekly__pill">' + size + '</span>' +
                        '<span class="wrestling-weekly__pill">S ' + seeders + ' / L ' + peers + '</span>' +
                        '<span class="wrestling-weekly__pill">' + tracker + '</span>' +
                    '</div>' +
                '</div>'
            );

            row.on('hover:enter', function () { playTorrent(result, event); });
            return row;
        }
    }

    function openMainScreen() {
        Lampa.Activity.push({
            url: '',
            title: PLUGIN_NAME,
            component: COMPONENT_NAME,
            page: 1,
            mode: 'list'
        });
    }

    function addMenuButton() {
        if ($('.menu .menu__item[data-action="' + PLUGIN_ID + '"]').length) return;

        var menuItem = $(
            '<li class="menu__item selector" data-action="' + PLUGIN_ID + '">' +
                '<div class="menu__ico">' +
                    '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                        '<path d="M6 3l3 3-3 3-3-3 3-3zm12 0l3 3-3 3-3-3 3-3zM12 9l3 3-3 3-3-3 3-3zm-6 6l3 3-3 3-3-3 3-3zm12 0l3 3-3 3-3-3 3-3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="menu__text">' + PLUGIN_NAME + ' <span class="wrestling-weekly__menu-ver">v' + PLUGIN_VERSION + '</span></div>' +
            '</li>'
        );

        menuItem.on('hover:enter', function () { openMainScreen(); });
        $('.menu .menu__list').eq(0).append(menuItem);
    }

    function addStyles() {
        var css = (
            '.wrestling-weekly{padding:1.5em;padding-bottom:7rem}' +
            '.wrestling-weekly__section{margin:1.2em 0 .8em;font-size:1.4em;font-weight:bold;padding-left:.2em}' +
            '.wrestling-weekly__grid{display:flex;flex-wrap:wrap;gap:1em;margin-bottom:1em}' +
            '.wrestling-weekly__tile{position:relative;width:18em;height:11em;border-radius:.8em;padding:1em;display:flex;align-items:center;justify-content:center;text-align:center;color:#fff;cursor:pointer;overflow:hidden;transition:transform .15s ease}' +
            '.wrestling-weekly__tile.focus{outline:.25em solid #fff;transform:scale(1.04);box-shadow:0 6px 24px rgba(0,0,0,.5);z-index:2}' +
            '.wrestling-weekly__tile-img{position:absolute;left:.8em;right:.8em;top:.8em;height:6.4em;background-color:#fff;border-radius:.5em;background-size:contain;background-position:center;background-repeat:no-repeat;background-origin:content-box;padding:.4em;box-shadow:0 2px 8px rgba(0,0,0,.35);z-index:1}' +
            '.wrestling-weekly__tile-emoji{position:absolute;top:1.4em;left:50%;transform:translateX(-50%);font-size:3.6em;opacity:.9;pointer-events:none;z-index:1}' +
            '.wrestling-weekly__tile--with-img .wrestling-weekly__tile-name,' +
            '.wrestling-weekly__tile--with-emoji .wrestling-weekly__tile-name{position:absolute;left:.6em;right:.6em;bottom:.6em;font-size:1em;text-align:center;text-shadow:0 2px 6px rgba(0,0,0,.7);z-index:2}' +
            '.wrestling-weekly__tile-name{font-size:1.4em;font-weight:bold;text-shadow:0 2px 6px rgba(0,0,0,.7);line-height:1.2;position:relative;z-index:2}' +
            '.wrestling-weekly__head{display:flex;gap:1.5em;align-items:center;margin-bottom:1em;padding:1em 1.2em;background:rgba(255,255,255,0.04);border-radius:1em}' +
            '.wrestling-weekly__title{font-size:1.4em;font-weight:bold;margin-bottom:.5em}' +
            '.wrestling-weekly__meta{font-size:1em;line-height:1.6}' +
            '.wrestling-weekly__loader{padding:1.5em;font-size:1.1em;opacity:.7}' +
            '.wrestling-weekly__stats{padding:.6em 1em;margin:.4em 0 .8em;font-size:.95em;background:rgba(255,255,255,0.04);border-radius:.5em;opacity:.85}' +
            '.wrestling-weekly__item{padding:1em;margin-bottom:.5em;background:rgba(255,255,255,0.04);border-radius:.6em}' +
            '.wrestling-weekly__item.focus{background:#fff;color:#000}' +
            '.wrestling-weekly__pill{display:inline-block;margin-right:.6em;padding:.2em .6em;border-radius:.4em;background:rgba(255,255,255,0.08);font-size:.9em}' +
            '.wrestling-weekly__pill--date{background:rgba(46,160,67,.25);font-weight:bold}' +
            '.wrestling-weekly__menu-ver{margin-left:.4em;font-size:.7em;opacity:.5;font-weight:normal}' +
            '.wrestling-weekly__item.focus .wrestling-weekly__pill--date{background:rgba(46,160,67,.4)}' +
            '.wrestling-weekly__item.focus .wrestling-weekly__pill{background:rgba(0,0,0,0.1)}' +
            '.wrestling-weekly__refine{display:inline-block;padding:.6em 1.2em;margin:0 0 .8em;border-radius:.5em;background:rgba(124,58,237,.25);font-size:1em;cursor:pointer}' +
            '.wrestling-weekly__refine.focus{background:#fff;color:#000}' +
            '.wrestling-weekly__filters{display:flex;flex-wrap:wrap;gap:.6em;margin:0 0 .8em}' +
            '.wrestling-weekly__filter-btn{padding:.55em 1em;border-radius:.5em;background:rgba(255,255,255,.06);font-size:.95em;cursor:pointer;display:inline-flex;align-items:center;gap:.4em}' +
            '.wrestling-weekly__filter-btn.focus{background:#fff;color:#000}' +
            '.wrestling-weekly__filter-label{opacity:.55;font-size:.85em}' +
            '.wrestling-weekly__filter-btn.focus .wrestling-weekly__filter-label{opacity:.7}' +
            '.wrestling-weekly__feed{margin-top:.4em}' +
            '.wrestling-weekly__credit{padding:.75em 1em;font-size:1.05em;opacity:.75;line-height:1.35;border-radius:.5em;background:rgba(255,255,255,.08);border-left:4px solid rgba(139,92,246,.8);box-sizing:border-box;min-height:4.25em;display:flex;align-items:center}' +
            '.wrestling-weekly__credit.wrestling-weekly__footer{margin-top:2em;margin-bottom:6rem;padding-top:1.1em;padding-bottom:1.1em}' +
            '.wrestling-weekly__credit.focus{opacity:1;background:rgba(255,255,255,.14)}' +
            '#wrestling-screen-bg{position:fixed;inset:0;background-size:cover;background-position:center;background-repeat:no-repeat;opacity:0;transition:opacity .35s ease,background-image .35s ease;pointer-events:none;z-index:0;filter:blur(2px) saturate(1.05)}' +
            '#wrestling-screen-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,.7) 60%,rgba(0,0,0,.85) 100%)}'
        );
        $('<style>' + css + '</style>').appendTo('head');
    }

    function startPlugin() {
        Lampa.Component.add(COMPONENT_NAME, WrestlingComponent);

        Lampa.Manifest.plugins = {
            type: 'video',
            version: PLUGIN_VERSION,
            name: PLUGIN_NAME,
            description: '© 2026 · Поиск свежих выпусков WWE Raw, SmackDown, AEW, TNA и PPV/PLE через встроенный парсер Lampa. Автор: Sergey0s · ' + PLUGIN_AUTHOR_LABEL,
            component: COMPONENT_NAME
        };

        addStyles();
        attachLifecycleCleanup();
        exposeDebugApi();

        if (window.appready) {
            addMenuButton();
        } else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') addMenuButton();
            });
        }
    }

    function attachLifecycleCleanup() {
        try {
            window.addEventListener('pagehide', function () { cleanupRuntime('pagehide'); });
            document.addEventListener('visibilitychange', function () {
                if (document.hidden) cleanupRuntime('hidden');
            });
        } catch (e) {}
    }

    function exposeDebugApi() {
        window.wr = {
            version: PLUGIN_VERSION,
            cleanup: function () {
                cleanupRuntime('manual');
                return window.wr.state();
            },
            clearFeedCache: function () {
                clearFeedStorage();
                jacRedCache = {};
                return 'wr feed cache cleared';
            },
            feedCache: function () {
                var c = loadFeedFromStorage();
                if (!c) return null;
                return {
                    fresh: c.fresh,
                    age_sec: Math.round((Date.now() - c.ts) / 1000),
                    count: c.matches.length,
                    version: c.version
                };
            },
            state: function () {
                return {
                    version: PLUGIN_VERSION,
                    cache_keys: Object.keys(jacRedCache).length,
                    feed_cache: window.wr.feedCache(),
                    active_requests: activeRequests.length,
                    active_player_log: !!activePlayerLog,
                    cleanups: cleanupCount,
                    last_cleanup_reason: lastCleanupReason,
                    memory: memorySnapshot()
                };
            }
        };
    }

    if (window.Lampa && window.Lampa.Component) {
        startPlugin();
    } else {
        var waiter = setInterval(function () {
            if (window.Lampa && window.Lampa.Component) {
                clearInterval(waiter);
                startPlugin();
            }
        }, 200);
    }
})();
