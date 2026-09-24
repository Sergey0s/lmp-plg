/*!
 * © 2026 · Автор: Sergey0s
 */
(function () {
    'use strict';

    if (window.wrestling_weekly_plugin) return;
    window.wrestling_weekly_plugin = true;

    var PLUGIN_ID = 'wrestling_weekly';
    var PLUGIN_VERSION = '2.10.2';
    var PLUGIN_NAME = 'Рестлинг';
    var COMPONENT_NAME = 'wrestling_weekly';
    var PLUGIN_AUTHOR_LABEL = 'github.com/Sergey0s';
    var PLUGIN_AUTHOR_URL = 'https://' + PLUGIN_AUTHOR_LABEL;

    var WEEKLY = [
        { id: 'wwe_raw',        title: 'WWE Monday Night Raw',       short: 'WWE Raw',       queries: ['WWE Raw', 'WWE Monday Night Raw'], airDay: 1, kind: 'weekly', promotion: 'WWE' },
        { id: 'wwe_smackdown',  title: 'WWE Friday Night SmackDown', short: 'WWE SmackDown', queries: ['WWE SmackDown', 'WWE Friday Night SmackDown'], airDay: 5, kind: 'weekly', promotion: 'WWE' },
        { id: 'aew_dynamite',   title: 'AEW Dynamite',               short: 'AEW Dynamite',  queries: ['AEW Dynamite', 'All Elite Wrestling Dynamite'], airDay: 3, kind: 'weekly', promotion: 'AEW' },
        { id: 'aew_collision',  title: 'AEW Collision',              short: 'AEW Collision', queries: ['AEW Collision', 'All Elite Wrestling Collision'], airDay: 6, kind: 'weekly', promotion: 'AEW' },
        { id: 'tna_impact',     title: 'TNA iMPACT! Wrestling',      short: 'TNA Impact',    queries: ['TNA Impact', 'TNA iMPACT Wrestling', 'Impact Wrestling'], airDay: 4, kind: 'weekly', promotion: 'TNA' }
    ];

    // Название организации в заголовке — единственный надёжный признак, что
    // раздача вообще про рестлинг. Без него «Sacrifice» и «Revolution» тянут
    // 500+ фильмов с тем же названием.
    var PROMOTION_KEYWORDS = [
        'wwe', 'wwf', 'wcw', 'ecw', 'nxt',
        'world wrestling entertainment',
        'aew', 'all elite wrestling',
        'tna', 'impact wrestling',
        'njpw', 'new japan',
        'roh', 'ring of honor',
        'aaa', 'lucha libre', 'cmll', 'gcw', 'mlw', 'stardom',
        'wrestling', 'рестлинг', 'реслинг'
    ];

    // Названия, выдуманные самим рестлингом: вне его не встречаются, поэтому
    // организация рядом не обязательна.
    var PPV_UNIQUE_KEYWORDS = [
        'wrestlemania', 'royal rumble', 'summerslam', 'survivor series',
        'money in the bank', 'elimination chamber', 'crown jewel',
        'night of champions', 'hell in a cell', 'extreme rules',
        'king of the ring', 'queen of the ring', 'no way out', 'cyber sunday',
        'saturday night main event', 'saturday night s main event', 'snme',
        'bash in berlin', 'clash in italy', 'clash in paris',
        'double or nothing', 'full gear', 'wrestledream', 'forbidden door',
        'blood and guts', 'beach break',
        'slammiversary', 'bound for glory', 'destination x',
        'halloween havoc', 'great american bash', 'triplemania',
        'wrestlepalooza',
        'wwe ppv', 'wwe ple', 'aew ppv', 'tna ppv'
    ];

    // Обычные слова, которые организация обязана сопровождать.
    var PPV_AMBIGUOUS_KEYWORDS = [
        'backlash', 'bad blood', 'clash at', 'clash in',
        'battleground', 'payback', 'tlc', 'fastlane', 'no mercy',
        'vengeance', 'armageddon', 'judgment day',
        'evolution', 'revolution', 'worlds collide', 'worlds end',
        'all in', 'all out', 'dynasty', 'grand slam',
        'hard to kill', 'rebellion', 'genesis', 'victory road',
        'no surrender', 'against all odds', 'sacrifice',
        'turning point', 'final resolution', 'lockdown', 'emergence'
    ];

    // Запрос обязан быть ровно настолько же узким, насколько узок предикат.
    // Неоднозначное название мы всё равно примем только вместе с организацией
    // в заголовке, поэтому и спрашивать его надо вместе с ней: голый «All Out»
    // тянет 792 КБ фильмов, «AEW All Out» — 15 КБ и тот же рестлинг.
    // Уникальные названия («WrestleMania») предикат принимает без организации,
    // так что их спрашиваем как есть, иначе потеряем раздачи без префикса.
    // Широких «WWE» / «AEW» здесь нет намеренно: JacRed режет совпавшие ключи
    // до чтения, срез не связан с датой, и замер дал 308 КБ ради одной свежей
    // строки и 290 КБ ради нуля — при этом они роняли всю плитку по таймауту.
    var PPV_AGGREGATE_QUERIES = [
        // Уникальные названия — без префикса.
        'WrestleMania', 'Royal Rumble', 'SummerSlam', 'Survivor Series',
        'Money in the Bank', 'Elimination Chamber', 'Crown Jewel',
        'Night of Champions', 'Extreme Rules', 'Hell in a Cell',
        'King of the Ring', 'Queen of the Ring', 'Wrestlepalooza',
        'Clash in Italy', 'Clash in Paris', 'Bash in Berlin',
        'Halloween Havoc', 'Great American Bash', 'Worlds Collide',
        'Double or Nothing', 'Full Gear', 'Forbidden Door', 'WrestleDream',
        'Bound for Glory', 'Slammiversary', 'AAA TripleMania',
        // Неоднозначные — только с организацией.
        'WWE Backlash', 'WWE Bad Blood', 'WWE Battleground', 'WWE Payback',
        'WWE Fastlane', 'WWE No Mercy', 'WWE Evolution',
        'AEW All In', 'AEW All Out', 'AEW Revolution', 'AEW Dynasty',
        'AEW Worlds End',
        'TNA Hard to Kill', 'TNA Sacrifice', 'TNA Turning Point',
        'TNA Final Resolution'
    ];

    var PPV_EXCLUDE = ['raw', 'smackdown', 'dynamite', 'collision', 'impact', 'nxt', 'main event'];

    var SEARCH_TILE = {
        id: 'free_search',
        title: 'Свободный поиск',
        short: 'Поиск',
        kind: 'search'
    };

    // JacRed отсекает совпавшие ключи базы по maxreadfile (200) ДО чтения,
    // поэтому широкий запрос «UFC» возвращает произвольный срез и до свежих
    // турниров не доходит. Префикс номера сужает выборку до одного десятка
    // событий и отдаёт его целиком: «UFC 33» → 330-339, «UFC Fight Night 28»
    // → 280-289. Десяток вычисляем от опорной точки, иначе список протухнет.
    function numberedEventQueries(prefix, anchorNumber, anchorYear, anchorMonth, perYear) {
        var now = new Date();
        var months = (now.getFullYear() - anchorYear) * 12 + (now.getMonth() - anchorMonth);
        var current = anchorNumber + Math.round(months * perYear / 12);
        var decade = Math.floor(Math.max(current, 0) / 10);
        return [prefix + decade, prefix + (decade + 1)];
    }

    var UFC_NUMBERED_QUERIES = numberedEventQueries('UFC ', 331, 2026, 8, 13)
        .concat(numberedEventQueries('UFC Fight Night ', 288, 2026, 8, 45));

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
            ambiguousKeywords: config.ambiguousKeywords || [],
            promotionKeywords: config.promotions || [],
            excludeKeywords: config.exclude || [],
            kind: 'ppv',
            promotion: config.promotion,
            freshDays: config.freshDays
        };
    }

    var PPV_AGGREGATE = makeAggregator({
        id: 'ppv_all', title: 'PPV / PLE ивенты', short: 'PPV / PLE', promotion: 'PPV',
        queries: PPV_AGGREGATE_QUERIES,
        keywords: PPV_UNIQUE_KEYWORDS,
        ambiguousKeywords: PPV_AMBIGUOUS_KEYWORDS,
        promotions: PROMOTION_KEYWORDS,
        exclude: PPV_EXCLUDE,
        freshDays: 90
    });

    var UFC_AGGREGATE = makeAggregator({
        id: 'ufc_all', title: 'UFC турниры', short: 'UFC', promotion: 'UFC',
        queries: ['UFC', 'UFC Fight Night', 'UFC on ESPN', 'UFC on ABC'].concat(UFC_NUMBERED_QUERIES),
        keywords: ['ufc', 'ultimate fighting championship'],
        freshDays: 90
    });

    var BKFC_AGGREGATE = makeAggregator({
        id: 'bkfc_all', title: 'BKFC турниры', short: 'BKFC', promotion: 'BKFC',
        queries: ['BKFC', 'Bare Knuckle Fighting Championship', 'Bare Knuckle FC'],
        keywords: ['bkfc', 'bare knuckle fighting championship', 'bare knuckle'],
        freshDays: 180
    });

    var AGGREGATE_TILES = [PPV_AGGREGATE, UFC_AGGREGATE, BKFC_AGGREGATE];

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
    // Лента объединяет запросы всех плиток — сейчас это 82 уникальных запроса,
    // то есть 17 раундов по concurrency 5. Ждать их целиком никто не должен:
    // первый экран рисуется из персистентного кэша, а результаты дорисовываются
    // по мере прихода ответов. Timeout держим низким, чтобы медленные
    // JacRed-серверы падали быстро, а не удерживали раунд.
    // Пять параллельных ответов по 250 КБ — это шторм и для роутера, и для
    // JacRed, который на такое отвечает отказами всему IP. Лента рисуется
    // по мере поступления, так что меньшая параллельность почти не заметна.
    var FEED_SEARCH_CONCURRENCY = 3;
    // PPV-агрегатор теперь делает 20+ запросов — concurrency 4 даёт разумный
    // компромисс между скоростью и нагрузкой на Jackett/роутер.
    var EVENT_QUERY_CONCURRENCY = 4;
    // Живой JacRed отвечает за секунду-две. Всё, что тянется дольше, почти
    // всегда не ответит вовсе, а мы держим соединение и заставляем ждать.
    // Лучше быстро признать отказ и показать то, что уже нашлось.
    var JACRED_REQUEST_TIMEOUT_MS = 7000;
    var FEED_REQUEST_TIMEOUT_MS = 12000;
    var BULK_QUERY_THRESHOLD = 4;
    var JACRED_MAX_INFLIGHT = 3;
    var JACRED_FAILURE_LIMIT = 4;
    var JACRED_COOLDOWN_MS = 60000;
    // Пауза после 429 нужна, чтобы не долбить хост, но она наказывает и нас:
    // пока она висит, плагин пуст. Минуты хватает, чтобы разорвать серию,
    // а час превращал временный отказ в мёртвый вечер.
    var JACRED_THROTTLE_COOLDOWN_MS = 60 * 1000;
    var JACRED_THROTTLE_COOLDOWN_MAX_MS = 10 * 60 * 1000;
    var JACRED_THROTTLE_KEY = 'wrestling_jacred_throttle';
    var JACRED_MIN_SPACING_MS = 400;
    // Шоу без своей плитки. Как и у плиток, отбор идёт по собственным
    // запросам: в заголовке должны быть все слова запроса.
    var FEED_EXTRA_QUERIES = [
        'WWE NXT', 'WWE Main Event', 'WWE PPV', 'AEW PPV', 'TNA PPV',
        'WWE Saturday Night Main Event', 'WWE Worlds Collide',
        'WWE Halloween Havoc', 'WWE Great American Bash',
        'AEW Rampage', 'ROH Wrestling', 'TNA Xplosion',
        'WCW Nitro', 'WWF WWE',
        'NJPW', 'Ring of Honor'
    ];

    var FEED_EXTRA_SOURCE = {
        id: 'feed_extra',
        title: 'Прочие шоу',
        queries: FEED_EXTRA_QUERIES,
        kind: 'feed'
    };

    // Единственный источник правды и для плиток, и для ленты: лента показывает
    // ровно то, что приняла бы хоть одна плитка. Раньше у ленты был свой
    // список ключей, он разъехался с плитками — UFC пропадал из ленты, а кино
    // со словом Sacrifice в неё попадало.
    var FEED_SOURCES = WEEKLY.concat(AGGREGATE_TILES, [FEED_EXTRA_SOURCE]);

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

    // Ключ должен начинаться на границе слова, иначе «tlc» ловит «atlco», а
    // «aaa» — любой релиз-групп. \b тут не годится: в JS он не видит кириллицу
    // («рестлинг» рядом с пробелом границей не считается). Цифру справа
    // пропускаем ради «WrestleMania41», букву — нет, иначе «Revolutions».
    function keywordsRegex(list) {
        var parts = [];
        for (var i = 0; i < (list || []).length; i++) {
            var norm = normalizeText(list[i]);
            if (norm) parts.push(escapeRegExp(norm));
        }
        if (!parts.length) return null;
        return new RegExp('(^| )(?:' + parts.join('|') + ')(?![a-zа-яё])');
    }

    function queryMatchesTitle(tNorm, queryTokens) {
        if (!queryTokens.length) return false;
        for (var i = 0; i < queryTokens.length; i++) {
            if (!tokenRegex(queryTokens[i]).test(tNorm)) return false;
        }
        return true;
    }

    // Схему по умолчанию берём https: Lampa на телевизоре открыта по https,
    // и http-запрос из неё движок режет как смешанный контент — при том что
    // тот же адрес прекрасно отвечает curl'у с ноутбука. Локальный Jackett по
    // IP или имени в домашней сети https обычно не умеет, ему оставляем http.
    function defaultScheme(host) {
        if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)) return 'http://';
        if (/(^|\.)local(:\d+)?$/.test(host) || host.indexOf('.') === -1) return 'http://';
        return 'https://';
    }

    function normalizeJackettUrl(raw) {
        var url = String(raw || '').trim().replace(/\/+$/, '');
        if (!url) return '';
        if (!/^https?:\/\//i.test(url)) url = defaultScheme(url.toLowerCase()) + url;
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

    function canonicalTorrentKey(row) {
        row = row || {};
        var magnet = row.MagnetUri || row.magnet || '';
        var hash = String(row.hash || magnetToHash(magnet) || '').toLowerCase();
        if (hash) return 'hash:' + hash;
        if (magnet) return 'magnet:' + magnet;
        if (row.Link) return 'link:' + row.Link;
        return 'title:' + String(row.Title || row.title || '') + '|size:' + String(row.Size || row.size || '');
    }

    function wrLog() {
        if (!window.console || !console.log) return;
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[WR]');
        try { console.log.apply(console, args); } catch (e) {}
    }

    var JACRED_CACHE_TTL = 5 * 60 * 1000;
    // Лента гоняет 82 запроса за проход: кэш меньше этого числа вытесняет сам
    // себя и не спасает ни одного повторного открытия.
    var JACRED_CACHE_MAX = 200;
    var activePlayerLog = null;
    var cleanupCount = 0;
    var lastCleanupReason = '';

    // Персистентный кэш «свежих раздач» в Lampa.Storage — при следующем
    // открытии плагина показываем последний результат МГНОВЕННО, а
    // фоновое обновление подменяет результат когда придёт. Без этого
    // юзер каждый раз смотрит «Загружаю свежие раздачи...» 5-15 секунд
    // пока 24 JacRed-запроса не отработают.
    // Ключ версионирован: при смене правил отбора старый кэш надо выбросить,
    // иначе лента ещё 6 часов показывает то, что новые правила уже не пускают.
    var FEED_PERSIST_KEY = 'wrestling_feed_cache_v2';
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

    // Провалившийся обход раньше сохранялся как пустая лента, а пустая лента
    // на следующем входе заставляла обойти всё заново. Получался замкнутый
    // круг: источник отказывает — мы бьём по нему ещё восемьдесят раз.
    var FEED_FAIL_KEY = 'wrestling_feed_failed_at';
    var FEED_RETRY_COOLDOWN_MS = 10 * 60 * 1000;

    function noteFeedFailure() {
        try { Lampa.Storage.set(FEED_FAIL_KEY, Date.now()); } catch (e) {}
    }

    function clearFeedFailure() {
        try { Lampa.Storage.set(FEED_FAIL_KEY, 0); } catch (e) {}
    }

    function feedRetryBlocked() {
        try {
            var at = Lampa.Storage.get(FEED_FAIL_KEY, 0) || 0;
            return (Date.now() - at) < FEED_RETRY_COOLDOWN_MS;
        } catch (e) {
            return false;
        }
    }

    function clearFeedStorage() {
        try { Lampa.Storage.set(FEED_PERSIST_KEY, null); } catch (e) {}
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
        jacRedAccess.prune();
        jacRedAccess.abortActive();
        cleanupCount++;
        lastCleanupReason = reason || 'manual';
        wrLog('cleanup', lastCleanupReason, 'cache=' + jacRedAccess.cacheSize(), 'mem=', memorySnapshot());
    }

    /*
     * Deep module for one JacRed query.
     *
     * Interface: search(query), invalidate(), prune(), abortActive().
     * Implementation owns config, URL, timeout, cache, HTTP, row mapping
     * and multi-host merge. Host merge uses the same canonicalTorrentKey
     * as the query orchestrator.
     */
    // --- Журнал запросов -------------------------------------------------
    // Пишем адрес, схему, запрос и исход. Ключ парсера сюда не попадает
    // никогда: журнал уходит наружу фотографией, а ключ — секрет.
    var REQUEST_LOG_KEY = 'wrestling_request_log';
    var REQUEST_LOG_MAX = 300;
    var REQUEST_LOG_FLUSH_EVERY = 20;

    function createRequestLog(deps) {
        deps = deps || {};
        var nowFn = deps.now || function () { return Date.now(); };
        var max = typeof deps.max === 'number' ? deps.max : REQUEST_LOG_MAX;
        var flushEvery = typeof deps.flushEvery === 'number' ? deps.flushEvery : REQUEST_LOG_FLUSH_EVERY;
        var readStore = deps.read || function () { return null; };
        var writeStore = deps.write || function () {};
        var rows = [];
        var sinceFlush = 0;

        var saved = readStore();
        if (saved && Array.isArray(saved.rows)) rows = saved.rows.slice(-max);

        function flush() {
            sinceFlush = 0;
            writeStore({ version: PLUGIN_VERSION, rows: rows });
        }

        function record(entry) {
            rows.push(entry);
            if (rows.length > max) rows.splice(0, rows.length - max);
            if (++sinceFlush >= flushEvery) flush();
            return entry;
        }

        // Возвращаем «закрывашку»: длительность меряем здесь, а не на месте
        // вызова, иначе каждый вызывающий будет считать её по-своему.
        // gap — пауза с прошлого запроса: без неё нельзя проверить, что
        // разнесение по времени действительно работает, а не только задумано.
        var lastStart = 0;
        var whoNow = '';

        function who(label) { whoNow = label || ''; }

        function start(src, host, scheme, query) {
            var at = nowFn();
            var gap = lastStart ? at - lastStart : 0;
            lastStart = at;
            var by = whoNow;
            return function (outcome, extra) {
                extra = extra || {};
                record({
                    t: at, src: src, host: host, scheme: scheme, q: query,
                    by: by, gap: gap,
                    out: outcome, ms: nowFn() - at,
                    n: extra.rows || 0, st: String(extra.status || '')
                });
            };
        }

        function summary() {
            var byOutcome = {};
            var byHost = {};
            var errors = {};
            var slowest = null;
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i];
                byOutcome[r.out] = (byOutcome[r.out] || 0) + 1;
                var key = r.scheme + r.host;
                var h = byHost[key] || (byHost[key] = { host: key, ok: 0, fail: 0, other: 0, maxMs: 0 });
                if (r.out === 'ok') h.ok++;
                else if (r.out === 'fail') h.fail++;
                else h.other++;
                if (r.ms > h.maxMs) h.maxMs = r.ms;
                if (r.out === 'fail' && r.st) errors[r.st] = (errors[r.st] || 0) + 1;
                if (!slowest || r.ms > slowest.ms) slowest = r;
            }
            var hosts = [];
            for (var k in byHost) if (Object.prototype.hasOwnProperty.call(byHost, k)) hosts.push(byHost[k]);
            var errList = [];
            for (var e in errors) if (Object.prototype.hasOwnProperty.call(errors, e)) errList.push({ text: e, count: errors[e] });
            errList.sort(function (a, b) { return b.count - a.count; });
            return {
                total: rows.length,
                from: rows.length ? rows[0].t : 0,
                to: rows.length ? rows[rows.length - 1].t : 0,
                outcomes: byOutcome,
                hosts: hosts,
                errors: errList.slice(0, 5),
                slowest: slowest
            };
        }

        function clear() {
            rows = [];
            flush();
        }

        return {
            start: start,
            who: who,
            record: record,
            entries: function () { return rows.slice(); },
            summary: summary,
            flush: flush,
            clear: clear
        };
    }

    var requestLog = createRequestLog({
        read: function () {
            try { return Lampa.Storage.get(REQUEST_LOG_KEY, null); } catch (e) { return null; }
        },
        write: function (payload) {
            try { Lampa.Storage.set(REQUEST_LOG_KEY, payload); } catch (e) {}
        }
    });

    function createJacRedAccess(deps) {
        deps = deps || {};
        var getConfigs = deps.getConfigs;
        var createRequest = deps.createRequest;
        var nowFn = deps.now || function () { return Date.now(); };
        var timeoutMs = typeof deps.timeoutMs === 'number' ? deps.timeoutMs : JACRED_REQUEST_TIMEOUT_MS;
        var cacheTtl = typeof deps.cacheTtl === 'number' ? deps.cacheTtl : JACRED_CACHE_TTL;
        var cacheMax = typeof deps.cacheMax === 'number' ? deps.cacheMax : JACRED_CACHE_MAX;
        var failureLimit = typeof deps.failureLimit === 'number' ? deps.failureLimit : JACRED_FAILURE_LIMIT;
        var cooldownMs = typeof deps.cooldownMs === 'number' ? deps.cooldownMs : JACRED_COOLDOWN_MS;
        var throttleCooldownMs = typeof deps.throttleCooldownMs === 'number' ? deps.throttleCooldownMs : JACRED_THROTTLE_COOLDOWN_MS;
        var throttleCooldownMaxMs = typeof deps.throttleCooldownMaxMs === 'number' ? deps.throttleCooldownMaxMs : JACRED_THROTTLE_COOLDOWN_MAX_MS;
        var maxInflight = typeof deps.maxInflight === 'number' ? deps.maxInflight : JACRED_MAX_INFLIGHT;
        var cache = {};
        var active = [];
        var failures = {};
        // Остывание и счётчик 429 переживают перезапуск приложения: лимит
        // живёт на сервере, а не у нас, и забывать его при каждом открытии
        // плагина — значит каждый раз платить новым 429 и продлевать запрет.
        var readThrottle = deps.readThrottle || function () { return null; };
        var writeThrottle = deps.writeThrottle || function () {};
        var restored = readThrottle() || {};
        var blockedUntil = restored.until || {};
        var throttleStrikes = restored.strikes || {};

        function persistThrottle() {
            writeThrottle({ until: blockedUntil, strikes: throttleStrikes });
        }
        var minSpacingMs = typeof deps.minSpacingMs === 'number' ? deps.minSpacingMs : JACRED_MIN_SPACING_MS;
        var delay = deps.delay || function (ms, fn) { setTimeout(fn, ms); };
        var inflight = 0;
        var waiting = [];
        var nextAllowedAt = 0;
        var wakePending = false;
        var log = deps.log || { start: function () { return function () {}; } };

        // Параллельность раньше ограничивала каждая пачка отдельно, а хост
        // видит их сумму: лента, открытая плитка и два хоста на каждый запрос
        // складывались в полтора десятка одновременных соединений. Считать
        // нагрузку обязан тот, кто её создаёт, — то есть этот модуль.
        // Мало ограничить число одновременных соединений: JacRed считает
        // запросы в единицу времени и отвечает 429. Поэтому между стартами
        // выдерживаем паузу — очередь растягивается, лента всё равно
        // дорисовывается по мере ответов.
        function pump() {
            while (inflight < maxInflight && waiting.length) {
                var wait = nextAllowedAt - nowFn();
                if (wait > 0) return wake(wait);
                nextAllowedAt = nowFn() + minSpacingMs;
                inflight++;
                waiting.shift()();
            }
        }

        function wake(ms) {
            if (wakePending) return;
            wakePending = true;
            delay(ms, function () {
                wakePending = false;
                pump();
            });
        }

        function release() {
            inflight--;
            pump();
        }

        function schedule(run) {
            waiting.push(run);
            pump();
        }

        // Кнопка «Обновить» сбрасывает кэш, но не остывание: именно в этот
        // момент пользователь бьёт по кнопке чаще всего, и снимать защиту
        // от 429 по нажатию — значит гарантированно нарваться на неё снова.
        function invalidate() {
            cache = {};
        }

        // Обход ленты — это 80 запросов подряд. Когда хост начинает отказывать,
        // добивать его остатком пачки бессмысленно и вредно: пользователь ждёт
        // 80 таймаутов, а хост видит шторм и режет нас ещё сильнее. Несколько
        // отказов подряд — и до конца остывания отвечаем сразу, без HTTP.
        function noteFailure(host, status) {
            failures[host] = (failures[host] || 0) + 1;
            // 429 — это прямая просьба хоста подождать, а не случайный сбой.
            // Ждать четырёх таких подряд бессмысленно: отступаем сразу.
            // Если после паузы снова 429 — значит лимит считается за окно
            // длиннее нашей паузы, и ждать надо кратно дольше, иначе мы
            // бесконечно тычем по одному запросу и продлеваем себе наказание.
            if (status === 429) {
                var strikes = throttleStrikes[host] = (throttleStrikes[host] || 0) + 1;
                var wait = Math.min(throttleCooldownMs * Math.pow(2, strikes - 1), throttleCooldownMaxMs);
                blockedUntil[host] = nowFn() + wait;
                persistThrottle();
                return;
            }
            if (failures[host] >= failureLimit) blockedUntil[host] = nowFn() + cooldownMs;
        }

        function noteSuccess(host) {
            failures[host] = 0;
            if (throttleStrikes[host] || blockedUntil[host]) {
                throttleStrikes[host] = 0;
                delete blockedUntil[host];
                persistThrottle();
            }
        }

        // Ручной сброс нужен ровно в одном случае: условия доступа изменились
        // (появился ключ, сменился адрес), и ждать старое остывание незачем.
        function clearThrottle() {
            blockedUntil = {};
            throttleStrikes = {};
            failures = {};
            persistThrottle();
        }

        function cooldowns() {
            var out = [];
            for (var host in blockedUntil) {
                if (!Object.prototype.hasOwnProperty.call(blockedUntil, host)) continue;
                if (blockedUntil[host] > nowFn()) out.push({ host: host, until: blockedUntil[host] });
            }
            return out;
        }

        function isBlocked(host) {
            return (blockedUntil[host] || 0) > nowFn();
        }

        function cacheSize() {
            return Object.keys(cache).length;
        }

        function activeCount() {
            return active.length;
        }

        function removeActive(network) {
            for (var i = active.length - 1; i >= 0; i--) {
                if (active[i] === network) active.splice(i, 1);
            }
        }

        function prune() {
            var now = nowFn();
            var keys = Object.keys(cache);
            var keep = [];
            for (var i = 0; i < keys.length; i++) {
                var item = cache[keys[i]];
                if (item && (now - item.ts) < cacheTtl) keep.push(keys[i]);
                else delete cache[keys[i]];
            }
            if (keep.length <= cacheMax) return;
            keep.sort(function (a, b) {
                return (cache[a].ts || 0) - (cache[b].ts || 0);
            });
            while (keep.length > cacheMax) {
                delete cache[keep.shift()];
            }
        }

        function abortActive() {
            waiting = [];
            inflight = 0;
            for (var i = active.length - 1; i >= 0; i--) {
                try {
                    if (active[i] && typeof active[i].clear === 'function') active[i].clear();
                } catch (e) {}
            }
            active = [];
        }

        function searchSingle(config, query, callback, errorCallback, requestTimeout, bypassThrottle) {
            var cacheKey = config.base + '|' + query;
            var scheme = config.base.indexOf('https://') === 0 ? 'https://' : 'http://';
            var cached = cache[cacheKey];
            if (cached && (nowFn() - cached.ts) < cacheTtl) {
                log.start('jacred', config.host, scheme, query)('cache', { rows: cached.data.length });
                return callback(cached.data.slice(), { host: config.host, cached: true });
            }

            // Пауза придумана против массового обхода. Плитка, открытая руками,
            // это один-три запроса: запрещать их — значит показывать человеку
            // мёртвый плагин там, где хост наверняка бы ответил.
            function blocked() { return !bypassThrottle && isBlocked(config.host); }

            if (blocked()) {
                log.start('jacred', config.host, scheme, query)('block');
                return errorCallback('JacRed(' + config.host + ') отдыхает после серии отказов');
            }

            var url = config.base + '/api/v1.0/torrents?search=' + encodeURIComponent(query) +
                '&apikey=' + encodeURIComponent(config.key || 'null');

            schedule(function () {
                // Пока запрос стоял в очереди, хост мог успеть отказать.
                if (blocked()) {
                    release();
                    log.start('jacred', config.host, scheme, query)('block');
                    return errorCallback('JacRed(' + config.host + ') отдыхает после серии отказов');
                }

                var done = log.start('jacred', config.host, scheme, query);
                var network = createRequest();
                active.push(network);
                if (typeof network.timeout === 'function') network.timeout(requestTimeout || timeoutMs);
                network.silent(url, function (data) {
                    removeActive(network);
                    release();
                    if (!Array.isArray(data)) {
                        noteFailure(config.host);
                        done('fail', { status: 'ответ не массив' });
                        return errorCallback('JacRed(' + config.host + '): ответ не массив');
                    }
                    noteSuccess(config.host);
                    var normalized = data.map(normalizeJacRedItem);
                    cache[cacheKey] = { data: normalized, ts: nowFn() };
                    prune();
                    done('ok', { rows: normalized.length });
                    callback(normalized.slice(), { host: config.host, cached: false });
                }, function (xhr) {
                    removeActive(network);
                    release();
                    var code = (xhr && xhr.status) ? xhr.status : 0;
                    var status = code || 'нет ответа';
                    noteFailure(config.host, code);
                    done('fail', { status: status });
                    errorCallback('JacRed(' + config.host + ') недоступен (' + status + ')');
                });
            });
        }

        function search(query, callback, errorCallback, opts) {
            var configs = getConfigs() || [];
            if (!configs.length) return errorCallback('jackett_url не задан в Lampa');

            var requestTimeout = opts && opts.timeoutMs;
            var bypassThrottle = !!(opts && opts.bypassThrottle);

            var pending = configs.length;
            var all = [];
            var seen = {};
            var sourceStats = [];
            var hasSuccess = false;
            var firstError = null;

            function mergeRows(rows) {
                for (var i = 0; i < rows.length; i++) {
                    var r = rows[i];
                    var key = canonicalTorrentKey(r);
                    if (!seen[key]) {
                        seen[key] = true;
                        all.push(r);
                    }
                }
            }

            function done() {
                if (--pending > 0) return;
                if (!hasSuccess) return errorCallback(firstError || 'JacRed недоступен');
                // Второй хост, ответивший пустотой, не отменяет отказ первого:
                // иначе «jacred упал, зеркало вернуло ноль» неотличимо от
                // «раздач нет», и счётчик отказов врёт в самый нужный момент.
                if (firstError && !all.length) return errorCallback(firstError);
                callback(all, { sources: sourceStats });
            }

            for (var i = 0; i < configs.length; i++) {
                (function (cfg) {
                    searchSingle(cfg, query, function (rows) {
                        hasSuccess = true;
                        sourceStats.push({ host: cfg.host, count: rows.length, ok: true });
                        mergeRows(rows || []);
                        done();
                    }, function (err) {
                        firstError = firstError || err;
                        sourceStats.push({ host: cfg.host, count: 0, ok: false, error: err });
                        done();
                    }, requestTimeout, bypassThrottle);
                })(configs[i]);
            }
        }

        function throttled() {
            var configs = getConfigs() || [];
            for (var i = 0; i < configs.length; i++) {
                if (!isBlocked(configs[i].host)) return false;
            }
            return configs.length > 0;
        }

        return {
            search: search,
            invalidate: invalidate,
            prune: prune,
            abortActive: abortActive,
            throttled: throttled,
            cooldowns: cooldowns,
            clearThrottle: clearThrottle,
            cacheSize: cacheSize,
            activeCount: activeCount
        };
    }

    var jacRedAccess = createJacRedAccess({
        getConfigs: getJackettConfigs,
        createRequest: function () { return new Lampa.Reguest(); },
        log: requestLog,
        readThrottle: function () {
            try { return Lampa.Storage.get(JACRED_THROTTLE_KEY, null); } catch (e) { return null; }
        },
        writeThrottle: function (state) {
            try { Lampa.Storage.set(JACRED_THROTTLE_KEY, state); } catch (e) {}
        }
    });

    // Еженедельные шоу выходят каждую неделю — их спрашиваем всегда. Имена
    // PPV дают результат только вокруг своего ивента, поэтому гонять все
    // сорок за каждый проход бессмысленно: за проход берём небольшой срез и
    // сдвигаем его. Полный круг проходит за несколько обновлений, а окно
    // ленты — 14 дней, так что ни один ивент не теряется, он лишь появляется
    // на десяток минут позже. Плитка PPV по-прежнему спрашивает всё сразу.
    var FEED_CORE_EXTRA_QUERIES = [
        'WWE NXT', 'WWE Main Event', 'AEW Rampage', 'ROH Wrestling', 'TNA Xplosion'
    ];
    // Версия 2.3.3 работала месяцами на 45 запросах в ленте. Держимся ниже
    // этой планки: ядро плюс небольшой срез хвоста. Полный круг по именам PPV
    // занимает больше проходов, но окно ленты — 14 дней, никто не теряется.
    var FEED_TAIL_PER_PASS = 4;
    var FEED_ROTATION_KEY = 'wrestling_feed_rotation';

    function dedupe(list) {
        var seen = {};
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var q = list[i];
            if (!q || seen[q]) continue;
            seen[q] = 1;
            out.push(q);
        }
        return out;
    }

    function feedCoreQueries() {
        var core = [];
        WEEKLY.forEach(function (ev) { core = core.concat(ev.queries); });
        return dedupe(core
            .concat(FEED_CORE_EXTRA_QUERIES)
            .concat(UFC_NUMBERED_QUERIES)
            .concat(BKFC_AGGREGATE.queries));
    }

    function feedTailQueries() {
        var all = [];
        FEED_SOURCES.forEach(function (ev) { all = all.concat(ev.queries); });
        var core = {};
        feedCoreQueries().forEach(function (q) { core[q] = 1; });
        return dedupe(all).filter(function (q) { return !core[q]; });
    }

    function weeklyQueries() {
        var list = [];
        WEEKLY.forEach(function (ev) { list = list.concat(ev.queries); });
        return dedupe(list);
    }

    // План ленты — три ступени, а не один список. Первая ступень это пять
    // еженедельных шоу: ради них лента и открывается, и они обязаны приехать
    // с первых же запросов. Следующие ступени идут, только если предыдущая
    // отработала без отказов — иначе на скудном источнике мы сожжём остаток
    // лимита на имена PPV и не покажем даже RAW.
    function feedQueryPlan(offset) {
        var weekly = weeklyQueries();
        var inWeekly = {};
        weekly.forEach(function (q) { inWeekly[q] = 1; });
        var rest = feedCoreQueries().filter(function (q) { return !inWeekly[q]; });
        var tail = feedTailQueries();

        var slice = [];
        var from = 0;
        if (tail.length) {
            from = ((offset || 0) % tail.length + tail.length) % tail.length;
            for (var i = 0; i < Math.min(FEED_TAIL_PER_PASS, tail.length); i++) {
                slice.push(tail[(from + i) % tail.length]);
            }
        }

        var stages = [weekly, rest, slice].filter(function (s) { return s.length; });
        return {
            stages: stages,
            queries: weekly.concat(rest, slice),
            tailFrom: from,
            tailTotal: tail.length
        };
    }

    function nextFeedRotation() {
        var offset = 0;
        try { offset = Lampa.Storage.get(FEED_ROTATION_KEY, 0) || 0; } catch (e) {}
        try { Lampa.Storage.set(FEED_ROTATION_KEY, offset + FEED_TAIL_PER_PASS); } catch (e) {}
        return offset;
    }

    var FEED_QUERIES = null;
    function buildFeedQueries() {
        if (FEED_QUERIES) return FEED_QUERIES;
        var set = {};
        var list = [];
        function add(q) { if (q && !set[q]) { set[q] = 1; list.push(q); } }
        FEED_SOURCES.forEach(function (ev) { ev.queries.forEach(add); });
        FEED_QUERIES = list;
        return list;
    }

    function acceptedByAnySource(tNorm) {
        for (var i = 0; i < FEED_SOURCES.length; i++) {
            if (titleMatchesEvent(FEED_SOURCES[i], tNorm)) return true;
        }
        return false;
    }

    function filterFeedMatches(allResults) {
        var nowMs = Date.now();
        var cutoff = nowMs - FEED_DAYS * 24 * 60 * 60 * 1000;
        var futureLimit = nowMs + 24 * 60 * 60 * 1000;

        var matches = [];
        for (var i = 0; i < allResults.length; i++) {
            var row = allResults[i];
            if (!acceptedByAnySource(titleNorm(row))) continue;

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

    function searchLampaParser(query, callback, errorCallback) {
        if (!Lampa.Parser || typeof Lampa.Parser.get !== 'function') {
            return errorCallback('Нет Lampa.Parser');
        }
        // Lampa.Parser читает тот же jackett_url, поэтому в ленте его нет —
        // там он лишь удваивал стук. Здесь он остаётся: плитку открывает
        // человек, и один повтор стоит одного запроса.
        var done = requestLog.start('parser', 'lampa', '', query);
        Lampa.Parser.get({ search: query, other: true, from_search: true }, function (json) {
            var rows = (json && Array.isArray(json.Results)) ? json.Results : [];
            done('ok', { rows: rows.length });
            callback(rows);
        }, function (err) {
            done('fail', { status: String(err || 'ошибка').slice(0, 80) });
            errorCallback(err || 'Lampa.Parser ошибка');
        });
    }

    function mergeSourceMeta(sourceMap, meta) {
        if (!meta || !meta.sources) return;
        for (var i = 0; i < meta.sources.length; i++) {
            var source = meta.sources[i];
            var host = source && source.host ? source.host : 'unknown';
            if (!sourceMap[host]) sourceMap[host] = { host: host, count: 0, ok: false };
            sourceMap[host].count += (source && source.count) || 0;
            sourceMap[host].ok = sourceMap[host].ok || !!(source && source.ok);
        }
    }

    /*
     * Deep module for running a batch of torrent queries.
     *
     * Each query tries adapters in order and advances only when the current
     * adapter fails. A successful empty response does not trigger fallback.
     * Cancellation is cooperative: no new queries are scheduled, while
     * already-started requests are left to their adapters.
     */
    function runQueryBatch(options, callback, errorCallback) {
        options = options || {};
        var queries = (options.queries || []).slice();
        var adapters = (options.adapters || []).slice();
        var concurrency = typeof options.concurrency === 'number' && options.concurrency > 0
            ? Math.floor(options.concurrency) : 1;
        var isCancelled = typeof options.isCancelled === 'function'
            ? options.isCancelled : function () { return false; };
        var onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
        var allowAllFailedAsEmpty = !!options.allowAllFailedAsEmpty;
        var total = queries.length;
        var allResults = [];
        var seen = {};
        var anySuccess = false;
        var firstError = null;
        var sourceMap = {};
        var nextIx = 0;
        var inflight = 0;
        var finished = 0;
        var failed = 0;

        function pushResults(results) {
            for (var pi = 0; pi < results.length; pi++) {
                var r = results[pi];
                var key = canonicalTorrentKey(r);
                if (!seen[key]) {
                    seen[key] = true;
                    allResults.push(r);
                }
            }
        }

        function progress(final) {
            return {
                finished: finished,
                total: total,
                failed: failed,
                final: !!final
            };
        }

        function sources() {
            var list = [];
            for (var host in sourceMap) {
                if (Object.prototype.hasOwnProperty.call(sourceMap, host)) list.push(sourceMap[host]);
            }
            return list;
        }

        function result(final) {
            return {
                rows: allResults.slice(),
                sources: sources(),
                progress: progress(final)
            };
        }

        function finish() {
            if (isCancelled()) return;
            if (!anySuccess && !allResults.length && !allowAllFailedAsEmpty) {
                return errorCallback(firstError || 'Не удалось получить результаты');
            }
            callback(result(true));
        }

        function onQueryDone(queryFailed) {
            if (isCancelled()) return;
            finished++;
            if (queryFailed) failed++;
            if (onProgress) onProgress(result(finished >= total));
            if (finished >= total) finish();
            else kick();
        }

        function runAdapter(q, adapterIx, lastError) {
            if (isCancelled()) return;
            if (adapterIx >= adapters.length) {
                firstError = firstError || lastError;
                inflight--;
                onQueryDone(true);
                return;
            }

            var adapter = adapters[adapterIx];
            adapter.search(q, function (results, meta) {
                if (isCancelled()) return;
                anySuccess = true;
                pushResults(results || []);
                mergeSourceMeta(sourceMap, meta);
                inflight--;
                onQueryDone(false);
            }, function (err) {
                if (isCancelled()) return;
                runAdapter(q, adapterIx + 1, err || lastError);
            });
        }

        function runQuery(q) {
            runAdapter(q, 0, null);
        }

        function kick() {
            if (isCancelled()) return;
            while (inflight < concurrency && nextIx < total) {
                inflight++;
                runQuery(queries[nextIx++]);
            }
        }

        if (!total) return errorCallback('Нет поисковых запросов');
        if (!adapters.length) return errorCallback('Нет поисковых адаптеров');
        kick();
    }

    // Плитка — интерактивное чтение на 1-3 запроса, ей важно быстро сдаться.
    // Лента читает 82 запроса подряд, ответы JacRed по 60-300 КБ, и на телевизоре
    // широкие запросы («WWE Raw», «AEW Collision») не укладываются в плиточные
    // 10 с. Выживали только самые лёгкие — отсюда «осталось два результата».
    function makeJacRedAdapter(requestTimeout, bypassThrottle) {
        return {
            id: 'jacred',
            search: function (query, callback, errorCallback) {
                jacRedAccess.search(query, callback, errorCallback, {
                    timeoutMs: requestTimeout,
                    bypassThrottle: bypassThrottle
                });
            }
        };
    }

    var JACRED_SEARCH_ADAPTER = makeJacRedAdapter(JACRED_REQUEST_TIMEOUT_MS, true);
    var JACRED_FEED_ADAPTER = makeJacRedAdapter(FEED_REQUEST_TIMEOUT_MS, false);

    var LAMPA_PARSER_SEARCH_ADAPTER = {
        id: 'lampa_parser',
        search: function (query, callback, errorCallback) {
            searchLampaParser(query, callback, errorCallback);
        }
    };

    // Плитка открывается по одной и руками — второй заход после отказа стоит
    // одного запроса и иногда спасает. Так было и в рабочей версии 2.3.3.
    var TILE_ADAPTERS = [JACRED_SEARCH_ADAPTER, LAMPA_PARSER_SEARCH_ADAPTER];
    // Плитка PPV — тоже обход, но запускает его человек осознанно. Пауза
    // существует против фонового автозапуска, а не против явного действия.
    var BULK_TILE_ADAPTERS = [makeJacRedAdapter(FEED_REQUEST_TIMEOUT_MS, true), LAMPA_PARSER_SEARCH_ADAPTER];

    // Лента ходит только в JacRed — ровно как 2.3.3, которая работала месяцами.
    // Lampa.Parser читает тот же jackett_url, то есть вторым источником никогда
    // не был. Зато в ленте он удваивал обход: десятки отказов превращались в
    // десятки повторов по тому же адресу, и временный отказ хоста закреплялся
    // надолго. Пусть лучше упавший запрос останется упавшим.
    var FEED_ADAPTERS = [JACRED_FEED_ADAPTER];

    function loadRecentFeed(callback, opts) {
        opts = opts || {};
        var isCancelled = typeof opts.isCancelled === 'function' ? opts.isCancelled : function () { return false; };
        var concurrency = typeof opts.concurrency === 'number' && opts.concurrency > 0
            ? opts.concurrency : FEED_SEARCH_CONCURRENCY;
        var onPartial = typeof opts.onPartial === 'function' ? opts.onPartial : null;
        var lastPartialAt = 0;
        var lastPartialCount = 0;

        var plan = feedQueryPlan(nextFeedRotation());
        var planned = plan.queries.length;
        var rows = [];
        var done = 0;
        var failed = 0;

        function snapshot(final) {
            return { finished: done, total: planned, failed: failed, final: !!final };
        }

        function report(final) {
            if (!onPartial || isCancelled()) return;
            var now = Date.now();
            // UI policy: redraw at most once per 350 ms. The orchestrator
            // still reports a snapshot after every completed query.
            if (!final && now - lastPartialAt < 350) return;
            var matches = filterFeedMatches(rows);
            if (!final && matches.length === lastPartialCount) return;
            lastPartialAt = now;
            lastPartialCount = matches.length;
            onPartial(matches, snapshot(final));
        }

        function runStage(ix) {
            if (isCancelled()) return;
            // Ступень не пошла — значит источник скуден. Оставшиеся запросы
            // отдадут те же отказы и только продлят лимит, поэтому
            // останавливаемся на том, что уже добыли.
            if (ix >= plan.stages.length || (ix > 0 && failed)) {
                planned = done;
                return callback(filterFeedMatches(rows), snapshot(true));
            }

            var stage = plan.stages[ix];
            requestLog.who('лента ступень ' + (ix + 1) + '/' + plan.stages.length +
                ' (' + stage.length + ' зпр)');

            runQueryBatch({
                queries: stage,
                adapters: FEED_ADAPTERS,
                concurrency: concurrency,
                isCancelled: isCancelled,
                allowAllFailedAsEmpty: true,
                onProgress: function (batch) {
                    done = doneBefore + batch.progress.finished;
                    failed = failedBefore + batch.progress.failed;
                    if (!batch.progress.final) report(false);
                }
            }, function (batch) {
                rows = rows.concat(batch.rows);
                done = doneBefore + batch.progress.finished;
                failed = failedBefore + batch.progress.failed;
                doneBefore = done;
                failedBefore = failed;
                report(false);
                runStage(ix + 1);
            }, function () {
                failed = failedBefore + stage.length;
                done = doneBefore + stage.length;
                doneBefore = done;
                failedBefore = failed;
                if (!isCancelled()) callback(filterFeedMatches(rows), snapshot(true));
            });
        }

        var doneBefore = 0;
        var failedBefore = 0;
        runStage(0);
    }

    function searchTorrents(event, callback, errorCallback) {
        // Плитка шоу — два запроса, ей важно быстро сдаться. Агрегатор PPV —
        // это такой же массовый обход, как лента, и жить он должен по её
        // правилам: иначе десятки запросов дружно падают по короткому
        // таймауту и плитка рапортует «парсер не отвечает».
        var bulk = (event.queries || []).length > BULK_QUERY_THRESHOLD;
        requestLog.who('плитка ' + (event.id || event.title || '?'));
        runQueryBatch({
            queries: event.queries,
            adapters: bulk ? BULK_TILE_ADAPTERS : TILE_ADAPTERS,
            concurrency: EVENT_QUERY_CONCURRENCY
        }, function (batch) {
            callback(batch.rows, {
                sources: batch.sources,
                progress: batch.progress
            });
        }, errorCallback);
    }

    function precomputeEventKeywords(event) {
        if (event._kwPrepared) return;
        if (event.ppvKeywords && event.ppvKeywords.length) {
            event._includeKwNorm = event.ppvKeywords.map(normalizeText);
            event._excludeKwNorm = (event.excludeKeywords || []).map(normalizeText);
            event._includeKwRe = keywordsRegex(event.ppvKeywords);
            event._ambiguousKwRe = keywordsRegex(event.ambiguousKeywords);
            event._promotionKwRe = keywordsRegex(event.promotionKeywords);
        }
        if (event.queries && event.queries.length) {
            event._queryTokenSets = event.queries.map(tokenize);
        }
        event._kwPrepared = true;
    }

    // Единственное правило отбора заголовка. Им пользуются и плитка, и лента,
    // поэтому плитка не может показывать то, чего нет в ленте, и наоборот.
    function titleMatchesEvent(event, tNorm) {
        precomputeEventKeywords(event);

        if (event._includeKwNorm) {
            var ok = !!(event._includeKwRe && event._includeKwRe.test(tNorm));
            if (!ok && event._ambiguousKwRe && event._ambiguousKwRe.test(tNorm)) {
                // «Sacrifice», «Revolution» и прочие обычные слова считаются
                // PPV только рядом с названием организации.
                ok = !!(event._promotionKwRe && event._promotionKwRe.test(tNorm));
            }
            if (!ok) return false;
            var excl = event._excludeKwNorm;
            for (var ke = 0; ke < excl.length; ke++) {
                if (excl[ke] && tokenRegex(excl[ke]).test(tNorm)) return false;
            }
            return true;
        }

        if (event._queryTokenSets) {
            for (var s = 0; s < event._queryTokenSets.length; s++) {
                if (queryMatchesTitle(tNorm, event._queryTokenSets[s])) return true;
            }
            return false;
        }

        return true;
    }

    function filterEventResults(results, event, state) {
        state = state || defaultFilterState(event.kind);
        precomputeEventKeywords(event);

        for (var i = 0; i < results.length; i++) ensureEffectiveDate(results[i]);

        var matches;
        if (event._includeKwNorm || event._queryTokenSets) {
            matches = [];
            for (var j = 0; j < results.length; j++) {
                if (titleMatchesEvent(event, titleNorm(results[j]))) matches.push(results[j]);
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

    function buildEventCard(event) {
        var html = $(
            '<div class="selector wrestling-weekly__tile">' +
                '<div class="wrestling-weekly__tile-name">' + (event.short || event.title) + '</div>' +
            '</div>'
        );

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

        function refreshController(delay, preferredTarget) {
            setTimeout(function () {
                if (!Lampa.Controller.enabled || Lampa.Controller.enabled().name !== 'content') return;

                Lampa.Controller.collectionSet(scroll.render());

                var target = isInDom(preferredTarget) ? preferredTarget : (isInDom(lastFocus) ? lastFocus : firstFocusable());
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
        this.pause = function () {};
        this.stop  = function () {};

        this.destroy = function () {
            componentDestroyed = true;
            if (Lampa.Parser && typeof Lampa.Parser.clear === 'function') Lampa.Parser.clear();
            scroll.destroy();
            html.remove();
        };

        function trackFocus(el) {
            el.on('hover:focus', function () {
                lastFocus = el[0];
                if (scroll && typeof scroll.update === 'function') {
                    try { scroll.update(el, true); } catch (e) {}
                }
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
            trackFocus(credit);
            scroll.append(credit);
        }

        function buildRecentFeedSection() {
            var sectionHeader = $('<div class="wrestling-weekly__section">Свежие раздачи · последние ' + FEED_DAYS + ' дней <span class="wrestling-weekly__section-count"></span></div>');
            scroll.append(sectionHeader);
            var feedActions = $('<div class="wrestling-weekly__filters"></div>');
            var refreshFeedBtn = $('<div class="selector wrestling-weekly__filter-btn">Обновить ленту</div>');
            var diagBtn = $('<div class="selector wrestling-weekly__filter-btn">Диагностика</div>');
            feedActions.append(refreshFeedBtn);
            feedActions.append(diagBtn);
            trackFocus(refreshFeedBtn);
            trackFocus(diagBtn);
            scroll.append(feedActions);

            var diagBox = $('<div class="wrestling-weekly__diag"></div>');
            scroll.append(diagBox);
            diagBtn.on('hover:enter', function () {
                if (diagBox.find('div').length) return diagBox.empty();
                diagnosticsLines().forEach(function (line) {
                    diagBox.append($('<div></div>').text(line));
                });
                refreshController(250, null);
            });
            var feedContainer = $('<div class="wrestling-weekly__list wrestling-weekly__feed"></div>');
            var feedLoader = $('<div class="wrestling-weekly__loader">Загружаю свежие раздачи...</div>');
            feedContainer.append(feedLoader);
            scroll.append(feedContainer);

            var feedNonce = 0;
            var countLabel = sectionHeader.find('.wrestling-weekly__section-count');

            function setCountLabel(text) {
                countLabel.text(text || '');
            }

            function feedResultKey(result) {
                return (result && (result.MagnetUri || result.Link || result.Title + '|' + (result.Size || result.size || ''))) || '';
            }

            function captureFeedFocus() {
                if (!lastFocus || !feedContainer[0] || !feedContainer[0].contains(lastFocus)) return null;

                var rows = feedContainer.find('.wrestling-weekly__item');
                var index = 0;
                for (var i = 0; i < rows.length; i++) {
                    if (rows[i] === lastFocus) {
                        index = i;
                        break;
                    }
                }

                return {
                    key: lastFocus.wrFeedKey || '',
                    index: index
                };
            }

            function findRestoredFeedFocus(snapshot) {
                if (!snapshot) return null;

                var rows = feedContainer.find('.wrestling-weekly__item');
                if (!rows.length) return null;

                if (snapshot.key) {
                    for (var i = 0; i < rows.length; i++) {
                        if (rows[i].wrFeedKey === snapshot.key) return rows[i];
                    }
                }

                return rows[Math.min(snapshot.index || 0, rows.length - 1)];
            }

            function renderFeed(results, opts) {
                opts = opts || {};
                var focusSnapshot = captureFeedFocus();
                feedContainer.empty();
                if (!results.length) {
                    if (opts.partial) {
                        feedContainer.append(feedLoader);
                        setCountLabel('· ищу…');
                        return;
                    }
                    // Пустая лента из-за упавших источников и пустая лента без
                    // свежих раздач — разные поломки, и чинят их по-разному.
                    var pr = opts.progress;
                    var allFailed = pr && pr.total && pr.failed >= pr.total;
                    feedContainer.append($('<div class="empty"><div class="empty__title">' +
                        (allFailed
                            ? 'Источники недоступны (' + pr.failed + '/' + pr.total + ' запросов упали)'
                            : 'За ' + FEED_DAYS + ' дней свежих раздач не нашлось') +
                        '</div></div>'));
                    setCountLabel(allFailed ? '· источники недоступны' : '· 0');
                    return;
                }

                var suffix = '';
                if (opts.partial && opts.progress) {
                    suffix = ' · ищу ' + opts.progress.finished + '/' + opts.progress.total;
                } else if (opts.stale) {
                    suffix = ' · кэш, обновляю…';
                } else if (opts.progress && opts.progress.failed) {
                    // Частично упавшая лента выглядит как просто короткая лента.
                    // Без этой строки «пропал рестлинг» неотличим от «его нет».
                    suffix = ' · ' + opts.progress.failed + ' из ' + opts.progress.total + ' запросов не ответили';
                }
                setCountLabel('· найдено ' + results.length + suffix);

                var feedEvt = { kind: 'feed', title: 'Свежая раздача' };
                var frag = document.createDocumentFragment();
                for (var i = 0; i < results.length; i++) {
                    var row = buildResultRow(results[i], feedEvt);
                    row[0].wrFeedKey = feedResultKey(results[i]);
                    trackFocus(row);
                    frag.appendChild(row[0]);
                }
                feedContainer[0].appendChild(frag);
                refreshController(250, findRestoredFeedFocus(focusSnapshot));
            }

            function runFeedSearch(forceRefresh) {
                var nonce = ++feedNonce;
                if (forceRefresh) {
                    jacRedAccess.invalidate();
                    // Нажатие на «Обновить» — это «попробуй прямо сейчас».
                    // Держать после него собственную паузу значит не оставить
                    // человеку вообще никакого выхода из тишины.
                    jacRedAccess.clearThrottle();
                    clearFeedStorage();
                    clearFeedFailure();
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

                // Автозапуск на главной не имеет права ломиться в источник,
                // который только что отказал всем: кнопка «Обновить ленту»
                // остаётся, а сам вход в плагин больше не стоит обхода.
                if (!forceRefresh && (feedRetryBlocked() || jacRedAccess.throttled())) {
                    if (!cached || !cached.matches.length) {
                        feedContainer.empty();
                        feedContainer.append($('<div class="empty"><div class="empty__title">Источник попросил паузу. Нажмите «Обновить ленту» — пауза снимется и запросы уйдут сразу</div></div>'));
                        setCountLabel('· пауза, снимается кнопкой');
                    }
                    return;
                }

                // 2) Стримим новые результаты по мере прихода ответов от JacRed.
                loadRecentFeed(function (results, progress) {
                    if (nonce !== feedNonce || componentDestroyed) return;
                    renderFeed(results, { progress: progress });
                    var allFailed = !progress || (progress.total && progress.failed >= progress.total);
                    if (allFailed) return noteFeedFailure();
                    clearFeedFailure();
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
            scroll.append(info);

            var filterRow = $('<div class="wrestling-weekly__filters"></div>');
            var daysBtn = $('<div class="selector wrestling-weekly__filter-btn"></div>');
            var sortBtn = $('<div class="selector wrestling-weekly__filter-btn"></div>');
            var queryBtn = null;
            var refreshBtn = $('<div class="selector wrestling-weekly__filter-btn">Обновить</div>');

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

            trackFocus(daysBtn);
            trackFocus(sortBtn);
            trackFocus(refreshBtn);
            if (queryBtn) trackFocus(queryBtn);

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
                    trackFocus(row);
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
                    jacRedAccess.invalidate();
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
            '.wrestling-weekly__tile{width:18em;min-height:5em;border-radius:.5em;padding:1em;display:flex;align-items:center;justify-content:center;text-align:center;background:rgba(255,255,255,.06);color:#fff;cursor:pointer}' +
            '.wrestling-weekly__tile.focus{background:#fff;color:#000}' +
            '.wrestling-weekly__tile-name{font-size:1.25em;font-weight:bold;line-height:1.2}' +
            '.wrestling-weekly__head{display:flex;gap:1.5em;align-items:center;margin-bottom:1em;padding:1em 1.2em;background:rgba(255,255,255,0.04);border-radius:1em}' +
            '.wrestling-weekly__title{font-size:1.4em;font-weight:bold;margin-bottom:.5em}' +
            '.wrestling-weekly__meta{font-size:1em;line-height:1.6}' +
            '.wrestling-weekly__loader{padding:1.5em;font-size:1.1em;opacity:.7}' +
            '.wrestling-weekly__stats{padding:.6em 1em;margin:.4em 0 .8em;font-size:.95em;background:rgba(255,255,255,0.04);border-radius:.5em;opacity:.85}' +
            // Журнал читают с фотографии телевизора: моноширинный шрифт,
            // высокий контраст, без переносов внутри строки.
            '.wrestling-weekly__diag{font-family:monospace;font-size:.95em;line-height:1.45;white-space:pre-wrap;word-break:break-word}' +
            '.wrestling-weekly__diag>div{padding:.05em 1em}' +
            '.wrestling-weekly__diag>div:nth-child(odd){background:rgba(255,255,255,0.05)}' +
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
            '.wrestling-weekly__credit.focus{opacity:1;background:rgba(255,255,255,.14)}'
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

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    function clockOf(ts) {
        var d = new Date(ts);
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    }

    // Журнал уезжает ко мне фотографией экрана, поэтому он обязан помещаться
    // на экран и читаться: сводка крупно, десяток последних строк мелко.
    function diagnosticsLines() {
        var s = requestLog.summary();
        var lines = ['Рестлинг v' + PLUGIN_VERSION + ' · запросов в журнале: ' + s.total];

        var configs = getJackettConfigs();
        lines.push('Источники: ' + (configs.length
            ? configs.map(function (c) { return c.base + (c.key ? ' (с ключом)' : ' (без ключа)'); }).join(', ')
            : 'не заданы'));

        var cooling = jacRedAccess.cooldowns();
        if (cooling.length) {
            cooling.forEach(function (c) {
                var left = Math.max(0, Math.round((c.until - Date.now()) / 1000));
                lines.push('ПАУЗА: ' + c.host + ' до ' + clockOf(c.until) +
                    ' (осталось ' + Math.floor(left / 60) + ' мин ' + (left % 60) + ' с)');
            });
        }

        if (!s.total) {
            lines.push('Журнал пуст — откройте плитку или обновите ленту.');
            return lines;
        }

        lines.push('Период: ' + clockOf(s.from) + ' — ' + clockOf(s.to));
        lines.push('Исходы: ok ' + (s.outcomes.ok || 0) +
            ' · ошибок ' + (s.outcomes.fail || 0) +
            ' · из кэша ' + (s.outcomes.cache || 0) +
            ' · пропущено после отказов ' + (s.outcomes.block || 0));

        s.hosts.forEach(function (h) {
            lines.push('  ' + h.host + ': ok ' + h.ok + ', ошибок ' + h.fail +
                ', прочее ' + h.other + ', макс ' + h.maxMs + ' мс');
        });

        if (s.errors.length) {
            lines.push('Ошибки:');
            s.errors.forEach(function (e) { lines.push('  ' + e.count + '× ' + e.text); });
        }
        if (s.slowest) lines.push('Дольше всех: ' + s.slowest.ms + ' мс — ' + s.slowest.q);

        var plan = feedQueryPlan(0);
        lines.push('План ленты: ' + plan.queries.length + ' запросов за проход' +
            ' (ядро ' + feedCoreQueries().length + ' + хвост ' + FEED_TAIL_PER_PASS +
            ' из ' + plan.tailTotal + ')');

        lines.push('Последние запросы:');
        requestLog.entries().slice(-10).forEach(function (r) {
            lines.push('  ' + clockOf(r.t) + ' +' + (r.gap || 0) + 'мс ' + r.out + ' ' + r.ms + 'мс ' +
                (r.out === 'ok' ? r.n + ' строк ' : (r.st ? r.st + ' ' : '')) +
                r.scheme + r.host + ' « ' + r.q + ' » ' + (r.by || ''));
        });
        return lines;
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
                clearFeedFailure();
                jacRedAccess.invalidate();
                return 'wr feed cache cleared';
            },
            clearThrottle: function () {
                jacRedAccess.clearThrottle();
                clearFeedFailure();
                return 'wr throttle cleared';
            },
            log: function () { return requestLog.entries(); },
            logSummary: function () { return requestLog.summary(); },
            logText: function () { return diagnosticsLines().join('\n'); },
            clearLog: function () { requestLog.clear(); return 'wr request log cleared'; },
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
                    cache_keys: jacRedAccess.cacheSize(),
                    feed_cache: window.wr.feedCache(),
                    active_requests: jacRedAccess.activeCount(),
                    active_player_log: !!activePlayerLog,
                    cleanups: cleanupCount,
                    last_cleanup_reason: lastCleanupReason,
                    memory: memorySnapshot()
                };
            }
        };
    }

    if (window.__WR_TEST__) {
        window.__WR_TEST_HOOKS__ = {
            canonicalTorrentKey: canonicalTorrentKey,
            runQueryBatch: runQueryBatch,
            createJacRedAccess: createJacRedAccess,
            createRequestLog: createRequestLog,
            normalizeJacRedItem: normalizeJacRedItem,
            titleMatchesEvent: titleMatchesEvent,
            filterFeedMatches: filterFeedMatches,
            buildFeedQueries: buildFeedQueries,
            feedCoreQueries: feedCoreQueries,
            feedQueryPlan: feedQueryPlan,
            FEED_TAIL_PER_PASS: FEED_TAIL_PER_PASS,
            titleNorm: titleNorm,
            JACRED_CACHE_MAX: JACRED_CACHE_MAX,
            JACRED_REQUEST_TIMEOUT_MS: JACRED_REQUEST_TIMEOUT_MS,
            normalizeJackettUrl: normalizeJackettUrl,
            TILE_ADAPTERS: TILE_ADAPTERS,
            FEED_ADAPTERS: FEED_ADAPTERS,
            FEED_SOURCES: FEED_SOURCES,
            PPV_AGGREGATE: PPV_AGGREGATE,
            UFC_AGGREGATE: UFC_AGGREGATE
        };
        return;
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
