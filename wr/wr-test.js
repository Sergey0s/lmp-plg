#!/usr/bin/env node
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

function loadHooks() {
    var code = fs.readFileSync(path.join(__dirname, 'wr.js'), 'utf8');
    var context = {
        window: { __WR_TEST__: true },
        Date: Date,
        Math: Math,
        Object: Object,
        String: String,
        Array: Array,
        RegExp: RegExp,
        parseInt: parseInt,
        decodeURIComponent: decodeURIComponent,
        console: console
    };
    vm.runInNewContext(code, context, { filename: 'wr.js' });
    assert(context.window.__WR_TEST_HOOKS__, 'wr.js did not expose test hooks');
    return context.window.__WR_TEST_HOOKS__;
}

var hooks = loadHooks();
var runQueryBatch = hooks.runQueryBatch;
var canonicalTorrentKey = hooks.canonicalTorrentKey;
var tests = [];

function test(name, fn) {
    tests.push({ name: name, fn: fn });
}

function controlledAdapter(id) {
    var pending = [];
    var calls = [];
    return {
        adapter: {
            id: id,
            search: function (query, success, error) {
                calls.push(query);
                pending.push({ query: query, success: success, error: error });
            }
        },
        calls: calls,
        pending: pending,
        succeedNext: function (rows, meta) {
            assert(pending.length, id + ': no pending request to succeed');
            pending.shift().success(rows || [], meta);
        },
        failNext: function (error) {
            assert(pending.length, id + ': no pending request to fail');
            pending.shift().error(error || id + ' failed');
        }
    };
}

function batch(options) {
    return new Promise(function (resolve, reject) {
        runQueryBatch(options, resolve, reject);
    });
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

test('canonical dedup key prefers infohash, then magnet, link, title+size', function () {
    var hash = '0123456789abcdef0123456789abcdef01234567';
    var a = canonicalTorrentKey({
        MagnetUri: 'magnet:?xt=urn:btih:' + hash.toUpperCase() + '&tr=udp://one'
    });
    var b = canonicalTorrentKey({
        MagnetUri: 'magnet:?xt=urn:btih:' + hash + '&tr=udp://two'
    });
    assert.strictEqual(a, 'hash:' + hash);
    assert.strictEqual(a, b);
    assert.strictEqual(
        canonicalTorrentKey({ MagnetUri: 'magnet:?dn=no-hash' }),
        'magnet:magnet:?dn=no-hash'
    );
    assert.strictEqual(canonicalTorrentKey({ Link: 'https://tracker/item/1' }), 'link:https://tracker/item/1');
    assert.strictEqual(
        canonicalTorrentKey({ Title: 'WWE Raw', Size: 123 }),
        'title:WWE Raw|size:123'
    );
});

test('concurrency limits active queries and schedules the next one', async function () {
    var source = controlledAdapter('source');
    var done = batch({
        queries: ['q1', 'q2', 'q3', 'q4'],
        adapters: [source.adapter],
        concurrency: 2
    });

    assert.deepStrictEqual(source.calls, ['q1', 'q2']);
    source.succeedNext([{ Title: 'one', Size: 1 }]);
    assert.deepStrictEqual(source.calls, ['q1', 'q2', 'q3']);
    source.succeedNext([{ Title: 'two', Size: 2 }]);
    assert.deepStrictEqual(source.calls, ['q1', 'q2', 'q3', 'q4']);
    source.succeedNext([{ Title: 'three', Size: 3 }]);
    source.succeedNext([{ Title: 'four', Size: 4 }]);

    var result = await done;
    assert.strictEqual(result.rows.length, 4);
    assert.deepStrictEqual(plain(result.progress), { finished: 4, total: 4, failed: 0, final: true });
});

test('adapter fallback happens on error, not on successful empty response', async function () {
    var primary = controlledAdapter('primary');
    var fallback = controlledAdapter('fallback');
    var first = batch({
        queries: ['error-query'],
        adapters: [primary.adapter, fallback.adapter],
        concurrency: 1
    });

    primary.failNext('primary down');
    assert.deepStrictEqual(fallback.calls, ['error-query']);
    fallback.succeedNext([{ Title: 'fallback result', Size: 10 }]);
    assert.strictEqual((await first).rows.length, 1);

    var primary2 = controlledAdapter('primary2');
    var fallback2 = controlledAdapter('fallback2');
    var second = batch({
        queries: ['empty-query'],
        adapters: [primary2.adapter, fallback2.adapter],
        concurrency: 1
    });
    primary2.succeedNext([]);
    assert.deepStrictEqual(fallback2.calls, []);
    assert.strictEqual((await second).rows.length, 0);
});

test('snapshots, canonical dedup and source metadata share one result shape', async function () {
    var hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    var snapshots = [];
    var adapter = {
        id: 'jacred',
        search: function (query, success) {
            success([{
                Title: 'Same torrent',
                Size: 100,
                MagnetUri: 'magnet:?xt=urn:btih:' + hash + '&tr=' + query
            }], {
                sources: [{ host: 'jacred.su', count: 1, ok: true }]
            });
        }
    };

    var result = await batch({
        queries: ['one', 'two'],
        adapters: [adapter],
        concurrency: 2,
        onProgress: function (snapshot) {
            snapshots.push(snapshot);
        }
    });

    assert.strictEqual(result.rows.length, 1, 'same infohash must deduplicate');
    assert.deepStrictEqual(plain(result.sources), [{ host: 'jacred.su', count: 2, ok: true }]);
    assert.strictEqual(snapshots.length, 2);
    assert.strictEqual(snapshots[0].progress.finished, 1);
    assert.strictEqual(snapshots[0].progress.final, false);
    assert.strictEqual(snapshots[1].progress.finished, 2);
    assert.strictEqual(snapshots[1].progress.final, true);
});

test('all failed queries preserve feed and event completion policies', async function () {
    function failingAdapter() {
        return {
            id: 'fail',
            search: function (query, success, error) {
                error('failed: ' + query);
            }
        };
    }

    var feedResult = await batch({
        queries: ['q1', 'q2'],
        adapters: [failingAdapter()],
        concurrency: 1,
        allowAllFailedAsEmpty: true
    });
    assert.strictEqual(feedResult.rows.length, 0);
    assert.deepStrictEqual(plain(feedResult.progress), { finished: 2, total: 2, failed: 2, final: true });

    var eventError = null;
    try {
        await batch({
            queries: ['q1'],
            adapters: [failingAdapter()],
            concurrency: 1
        });
    } catch (error) {
        eventError = error;
    }
    assert.strictEqual(eventError, 'failed: q1');
});

test('cooperative cancellation starts no new query and emits no completion', function () {
    var source = controlledAdapter('source');
    var cancelled = false;
    var completed = false;

    runQueryBatch({
        queries: ['q1', 'q2', 'q3'],
        adapters: [source.adapter],
        concurrency: 1,
        isCancelled: function () { return cancelled; }
    }, function () {
        completed = true;
    }, function () {
        completed = true;
    });

    assert.deepStrictEqual(source.calls, ['q1']);
    cancelled = true;
    source.succeedNext([{ Title: 'ignored', Size: 1 }]);
    assert.deepStrictEqual(source.calls, ['q1']);
    assert.strictEqual(completed, false);
});

var createJacRedAccess = hooks.createJacRedAccess;
var normalizeJacRedItem = hooks.normalizeJacRedItem;

function parseJacRedUrl(url) {
    var host = String(url).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    var search = '';
    var m = String(url).match(/[?&]search=([^&]*)/);
    if (m) search = decodeURIComponent(m[1]);
    return { host: host, search: search, url: url };
}

function fakeJacRed(options) {
    options = options || {};
    var httpCalls = [];
    var pending = [];
    var access = createJacRedAccess({
        getConfigs: options.getConfigs || function () {
            return [{ base: 'https://jacred.su', key: 'null', host: 'jacred.su' }];
        },
        createRequest: function () {
            var req = {
                timeoutMs: 0,
                timeout: function (ms) { req.timeoutMs = ms; },
                silent: function (url, success, error) {
                    var parsed = parseJacRedUrl(url);
                    httpCalls.push(parsed);
                    pending.push({
                        url: url,
                        host: parsed.host,
                        search: parsed.search,
                        success: success,
                        error: error,
                        clear: function () { req.cleared = true; }
                    });
                },
                clear: function () { req.cleared = true; },
                cleared: false
            };
            return req;
        },
        now: options.now,
        cacheTtl: options.cacheTtl,
        cacheMax: options.cacheMax
    });
    return {
        access: access,
        httpCalls: httpCalls,
        pending: pending,
        succeedNext: function (data) {
            assert(pending.length, 'no pending JacRed request');
            pending.shift().success(data);
        },
        failNext: function (xhr) {
            assert(pending.length, 'no pending JacRed request');
            pending.shift().error(xhr || { status: 0 });
        }
    };
}

function searchJacRed(access, query) {
    return new Promise(function (resolve, reject) {
        access.search(query, resolve, reject);
    });
}

test('JacRed maps native rows and extracts infohash', function () {
    var hash = 'F454FC8F6F0A9B9142482CBCE92F9D54E1546AF0';
    var row = normalizeJacRedItem({
        title: 'WWE Raw 21.09.2026',
        tracker: 'rutracker',
        size: 123,
        magnet: 'magnet:?xt=urn:btih:' + hash,
        url: 'https://rutracker.org/t/1',
        sid: '7',
        pir: '2',
        createTime: '2026-09-22T08:00:00'
    });
    assert.strictEqual(row.Title, 'WWE Raw 21.09.2026');
    assert.strictEqual(row.Tracker, 'rutracker');
    assert.strictEqual(row.Seeders, 7);
    assert.strictEqual(row.hash, hash.toLowerCase());
    assert.strictEqual(canonicalTorrentKey(row), 'hash:' + hash.toLowerCase());
});

test('JacRed cache hit skips a second HTTP call; invalidate forces a refetch', async function () {
    var fake = fakeJacRed();
    var first = searchJacRed(fake.access, 'WWE Raw');
    assert.strictEqual(fake.httpCalls.length, 1);
    fake.succeedNext([{ title: 'Raw', magnet: 'magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', size: 1 }]);
    assert.strictEqual((await first).length, 1);
    assert.strictEqual(fake.access.cacheSize(), 1);

    var second = searchJacRed(fake.access, 'WWE Raw');
    assert.strictEqual(fake.httpCalls.length, 1, 'cache should skip HTTP');
    assert.strictEqual((await second).length, 1);

    fake.access.invalidate();
    assert.strictEqual(fake.access.cacheSize(), 0);
    var third = searchJacRed(fake.access, 'WWE Raw');
    assert.strictEqual(fake.httpCalls.length, 2);
    fake.succeedNext([{ title: 'Raw again', magnet: 'magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', size: 2 }]);
    assert.strictEqual((await third)[0].Title, 'Raw again');
});

test('JacRed dual-host merge uses canonicalTorrentKey', async function () {
    var hash = 'cccccccccccccccccccccccccccccccccccccccc';
    var fake = fakeJacRed({
        getConfigs: function () {
            return [
                { base: 'https://jacred.su', key: 'null', host: 'jacred.su' },
                { base: 'https://jac.red', key: 'null', host: 'jac.red' }
            ];
        }
    });
    var done = searchJacRed(fake.access, 'AEW Collision');
    assert.strictEqual(fake.pending.length, 2);
    fake.succeedNext([{
        title: 'Collision su',
        magnet: 'magnet:?xt=urn:btih:' + hash + '&tr=udp://su',
        url: 'https://su/1',
        size: 10
    }]);
    fake.succeedNext([{
        title: 'Collision red',
        magnet: 'magnet:?xt=urn:btih:' + hash + '&tr=udp://red',
        url: 'https://red/1',
        size: 10
    }]);
    var rows = await done;
    assert.strictEqual(rows.length, 1, 'same infohash from two hosts must merge');
});

test('JacRed non-array response fails that host and can still succeed from the other', async function () {
    var fake = fakeJacRed({
        getConfigs: function () {
            return [
                { base: 'https://jacred.su', key: 'null', host: 'jacred.su' },
                { base: 'https://jac.red', key: 'null', host: 'jac.red' }
            ];
        }
    });
    var done = searchJacRed(fake.access, 'UFC');
    fake.succeedNext({ error: 'not an array' });
    fake.succeedNext([{ title: 'UFC 331', magnet: 'magnet:?xt=urn:btih:dddddddddddddddddddddddddddddddddddddddd', size: 5 }]);
    var rows = await done;
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].Title, 'UFC 331');
});

test('JacRed errors when every host fails', async function () {
    var fake = fakeJacRed({
        getConfigs: function () {
            return [
                { base: 'https://jacred.su', key: 'null', host: 'jacred.su' },
                { base: 'https://jac.red', key: 'null', host: 'jac.red' }
            ];
        }
    });
    var done = searchJacRed(fake.access, 'BKFC');
    fake.failNext({ status: 0 });
    fake.failNext({ status: 500 });
    var err = null;
    try { await done; } catch (e) { err = e; }
    assert.ok(String(err).indexOf('JacRed(jacred.su) недоступен') !== -1);
});

test('JacRed reports missing config instead of calling HTTP', async function () {
    var fake = fakeJacRed({ getConfigs: function () { return []; } });
    var err = null;
    try { await searchJacRed(fake.access, 'WWE'); } catch (e) { err = e; }
    assert.strictEqual(err, 'jackett_url не задан в Lampa');
    assert.strictEqual(fake.httpCalls.length, 0);
});

// --- Единое правило отбора заголовков: плитка и лента ------------------------

var titleMatchesEvent = hooks.titleMatchesEvent;
var titleNorm = hooks.titleNorm;
var PPV = hooks.PPV_AGGREGATE;
var UFC = hooks.UFC_AGGREGATE;

function tileAccepts(event, title) {
    return titleMatchesEvent(event, titleNorm({ Title: title }));
}

function feedAccepts(title) {
    var row = { Title: title, PublishDate: new Date().toISOString() };
    return hooks.filterFeedMatches([row]).length === 1;
}

test('PPV keyword that is an ordinary word needs a promotion next to it', function () {
    assert.ok(!tileAccepts(PPV, 'Жертва обстоятельств / Sacrifice (2025) WEB-DL 1080p'));
    assert.ok(!tileAccepts(PPV, 'The Matrix Revolutions 2003 2160p BluRay x265'));
    assert.ok(tileAccepts(PPV, 'TNA Sacrifice 2011 [2011, Рестлинг, HDTVRip]'));
    assert.ok(tileAccepts(PPV, 'AEW Revolution 2026 [2026, Рестлинг, WEB-DL 1080p]'));
});

test('PPV name coined by wrestling stands on its own', function () {
    assert.ok(tileAccepts(PPV, 'WrestleMania 42 Sunday 1080p WEB h264'));
    assert.ok(tileAccepts(PPV, 'Royal Rumble 2026 1080p WEB-DL'));
});

test('keyword must start a word, so Revolutions and Evolutionary do not count', function () {
    assert.ok(!tileAccepts(PPV, 'WWE Revolutionary Documentary 2026 1080p'));
    assert.ok(tileAccepts(PPV, 'WWE Revolution 2026 1080p'));
});

test('feed accepts exactly what some tile accepts', function () {
    assert.ok(feedAccepts('UFC 331 Van vs. Pantoja 2 1080p WEB-DL'), 'UFC tile');
    assert.ok(feedAccepts('WWE Monday Night Raw 22.09.2026 [2026, Рестлинг, WEB-DL 1080p]'), 'weekly tile');
    assert.ok(feedAccepts('AEW Rampage 19.09.2026 WEB-DL 1080p'), 'feed-only show');
    assert.ok(feedAccepts('TNA Sacrifice 2026 1080p WEB-DL'), 'PPV tile');
});

test('feed rejects the movies that used to flood it', function () {
    assert.ok(!feedAccepts('Жертва обстоятельств / Sacrifice (2025) WEB-DLRip'));
    assert.ok(!feedAccepts('The Revolutionaries S01E04 1080p AMZN WEB-DL'));
    assert.ok(!feedAccepts('Jesus Revolution (2023) BDRip 1080p'));
});

test('feed and tile never disagree on the same title', function () {
    var titles = [
        'TNA Sacrifice 2011 [2011, Рестлинг, HDTVRip]',
        'UFC 331 1080p ENG',
        'Sacrifice 2025 2160p WEB-DL DDP5.1 SDR H265-NGP',
        'WWE Backlash 2026 1080p WEB h264'
    ];
    titles.forEach(function (title) {
        var anyTile = hooks.FEED_SOURCES.some(function (src) { return tileAccepts(src, title); });
        assert.strictEqual(feedAccepts(title), anyTile, title);
    });
});

test('PPV tile still drops weekly shows', function () {
    assert.ok(!tileAccepts(PPV, 'WWE Monday Night Raw 22.09.2026 Sacrifice match'));
    assert.ok(!tileAccepts(UFC, 'WWE Revolution 2026 1080p'));
});

(async function run() {
    var failed = 0;
    for (var i = 0; i < tests.length; i++) {
        try {
            await tests[i].fn();
            console.log('✓ ' + tests[i].name);
        } catch (error) {
            failed++;
            console.error('✗ ' + tests[i].name);
            console.error(error && error.stack ? error.stack : error);
        }
    }

    if (failed) {
        console.error('\n' + failed + ' test(s) failed');
        process.exit(1);
    }
    console.log('\n' + tests.length + ' tests passed');
}());
