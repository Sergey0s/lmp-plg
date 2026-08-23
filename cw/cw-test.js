#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pluginPath = path.join(__dirname, 'cw.js');
const code = fs.readFileSync(pluginPath, 'utf8');

class MiniQuery {
  constructor(nodes, label) {
    this.nodes = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
    this.length = this.nodes.length;
    this.label = label || '';
    for (let i = 0; i < this.nodes.length; i++) this[i] = this.nodes[i];
  }

  append(value) {
    const add = value instanceof MiniQuery ? value.nodes : [value];
    this.nodes.forEach((node) => {
      node.children = node.children || [];
      add.forEach((item) => {
        if (item && item.__miniNode) {
          item.parent = node;
          item.isConnected = true;
          node.children.push(item);
        }
        else {
          const html = String(item || '');
          node.html = (node.html || '') + html;
          node.selectorCount = (node.selectorCount || 0) + countSelectors(html);
        }
      });
    });
    return this;
  }

  appendTo() { return this; }
  prepend(value) { return this.append(value); }
  before(value) {
    this.nodes.forEach((node) => {
      const parent = node.parent;
      if (!parent) return;
      const add = value instanceof MiniQuery ? value.nodes : [value];
      add.forEach((item) => {
        if (item && item.__miniNode) {
          item.parent = parent;
          item.isConnected = true;
          parent.children.unshift(item);
        }
      });
    });
    return this;
  }
  remove() {
    this.nodes.forEach((n) => {
      n.removed = true;
      if (n.parent && n.parent.children) {
        n.parent.children = n.parent.children.filter((child) => child !== n);
      }
    });
    return this;
  }
  empty() { this.nodes.forEach((n) => { n.children = []; n.html = ''; n.selectorCount = 0; }); return this; }
  css() { return this; }
  hasClass(name) { return !!(this.nodes[0] && this.nodes[0].classes && this.nodes[0].classes[name]); }
  on(event, selectorOrHandler, handler) {
    this.nodes.forEach((n) => {
      n.handlers = n.handlers || {};
      n.handlers[event] = handler || selectorOrHandler;
    });
    return this;
  }
  trigger(event) {
    this.nodes.forEach((n) => {
      if (n.handlers && typeof n.handlers[event] === 'function') n.handlers[event].call(n);
    });
    return this;
  }
  eq(i) { return new MiniQuery(this.nodes[i] ? [this.nodes[i]] : [], this.label + '.eq'); }
  first() { return this.eq(0); }
  find(selector) {
    if (selector !== '.selector') {
      const found = [];
      this.nodes.forEach((node) => collectBySelector(node, selector, found));
      if (!found.length && selector.charAt(0) === '.') {
        this.nodes.forEach((node) => collectSyntheticBySelector(node, selector, found));
      }
      return new MiniQuery(found, selector);
    }
    const total = this.nodes.reduce((sum, n) => sum + (n.selectorCount || 0), 0);
    const nodes = [];
    for (let i = 0; i < total; i++) {
      nodes.push({
        __miniNode: true,
        index: i,
        offsetTop: i * 28,
        offsetHeight: 28,
        classes: {},
      });
    }
    return new MiniQuery(nodes, selector);
  }
  addClass(name) { this.nodes.forEach((n) => { n.classes = n.classes || {}; n.classes[name] = true; }); return this; }
  removeClass(name) { this.nodes.forEach((n) => { if (n.classes) delete n.classes[name]; }); return this; }
  text(value) {
    if (typeof value === 'undefined') return this.nodes[0] ? (this.nodes[0].text || '') : '';
    this.nodes.forEach((n) => { n.text = String(value); });
    return this;
  }
  scrollTop(value) {
    if (typeof value === 'undefined') return this.nodes[0] ? (this.nodes[0].scrollTop || 0) : 0;
    this.nodes.forEach((n) => { n.scrollTop = value; });
    return this;
  }
  innerHeight() { return 720; }
}

function collectBySelector(node, selector, out) {
  if (!node || node.removed) return;
  const selectors = String(selector).split(',').map((s) => s.trim()).filter(Boolean);
  const children = node.children || [];
  children.forEach((child) => {
    if (child.removed) return;
    if (selectors.some((s) => matchesSelector(child, s))) out.push(child);
    collectBySelector(child, selector, out);
  });
}

function collectSyntheticBySelector(node, selector, out) {
  if (!node || node.removed) return;
  const className = selector.slice(1);
  if (!String(node.html || '').includes(className)) return;
  node.synthetic = node.synthetic || {};
  if (!node.synthetic[className]) {
    node.synthetic[className] = {
      __miniNode: true,
      html: '',
      text: '',
      children: [],
      handlers: {},
      classes: {[className]: true},
      selectorCount: 0,
      offsetTop: 0,
      offsetHeight: 28,
      isConnected: true,
      parent: node,
    };
  }
  out.push(node.synthetic[className]);
}

function matchesSelector(node, selector) {
  if (!node || !selector) return false;
  const dataAction = selector.match(/^\.menu__item\[data-action="([^"]+)"\]$/);
  if (dataAction) {
    return !!(node.classes && node.classes.menu__item) &&
      String(node.html || '').includes(`data-action="${dataAction[1]}"`);
  }
  if (selector.charAt(0) === '.') return !!(node.classes && node.classes[selector.slice(1)]);
  if (selector.indexOf('[data-') === 0) return false;
  return false;
}

function countSelectors(html) {
  return (String(html).match(/\bselector\b/g) || []).length;
}

function nodeFromHtml(html) {
  const classes = {};
  const classMatch = String(html || '').match(/class="([^"]+)"/);
  if (classMatch) classMatch[1].split(/\s+/).forEach((c) => { if (c) classes[c] = true; });
  return {
    __miniNode: true,
    html: String(html || ''),
    children: [],
    handlers: {},
    classes,
    selectorCount: countSelectors(html),
    offsetTop: 0,
    offsetHeight: 28,
    isConnected: false,
  };
}

const menuList = nodeFromHtml('<div class="menu__list"></div>');
const bodyChildren = [];

function $(arg) {
  if (arg instanceof MiniQuery) return arg;
  if (arg && arg.__miniNode) return new MiniQuery([arg]);
  if (typeof arg === 'string' && arg.trim().charAt(0) === '<') return new MiniQuery([nodeFromHtml(arg)]);
  if (arg === 'head' || arg === 'body') return new MiniQuery([nodeFromHtml(arg)]);
  if (arg === '.menu .menu__list') return new MiniQuery([menuList]);
  if (String(arg).indexOf('.menu .menu__item') === 0) {
    const selector = String(arg).replace(/^\.menu\s+/, '');
    const found = [];
    collectBySelector(menuList, selector, found);
    return new MiniQuery(found, selector);
  }
  return new MiniQuery([]);
}

const listeners = {};
const components = {};
const storage = {
  continue_watch_params: makeEntries(123),
  torrserver_url: 'http://192.168.31.244:8090',
  player_torrent: 'inner',
  cw_buffer_modal: false,
};
let activeActivity = {component: 'main', movie: null};
let controllerName = '';
let startCalls = 0;
let noties = [];
let playerPlayCalls = [];
let playerPlaylistCalls = [];
let xhrRequests = [];
let liveXhrs = [];
let torrentAddHold = false;
let pendingTorrentAdds = [];
let activityPushCalls = [];
let storageSetCalls = [];
let focusedNode = null;
const windowEventListeners = {};
const documentEventListeners = {};
const intervalCalls = [];
let clockNow = 0;
let nextTimerId = 1;
const clockTasks = new Map();

function scheduleClock(fn, ms, interval) {
  const id = nextTimerId++;
  const delay = Math.max(0, Number(ms) || 0);
  clockTasks.set(id, {
    id,
    fn,
    delay,
    interval: !!interval,
    due: clockNow + delay,
  });
  return id;
}

function clearClock(id) {
  clockTasks.delete(id);
}

function tick(ms) {
  const target = clockNow + Math.max(0, Number(ms) || 0);
  let executions = 0;
  while (true) {
    let next = null;
    clockTasks.forEach((task) => {
      if (task.due <= target && (!next || task.due < next.due || (task.due === next.due && task.id < next.id))) {
        next = task;
      }
    });
    if (!next) break;
    if (++executions > 10000) throw new Error('fake clock runaway at ' + clockNow + 'ms');
    clockNow = next.due;
    if (!clockTasks.has(next.id)) continue;
    if (next.interval) next.due += Math.max(1, next.delay);
    else clockTasks.delete(next.id);
    next.fn();
  }
  clockNow = target;
}

function captureEvent(target, event, cb) {
  (target[event] ||= []).push(cb);
}
function captureInterval(fn, ms) {
  const id = scheduleClock(fn, ms, true);
  intervalCalls.push({id, fn, ms});
  return id;
}
let torrentGetResponse = {
  preloaded_bytes: 10,
  preload_size: 100,
  download_speed: 2048,
};
let torserverFileStats = [
  {id: 1, path: 'Smoke AutoNext Series S01 E01.mkv'},
  {id: 2, path: 'Smoke AutoNext Series S01 E02.mkv'},
];
const timelineStore = {};
let selectCalls = [];
const xhrBehavior = {
  echo: 'success',
  stream: 'success',
  torrents: 'success',
};
const qaFailures = [];

function qaAssert(condition, message) {
  if (!condition) qaFailures.push(message);
}

const Lampa = {
  Storage: {
    get(key, def) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : def; },
    set(key, value) {
      storageSetCalls.push({key, value});
      storage[key] = value;
      (listeners['storage:change'] || []).forEach((cb) => cb({name: key, value}));
    },
    field(key) { return storage[key]; },
    sync() {},
    listener: {follow(event, cb) { (listeners['storage:' + event] ||= []).push(cb); }},
  },
  Listener: {
    follow(event, cb) { (listeners[event] ||= []).push(cb); },
    send(event, payload) { (listeners[event] || []).forEach((cb) => cb(payload)); },
  },
  Component: {
    add(name, component) { components[name] = component; },
  },
  Activity: {
    active() { return activeActivity; },
    push(object) {
      activityPushCalls.push(object);
      return openComponent(object.component, object);
    },
    replace(object) { return openComponent(object.component, object); },
    backward() {},
  },
  Controller: {
    add(name, cfg) { this.controllers[name] = cfg; },
    controllers: {},
    toggle(name) {
      controllerName = name;
      const cfg = this.controllers[name];
      if (cfg && cfg.toggle) cfg.toggle();
    },
    enabled() { return {name: controllerName || 'content'}; },
    clear() {},
    collectionSet() {},
    collectionFocus(node) {
      if (focusedNode && focusedNode.classes) delete focusedNode.classes.focus;
      focusedNode = node || null;
      if (focusedNode) {
        focusedNode.classes = focusedNode.classes || {};
        focusedNode.classes.focus = true;
      }
    },
  },
  Noty: {
    show(text) { noties.push(String(text)); },
  },
  Utils: {
    hash(value) {
      let h = 0;
      const s = String(value || '');
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      return String(Math.abs(h));
    },
    cardImgBackground() { return {img: ''}; },
  },
  Background: {immediately() {}, change() {}},
  Player: {
    play(data) { playerPlayCalls.push(data); },
    callback() {},
    playlist(data) { playerPlaylistCalls.push(data); },
    listener: {
      follow(event, cb) { (listeners['player:' + event] ||= []).push(cb); },
      remove(event, cb) {
        listeners['player:' + event] = (listeners['player:' + event] || []).filter((x) => x !== cb);
      },
    },
  },
  Timeline: {
    listener: {
      follow(event, cb) { (listeners['timeline:' + event] ||= []).push(cb); },
    },
    view(hash) { return timelineStore[hash] || {}; },
    update(data) {
      if (data && data.hash) {
        timelineStore[data.hash] = Object.assign({}, timelineStore[data.hash] || {}, data);
        const account = Lampa.Account && Lampa.Account.Permit && Lampa.Account.Permit.account;
        const profile = account && account.profile;
        const key = profile && typeof profile.id !== 'undefined' ? 'file_view_' + profile.id : 'file_view';
        const value = Object.assign({}, storage[key] || {});
        value[data.hash] = Object.assign({}, value[data.hash] || {}, data);
        Lampa.Storage.set(key, value);
      }
      (listeners['timeline:update'] || []).forEach((cb) => cb({data: {hash: data.hash, road: data}}));
    },
  },
  Torserver: {
    parse(opts) {
      const file = opts && opts.files && opts.files[0];
      const name = (file && file.path) || '';
      const m = name.match(/S(\d+)\s*E(\d+)/i);
      return {
        season: m ? Number(m[1]) : 1,
        episode: m ? Number(m[2]) : 1,
      };
    },
    files(hash, ok) {
      ok({
        file_stats: torserverFileStats,
      });
    },
  },
  Platform: {is() { return false; }},
  Account: {Permit: {sync: false, account: {profile: {id: 756763}}}},
  Select: {
    show(opts) {
      selectCalls.push(opts);
      controllerName = 'select';
    },
  },
  Manifest: {plugins: []},
  Template: {js() { return nodeFromHtml('<div></div>'); }},
};

const sandbox = {
  window: {
    appready: true,
    Lampa,
    addEventListener(event, cb) { captureEvent(windowEventListeners, event, cb); },
    requestAnimationFrame(fn) { return fn(); },
    setTimeout(fn, ms) { return scheduleClock(fn, ms, false); },
    clearTimeout: clearClock,
    setInterval: captureInterval,
    clearInterval: clearClock,
    performance: {memory: {usedJSHeapSize: 10_000_000, totalJSHeapSize: 10_000_000, jsHeapSizeLimit: 1_000_000_000}},
  },
  document: {
    hidden: false,
    body: {appendChild(node) { bodyChildren.push(node); }},
    createElement() { return {style: {}, children: [], appendChild() {}, remove() {}}; },
    getElementById() { return null; },
    addEventListener(event, cb) { captureEvent(documentEventListeners, event, cb); },
    documentElement: {},
  },
  Lampa,
  $,
  console,
  requestAnimationFrame(fn) { return fn(); },
  setTimeout(fn, ms) { return scheduleClock(fn, ms, false); },
  clearTimeout: clearClock,
  setInterval: captureInterval,
  clearInterval: clearClock,
  performance: {now: () => Date.now(), memory: {usedJSHeapSize: 10_000_000, totalJSHeapSize: 10_000_000, jsHeapSizeLimit: 1_000_000_000}},
  MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
  XMLHttpRequest: MockXMLHttpRequest,
};
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;
sandbox.window.console = console;
sandbox.window.performance = sandbox.performance;

function makeEntries(count) {
  const out = {};
  for (let i = 0; i < count; i++) {
    out['hash-' + i] = {
      title: i % 2 ? 'Prison Break' : 'Универ. Молодые',
      season: 2,
      episode: i + 1,
      percent: 40 + (i % 60),
      time: 1200 + i,
      duration: 2400,
      timestamp: Date.now() - i * 1000,
    torrent_link: 'magnet:?xt=urn:btih:' + String(i).padStart(40, 'a').slice(0, 40),
      file_index: i,
    };
  }
  return out;
}

function makeCardRender() {
  const root = nodeFromHtml('<div class="full"></div>');
  const buttons = nodeFromHtml('<div class="full-start__buttons"></div>');
  buttons.parent = root;
  buttons.isConnected = true;
  root.children.push(buttons);
  return new MiniQuery([root], 'card-render');
}

function MockXMLHttpRequest() {
  this.headers = {};
  this.status = 200;
  this.responseText = '';
  this.timeout = 0;
}

MockXMLHttpRequest.prototype.open = function (method, url) {
  this.method = method;
  this.url = url;
};

MockXMLHttpRequest.prototype.setRequestHeader = function (name, value) {
  this.headers[name] = value;
};

MockXMLHttpRequest.prototype.send = function (body) {
  this.aborted = false;
  xhrRequests.push({method: this.method, url: this.url, body: body || '', headers: Object.assign({}, this.headers)});
  const route = /\/echo(?:\?|$)/.test(this.url)
    ? 'echo'
    : /\/stream\//.test(this.url)
      ? 'stream'
      : /\/torrents$/.test(this.url)
        ? 'torrents'
        : null;
  const behavior = route ? xhrBehavior[route] : 'success';
  if (behavior === 'network-error') {
    if (typeof this.onerror === 'function') this.onerror(new Error('simulated network error'));
    return;
  }
  if (behavior === 'timeout') {
    if (typeof this.ontimeout === 'function') this.ontimeout();
    return;
  }
  if (typeof behavior === 'number') this.status = behavior;

  // Keep GET /stream alive until abort or xhr.timeout — that is the TorrServer
  // preload connection. Completing it in send() made abort tests impossible.
  if (this.method === 'GET' && /\/stream\//.test(this.url) && behavior === 'success') {
    this._live = true;
    liveXhrs.push(this);
    const timeoutMs = Number(this.timeout) || 0;
    if (timeoutMs > 0) {
      const xhr = this;
      this._timeoutId = scheduleClock(function () {
        if (xhr.aborted || !xhr._live) return;
        xhr._live = false;
        liveXhrs = liveXhrs.filter((item) => item !== xhr);
        if (typeof xhr.ontimeout === 'function') xhr.ontimeout();
      }, timeoutMs);
    }
    return;
  }

  if (this.method === 'POST' && /\/torrents$/.test(this.url)) {
    let payload = {};
    try { payload = body ? JSON.parse(body) : {}; } catch (e) {}
    if (payload.action === 'get') {
      const stats = typeof torrentGetResponse === 'function' ? torrentGetResponse() : torrentGetResponse;
      this.responseText = JSON.stringify(stats || {});
    } else if (payload.action === 'add' && torrentAddHold) {
      pendingTorrentAdds.push(this);
      return;
    } else {
      this.responseText = JSON.stringify({hash: '0123456789abcdef0123456789abcdef01234567'});
    }
  }
  if (typeof this.onload === 'function') this.onload();
};

MockXMLHttpRequest.prototype.abort = function () {
  this.aborted = true;
  this._live = false;
  liveXhrs = liveXhrs.filter((item) => item !== this);
  if (this._timeoutId) {
    clearClock(this._timeoutId);
    this._timeoutId = 0;
  }
};

function addMovieContinueEntry(title) {
  const hash = Lampa.Utils.hash(title);
  storage.continue_watch_params[hash] = {
    title,
    percent: 44,
    time: 1234,
    duration: 3600,
    timestamp: Date.now() + 1000,
    torrent_link: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
    file_name: 'Movie Test.mkv',
    file_index: 0,
  };
  notifyContinueStorageChanged();
  return hash;
}

function addSeriesEntry(title, season, episode, overrides) {
  const hash = Lampa.Utils.hash([season, episode, title].join(''));
  storage.continue_watch_params[hash] = Object.assign({
    title,
    season,
    episode,
    percent: 0,
    time: 0,
    duration: 2400,
    timestamp: Date.now(),
    torrent_link: 'magnet:?xt=urn:btih:abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    file_name: `${title} S${String(season).padStart(2, '0')} E${String(episode).padStart(2, '0')}.mkv`,
    file_index: episode,
  }, overrides || {});
  notifyContinueStorageChanged();
  return storage.continue_watch_params[hash];
}

function notifyContinueStorageChanged() {
  (listeners['storage:change'] || []).forEach((cb) => cb({
    name: 'continue_watch_params',
    value: storage.continue_watch_params,
  }));
}

function seriesHash(title, season, episode) {
  return Lampa.Utils.hash([season, season > 10 ? ':' : '', episode, title].join(''));
}

function sendPlayerStart(data) {
  (listeners['player:start'] || []).forEach((cb) => cb(data));
}

function sendPlayerExternal(data) {
  (listeners['player:external'] || []).forEach((cb) => cb(data));
}

function sendPlayerDestroy() {
  (listeners['player:destroy'] || []).forEach((cb) => cb());
}

function lastBufferModal() {
  return bodyChildren.filter((node) => String(node.html || '').indexOf('cw-buf') !== -1).pop();
}

function liveBufferModals() {
  return bodyChildren.filter((node) => String(node.html || '').indexOf('cw-buf') !== -1 && !node.removed);
}

function livePreloadXhrs(link) {
  return liveXhrs.filter((xhr) => {
    if (!xhr._live || xhr.aborted || !/preload/.test(xhr.url || '')) return false;
    if (!link) return true;
    return String(xhr.url).indexOf('link=' + link) !== -1;
  });
}

function livePreloadIndexes(link) {
  return livePreloadXhrs(link)
    .map((xhr) => {
      const match = String(xhr.url).match(/[?&]index=(\d+)/);
      return match ? Number(match[1]) : 0;
    })
    .sort((a, b) => a - b);
}

function flushPendingTorrentAdds() {
  const queued = pendingTorrentAdds.slice();
  pendingTorrentAdds = [];
  queued.forEach((xhr) => {
    if (xhr.aborted) return;
    xhr.responseText = JSON.stringify({hash: '0123456789abcdef0123456789abcdef01234567'});
    xhr.status = 200;
    if (typeof xhr.onload === 'function') xhr.onload();
  });
}

function assertStreamContract(url, opts) {
  opts = opts || {};
  qaAssert(!!url && url.indexOf('/stream/') !== -1, 'Stream URL missing /stream/: ' + url);
  qaAssert(
    url.indexOf('/stream/' + encodeURIComponent(opts.fileName || 'Movie Test.mkv')) !== -1,
    'Stream URL must encode file name: ' + url
  );
  qaAssert(url.indexOf('link=' + (opts.link || '')) !== -1, 'Stream URL must pass torrent link: ' + url);
  qaAssert(url.indexOf('index=' + (opts.index || 0)) !== -1, 'Stream URL must pass file index: ' + url);
  if (opts.preload) {
    qaAssert(url.indexOf('preload') !== -1, 'Preload request must include preload: ' + url);
    qaAssert(!/[?&]play(?:&|$)/.test(url), 'Preload request must drop play: ' + url);
  } else {
    qaAssert(/[?&]play(?:&|$)/.test(url), 'Playback URL must include play: ' + url);
    qaAssert(url.indexOf('preload') === -1, 'Playback URL must not request preload: ' + url);
  }
}

function openComponent(name, object) {
  const Component = components[name];
  if (!Component) throw new Error('Component not registered: ' + name);
  startCalls = 0;
  const component = new Component(object || {component: name});
  const activity = {
    is_started: false,
    loader() {},
    toggle() {
      if (this.is_started) {
        startCalls++;
        if (startCalls > 5) throw new Error('recursive activity.toggle/start detected');
        component.start();
      }
    },
  };
  component.activity = activity;

  const t0 = Date.now();
  component.create(nodeFromHtml('<div class="activity__body"></div>'));
  component.render(true);
  activity.is_started = true;
  component.start();
  const elapsed = Date.now() - t0;

  if (elapsed > 1000) throw new Error('diagnostics open too slow: ' + elapsed + 'ms');
  return {component, elapsed};
}

vm.createContext(sandbox);
vm.runInContext(code, sandbox, {filename: pluginPath});

if (!components.continue_watch_diag) {
  throw new Error('Diag component was not registered');
}
if (!components.continue_watch_plus) {
  throw new Error('Diag component must also be registered under menu data-action');
}

const menuItem = $('.menu .menu__item[data-action="continue_watch_plus"]').first();
if (!menuItem.length) throw new Error('Continue plugin menu item was not injected');

activeActivity = {component: 'main', movie: null};
activityPushCalls = [];
let menuOpenStartedAt = Date.now();
menuItem.trigger('hover:enter');
let menuOpenElapsed = Date.now() - menuOpenStartedAt;
if (activityPushCalls.length !== 1) {
  throw new Error('Menu item hover:enter should call Activity.push once, calls=' + activityPushCalls.length);
}
if (activityPushCalls[0].component !== 'continue_watch_diag') {
  throw new Error('Menu item should open diagnostics component, got: ' + activityPushCalls[0].component);
}
if (controllerName !== 'continue_watch_diag') {
  throw new Error('Diagnostics controller should be active after menu open, got: ' + controllerName);
}
if (menuOpenElapsed > 1000) throw new Error('Menu diagnostics open too slow: ' + menuOpenElapsed + 'ms');
console.log('menu diagnostics open OK:', menuOpenElapsed + 'ms');

activeActivity = {
  component: 'full',
  movie: {title: 'Универ. Молодые', name: 'Универ. Молодые', number_of_seasons: 2},
};
menuOpenStartedAt = Date.now();
const genericMenuResult = openComponent('continue_watch_plus', {
  component: 'continue_watch_plus',
  title: 'Продолжить · диагностика smoke via data-action',
  movie: activeActivity.movie,
});
menuOpenElapsed = Date.now() - menuOpenStartedAt;
if (genericMenuResult.elapsed > 1000 || menuOpenElapsed > 1000) {
  throw new Error('Generic data-action diagnostics open too slow: ' + genericMenuResult.elapsed + '/' + menuOpenElapsed + 'ms');
}
if (controllerName !== 'continue_watch_diag') {
  throw new Error('Generic data-action open should activate diagnostics controller, got: ' + controllerName);
}
console.log('menu data-action diagnostics open OK:', genericMenuResult.elapsed + 'ms');

for (let i = 0; i < 3; i++) {
  activeActivity = {
    component: i ? 'full' : 'main',
    movie: i ? {title: 'Универ. Молодые', name: 'Универ. Молодые', number_of_seasons: 2} : null,
  };
  const result = openComponent('continue_watch_diag', {
    component: 'continue_watch_diag',
    title: 'Продолжить · диагностика smoke',
    movie: activeActivity.movie,
  });
  console.log(`open #${i + 1}: ${result.elapsed}ms`);
}

const continueTitle = 'Smoke Continue Movie';
addMovieContinueEntry(continueTitle);
const movie = {title: continueTitle, name: continueTitle};
const render = makeCardRender();
activeActivity = {component: 'full', movie, activity: {render: () => render}};
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie},
  object: activeActivity,
});

const btn = render.find('.button--continue-watch').first();
if (!btn.length) throw new Error('Continue button was not injected');
if (!/Продолжить/.test(btn.nodes[0].html || '')) {
  throw new Error('Continue button label is missing');
}

playerPlayCalls = [];
btn.trigger('hover:enter');
if (playerPlayCalls.length !== 1) {
  throw new Error('Continue click did not start player, calls=' + playerPlayCalls.length);
}

const play = playerPlayCalls[0];
if (play.card !== movie) throw new Error('Player.play received wrong card');
if (!play.url || play.url.indexOf('/stream') === -1) throw new Error('Player.play URL is invalid: ' + play.url);
if (play.position !== 1234) throw new Error('Player.play position should resume from 1234, got ' + play.position);
console.log('continue button OK:', play.position, play.url.slice(0, 32) + '...');
tick(2000);

const beforeExternalLabel = btn.nodes[0].html || '';
if (beforeExternalLabel.indexOf('20:34') === -1) {
  throw new Error('Initial continue button should show 20:34, got: ' + beforeExternalLabel);
}
const continueHash = Lampa.Utils.hash(continueTitle);

// Реальный Android TV кейс: после возврата из внешнего плеера DOM карточки
// остаётся на экране, но Lampa.Activity.active() может временно указывать не
// на full activity. Кнопка всё равно должна обновиться через cached render из
// full:complite.
activeActivity = {component: 'main'};
storage.file_view_756763 = Object.assign({}, storage.file_view_756763 || {}, {
  [continueHash]: {
    hash: continueHash,
    percent: 57,
    time: 2050,
    duration: 3600,
  },
});
Lampa.Storage.set('file_view_756763', storage.file_view_756763);
tick(80);

const refreshedBtn = render.find('.button--continue-watch').first();
if (!refreshedBtn.length) throw new Error('Continue button disappeared after file_view refresh');
const refreshedLabel = refreshedBtn.nodes[0].html || '';
if (refreshedLabel.indexOf('34:10') === -1) {
  throw new Error('Continue button should refresh to 34:10 after external player, got: ' + refreshedLabel);
}
const refreshedEntry = storage.continue_watch_params[continueHash];
if (!refreshedEntry || refreshedEntry.time !== 2050 || refreshedEntry.percent !== 57) {
  throw new Error('External file_view progress was not saved: ' + JSON.stringify(refreshedEntry));
}
console.log('external refresh OK:', '20:34 -> 34:10');

storage.file_view_756763 = Object.assign({}, storage.file_view_756763 || {}, {
  [continueHash]: {
    hash: continueHash,
    percent: 100,
    time: 0,
    duration: 0,
  },
});
Lampa.Storage.set('file_view_756763', storage.file_view_756763);
tick(80);
const afterZeroEnded = storage.continue_watch_params[continueHash];
if (!afterZeroEnded || afterZeroEnded.time !== 2050 || afterZeroEnded.duration !== 3600) {
  throw new Error('External 100% time=0 update should not erase saved resume point: ' + JSON.stringify(afterZeroEnded));
}
console.log('external ended zero-time guard OK:', afterZeroEnded.time);

const smartTitle = 'Smoke SmartNext Series';
addSeriesEntry(smartTitle, 1, 7, {
  percent: 99.7,
  time: 2380,
  duration: 2400,
  file_index: 7,
  timestamp: Date.now() + 7000,
});
addSeriesEntry(smartTitle, 1, 8, {
  percent: 0,
  time: 0,
  duration: 2400,
  file_index: 8,
  timestamp: Date.now() + 6000,
});
const smartMovie = {title: smartTitle, name: smartTitle, number_of_seasons: 1};
const smartRender = makeCardRender();
activeActivity = {component: 'full', movie: smartMovie, activity: {render: () => smartRender}};
storage.cw_buffer_modal = false;
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: smartMovie},
  object: activeActivity,
});
playerPlayCalls = [];
const smartBtn = smartRender.find('.button--continue-watch').first();
if (!smartBtn.length) throw new Error('Smart-next continue button was not injected');
smartBtn.trigger('hover:enter');
if (playerPlayCalls.length !== 0) throw new Error('Smart-next should open confirm before playing');
if (controllerName !== 'cw_center_confirm') throw new Error('Smart-next confirm controller was not opened: ' + controllerName);
let smartModal = bodyChildren[bodyChildren.length - 1];
const smartTitleText = $(smartModal).find('.cw-cnf__title').text();
if (!/99%/.test(smartTitleText) || /100%/.test(smartTitleText)) {
  throw new Error('Smart-next title should floor 99.7% to 99%, got: ' + smartTitleText);
}
$(smartModal).find('.cw-cnf__btn--secondary').trigger('hover:enter');
if (playerPlayCalls.length !== 1) throw new Error('Smart-next secondary should start current episode');
if (playerPlayCalls[0].episode !== 7 || playerPlayCalls[0].position !== 2370) {
  throw new Error('Smart-next secondary should resume S1E7 at safe 2370s: ' + JSON.stringify(playerPlayCalls[0]));
}
if (!playerPlayCalls[0].playlist || playerPlayCalls[0].playlist.length < 2) {
  throw new Error('Smart-next secondary must keep playlist for player auto-next: ' + JSON.stringify(playerPlayCalls[0].playlist));
}
tick(2000);
playerPlayCalls = [];
smartBtn.trigger('hover:enter');
smartModal = bodyChildren[bodyChildren.length - 1];
$(smartModal).find('.cw-cnf__btn--primary').trigger('hover:enter');
if (playerPlayCalls.length !== 1) throw new Error('Smart-next primary should start next episode');
if (playerPlayCalls[0].episode !== 8 || ![-1, 0].includes(playerPlayCalls[0].position)) {
  throw new Error('Smart-next primary should start S1E8 from beginning: ' + JSON.stringify(playerPlayCalls[0]));
}
tick(2000);
console.log('smart-next confirm OK:', smartTitleText);

const watchedNoNextTitle = 'Smoke Watched No Cached Next';
const watchedNoNextLink = 'magnet:?xt=urn:btih:7777777777777777777777777777777777777777';
addSeriesEntry(watchedNoNextTitle, 1, 4, {
  percent: 100,
  time: 0,
  duration: 0,
  file_index: 4,
  torrent_link: watchedNoNextLink,
  file_name: `${watchedNoNextTitle} S01 E04.mkv`,
  timestamp: Date.now() + 7500,
});
torserverFileStats = [
  {id: 4, path: `${watchedNoNextTitle} S01 E04.mkv`},
  {id: 5, path: `${watchedNoNextTitle} S01 E05.mkv`},
];
delete sandbox.window.cw.state.files[watchedNoNextLink];
delete sandbox.window.cw.state.files_pending[watchedNoNextLink];
const watchedNoNextMovie = {title: watchedNoNextTitle, name: watchedNoNextTitle, number_of_seasons: 1};
const watchedNoNextRender = makeCardRender();
activeActivity = {
  component: 'full',
  movie: watchedNoNextMovie,
  activity: {render: () => watchedNoNextRender},
};
playerPlayCalls = [];
controllerName = 'content';
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: watchedNoNextMovie},
  object: activeActivity,
});
const watchedNoNextBtn = watchedNoNextRender.find('.button--continue-watch').first();
if (!watchedNoNextBtn.length) throw new Error('Watched-no-next button was not injected');
watchedNoNextBtn.trigger('hover:enter');
if (playerPlayCalls.length !== 0) {
  throw new Error('100% episode without cached next must not launch current episode from start');
}
if (controllerName !== 'cw_center_confirm') {
  throw new Error('100% episode should resolve next from files and open smart-next confirm, got: ' + controllerName);
}
const watchedNoNextModal = bodyChildren[bodyChildren.length - 1];
$(watchedNoNextModal).find('.cw-cnf__btn--primary').trigger('hover:enter');
if (playerPlayCalls.length !== 1 || playerPlayCalls[0].episode !== 5) {
  throw new Error('Resolved next episode should launch S1E5: ' + JSON.stringify(playerPlayCalls[0]));
}
tick(2000);
console.log('watched episode resolves next from files OK');

const watchedMissingNextTitle = 'Smoke Watched Missing Next';
const watchedMissingNextLink = 'magnet:?xt=urn:btih:7777777777777777777777777777777777777788';
addSeriesEntry(watchedMissingNextTitle, 1, 4, {
  percent: 100,
  time: 0,
  duration: 0,
  file_index: 4,
  torrent_link: watchedMissingNextLink,
  file_name: `${watchedMissingNextTitle} S01 E04.mkv`,
  timestamp: Date.now() + 7600,
});
torserverFileStats = [
  {id: 4, path: `${watchedMissingNextTitle} S01 E04.mkv`},
];
delete sandbox.window.cw.state.files[watchedMissingNextLink];
delete sandbox.window.cw.state.files_pending[watchedMissingNextLink];
const watchedMissingNextMovie = {title: watchedMissingNextTitle, name: watchedMissingNextTitle, number_of_seasons: 1};
const watchedMissingNextRender = makeCardRender();
activeActivity = {
  component: 'full',
  movie: watchedMissingNextMovie,
  activity: {render: () => watchedMissingNextRender},
};
playerPlayCalls = [];
controllerName = 'content';
const notiesBeforeMissingNext = noties.length;
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: watchedMissingNextMovie},
  object: activeActivity,
});
const watchedMissingNextBtn = watchedMissingNextRender.find('.button--continue-watch').first();
if (!watchedMissingNextBtn.length) throw new Error('Watched-missing-next button was not injected');
watchedMissingNextBtn.trigger('hover:enter');
if (playerPlayCalls.length !== 0) {
  throw new Error('100% episode with missing next must not launch current episode from start');
}
const missingNextNoty = noties.slice(notiesBeforeMissingNext).join(' | ');
if (missingNextNoty.indexOf('Следующий эпизод не найден') === -1) {
  throw new Error('Missing next episode should notify user, got: ' + missingNextNoty);
}
tick(2000);
console.log('watched episode missing next no-autoplay OK');

const watchedPendingNextTitle = 'Smoke Watched Pending Next';
const watchedPendingNextLink = 'magnet:?xt=urn:btih:7777777777777777777777777777777777777799';
addSeriesEntry(watchedPendingNextTitle, 1, 4, {
  percent: 100,
  time: 0,
  duration: 0,
  file_index: 4,
  torrent_link: watchedPendingNextLink,
  file_name: `${watchedPendingNextTitle} S01 E04.mkv`,
  timestamp: Date.now() + 7700,
});
delete sandbox.window.cw.state.files[watchedPendingNextLink];
sandbox.window.cw.state.files_pending[watchedPendingNextLink] = true;
const watchedPendingNextMovie = {title: watchedPendingNextTitle, name: watchedPendingNextTitle, number_of_seasons: 1};
const watchedPendingNextRender = makeCardRender();
activeActivity = {
  component: 'full',
  movie: watchedPendingNextMovie,
  activity: {render: () => watchedPendingNextRender},
};
playerPlayCalls = [];
controllerName = 'content';
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: watchedPendingNextMovie},
  object: activeActivity,
});
const watchedPendingNextBtn = watchedPendingNextRender.find('.button--continue-watch').first();
if (!watchedPendingNextBtn.length) throw new Error('Watched-pending-next button was not injected');
watchedPendingNextBtn.trigger('hover:enter');
if (playerPlayCalls.length !== 0) {
  throw new Error('100% episode with pending files must not launch current episode from start');
}
tick(2000);
delete sandbox.window.cw.state.files_pending[watchedPendingNextLink];
console.log('watched episode pending files no-autoplay OK');

// ── Torserver.files throws synchronously → files_pending must be cleaned ─────
// Setup: install throwing mock BEFORE card render so prefetch also throws.
// This keeps S.files[link] empty → target.hasNext=false → click goes through
// resolveNextEpisodeFromFiles path where Torserver.files throws again.
const torserverThrowTitle = 'Smoke Torserver Throw';
const torserverThrowLink = 'magnet:?xt=urn:btih:7777777777777777777777777777777788888888';
addSeriesEntry(torserverThrowTitle, 1, 3, {
  percent: 100,
  time: 0,
  duration: 0,
  file_index: 3,
  torrent_link: torserverThrowLink,
  file_name: `${torserverThrowTitle} S01 E03.mkv`,
  timestamp: Date.now() + 8000,
});
delete sandbox.window.cw.state.files[torserverThrowLink];
delete sandbox.window.cw.state.files_pending[torserverThrowLink];
const _origTorserverFiles = Lampa.Torserver.files;
Lampa.Torserver.files = function () { throw new Error('simulated Torserver.files crash'); };
const torserverThrowMovie = {title: torserverThrowTitle, name: torserverThrowTitle, number_of_seasons: 1};
const torserverThrowRender = makeCardRender();
activeActivity = {
  component: 'full',
  movie: torserverThrowMovie,
  activity: {render: () => torserverThrowRender},
};
playerPlayCalls = [];
controllerName = 'content';
const notiesBeforeThrow = noties.length;
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: torserverThrowMovie},
  object: activeActivity,
});
const torserverThrowBtn = torserverThrowRender.find('.button--continue-watch').first();
if (!torserverThrowBtn.length) throw new Error('Torserver-throw button was not injected');
// click: hasNext=false (S.files empty) → resolveNextEpisodeFromFiles → throws → guardedDone(null)
torserverThrowBtn.trigger('hover:enter');
Lampa.Torserver.files = _origTorserverFiles;
if (sandbox.window.cw.state.files_pending[torserverThrowLink]) {
  throw new Error('files_pending must be cleared after Torserver.files throws');
}
const throwNoty = noties.slice(notiesBeforeThrow).join(' | ');
if (throwNoty.indexOf('Следующий эпизод не найден') === -1) {
  throw new Error('resolveNextEpisodeFromFiles throw should result in not-found noty, got: ' + throwNoty);
}
const throwNotFoundCount = noties
  .slice(notiesBeforeThrow)
  .filter((n) => n.indexOf('Следующий эпизод не найден') !== -1).length;
if (throwNotFoundCount !== 1) {
  throw new Error('resolveNextEpisodeFromFiles done() must fire once, not-found count=' + throwNotFoundCount);
}
tick(2000);
// Ensure modal_open was not left dirty so subsequent tests are not affected.
sandbox.window.cw.state.modal_open = false;
console.log('Torserver.files exception → files_pending cleaned up, done() called OK');

const bufferTitle = 'Smoke Buffer Movie';
const bufferHash = addMovieContinueEntry(bufferTitle);
storage.continue_watch_params[bufferHash].torrent_link =
  'magnet:?xt=urn:btih:1111111111111111111111111111111111111111';
storage.continue_watch_params[bufferHash].file_index = 1;
const bufferMovie = {title: bufferTitle, name: bufferTitle};
const bufferRender = makeCardRender();
storage.cw_buffer_modal = true;
storage.cw_buffer_pct = 10;
sandbox.window.cw.prefetch(false);
activeActivity = {component: 'full', movie: bufferMovie, activity: {render: () => bufferRender}};
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: bufferMovie},
  object: activeActivity,
});
xhrRequests = [];
playerPlayCalls = [];
const bufferBtn = bufferRender.find('.button--continue-watch').first();
if (!bufferBtn.length) throw new Error('Buffer continue button was not injected');
bufferBtn.trigger('hover:enter');
tick(50);
if (playerPlayCalls.length !== 1) {
  throw new Error('Buffer modal should auto-launch after preload threshold, calls=' + playerPlayCalls.length);
}
const bufferPreloadReq = xhrRequests.find((r) => r.method === 'GET' && /\/stream\//.test(r.url));
if (!bufferPreloadReq || bufferPreloadReq.url.indexOf('preload') === -1) {
  throw new Error('Buffer modal should trigger current-file preload before polling');
}
storage.cw_buffer_modal = false;
tick(1950);
console.log('buffer modal OK:', playerPlayCalls[0].position);

const deadBufferTitle = 'Smoke Dead Buffer Movie';
addMovieContinueEntry(deadBufferTitle);
const deadBufferMovie = {title: deadBufferTitle, name: deadBufferTitle};
const deadBufferRender = makeCardRender();
storage.cw_buffer_modal = true;
torrentGetResponse = {
  preloaded_bytes: 0,
  preload_size: 0,
  download_speed: 0,
  peers: 0,
};
activeActivity = {component: 'full', movie: deadBufferMovie, activity: {render: () => deadBufferRender}};
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: deadBufferMovie},
  object: activeActivity,
});
playerPlayCalls = [];
const deadBufferBtn = deadBufferRender.find('.button--continue-watch').first();
if (!deadBufferBtn.length) throw new Error('Dead-buffer continue button was not injected');
deadBufferBtn.trigger('hover:enter');
if (playerPlayCalls.length !== 0) {
  throw new Error('Dead buffer must not auto-launch player, calls=' + playerPlayCalls.length);
}
if (Lampa.Controller.controllers.cw_buffer_modal && Lampa.Controller.controllers.cw_buffer_modal.back) {
  Lampa.Controller.controllers.cw_buffer_modal.back();
}
tick(2000);
storage.cw_buffer_modal = false;
torrentGetResponse = {
  preloaded_bytes: 10,
  preload_size: 100,
  download_speed: 2048,
};
console.log('dead buffer no-autoplay OK');

const prefetchTitle = 'Smoke Prefetch Series';
addSeriesEntry(prefetchTitle, 2, 12, {
  percent: 99,
  time: 2300,
  file_index: 12,
  timestamp: Date.now() + 5000,
});
const nextPrefetchEntry = addSeriesEntry(prefetchTitle, 2, 13, {
  percent: 0,
  time: 0,
  file_index: 13,
  timestamp: Date.now() + 4000,
});
const prefetchMovie = {title: prefetchTitle, name: prefetchTitle, number_of_seasons: 2};
const cw = sandbox.window.cw;
if (!cw || typeof cw.prefetch !== 'function') throw new Error('cw.prefetch API is missing');
cw.prefetch(false);
storage.cw_buffer_pct = 5;
cw.prefetch(true, 5);
const minPrefetchState = cw.prefetch(true, 3);
if (minPrefetchState.target !== 5) {
  throw new Error('Prefetch target should not go below buffer threshold=5: ' + JSON.stringify(minPrefetchState));
}

xhrRequests = [];
const prefetchBefore = cw.prefetch().count;
const prefetchRender = makeCardRender();
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: prefetchMovie},
  object: {activity: {render: () => prefetchRender}},
});

const prefetchState = cw.prefetch();
if (prefetchState.count !== prefetchBefore + 1) {
  throw new Error(`Prefetch should start once, before=${prefetchBefore} after=${prefetchState.count}`);
}
if (prefetchState.last_index !== 13) {
  throw new Error('Prefetch should target next episode file_index=13, got ' + prefetchState.last_index);
}
if (prefetchState.last_pct !== 10 || !prefetchState.target_reached) {
  throw new Error('Prefetch polling did not update pct/reached: ' + JSON.stringify(prefetchState));
}
const preloadReq = xhrRequests.find((r) => r.method === 'GET' && /\/stream\//.test(r.url));
if (!preloadReq || preloadReq.url.indexOf('index=13') === -1 || preloadReq.url.indexOf('preload') === -1) {
  throw new Error('Prefetch preload request should use next index=13, got ' + (preloadReq && preloadReq.url));
}

xhrRequests = [];
const sameTargetRender = makeCardRender();
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: prefetchMovie},
  object: {activity: {render: () => sameTargetRender}},
});
const sameTargetState = cw.prefetch();
if (sameTargetState.count !== prefetchState.count) {
  throw new Error('Prefetch should skip same link+index after target reached');
}
if (xhrRequests.some((r) => r.method === 'GET' && /\/stream\//.test(r.url))) {
  throw new Error('Prefetch should not trigger preload again for same link+index');
}

const transitionTitleA = 'Smoke Prefetch Transition A';
const transitionTitleB = 'Smoke Prefetch Transition B';
const transitionHashA = Lampa.Utils.hash(transitionTitleA);
const transitionHashB = Lampa.Utils.hash(transitionTitleB);
const transitionLinkA = 'magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const transitionLinkB = 'magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
storage.continue_watch_params[transitionHashA] = {
  title: transitionTitleA,
  percent: 18,
  time: 180,
  duration: 2400,
  timestamp: Date.now() + 9100,
  torrent_link: transitionLinkA,
  file_name: `${transitionTitleA}.mkv`,
  file_index: 31,
};
storage.continue_watch_params[transitionHashB] = {
  title: transitionTitleB,
  percent: 36,
  time: 860,
  duration: 2400,
  timestamp: Date.now() + 9200,
  torrent_link: transitionLinkB,
  file_name: `${transitionTitleB}.mkv`,
  file_index: 32,
};
notifyContinueStorageChanged();
cw.prefetch(true, 5);

xhrRequests = [];
const transitionMovieA = {title: transitionTitleA, name: transitionTitleA};
const transitionRenderA = makeCardRender();
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: transitionMovieA},
  object: {activity: {render: () => transitionRenderA}},
});
const transitionStateA = cw.prefetch();
if (transitionStateA.last_link !== transitionLinkA || transitionStateA.last_index !== 31 || !transitionStateA.target_reached) {
  throw new Error('Card A should fill prefetch state: ' + JSON.stringify(transitionStateA));
}
const transitionPreloadA = xhrRequests.find((r) => r.method === 'GET' && /\/stream\//.test(r.url));
if (!transitionPreloadA || transitionPreloadA.url.indexOf('index=31') === -1) {
  throw new Error('Card A should preload index=31, got: ' + (transitionPreloadA && transitionPreloadA.url));
}

xhrRequests = [];
const transitionMovieB = {title: transitionTitleB, name: transitionTitleB};
const transitionRenderB = makeCardRender();
activeActivity = {component: 'full', movie: transitionMovieB, activity: {render: () => transitionRenderB}};
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: transitionMovieB},
  object: activeActivity,
});
const transitionStateB = cw.prefetch();
if (transitionStateB.last_link !== transitionLinkB || transitionStateB.last_index !== 32 || !transitionStateB.target_reached) {
  throw new Error('Card B should replace prefetch state from card A: ' + JSON.stringify(transitionStateB));
}
const transitionPreloadB = xhrRequests.find((r) => r.method === 'GET' && /\/stream\//.test(r.url));
if (!transitionPreloadB || transitionPreloadB.url.indexOf('index=32') === -1 || transitionPreloadB.url.indexOf('index=31') !== -1) {
  throw new Error('Card B should preload only index=32, got: ' + (transitionPreloadB && transitionPreloadB.url));
}

xhrRequests = [];
playerPlayCalls = [];
storage.cw_buffer_modal = true;
const transitionBtnB = transitionRenderB.find('.button--continue-watch').first();
if (!transitionBtnB.length) throw new Error('Card B continue button was not injected');
transitionBtnB.trigger('hover:enter');
tick(50);
if (playerPlayCalls.length !== 1 || playerPlayCalls[0].position !== 860) {
  throw new Error('Card B should start from saved position after ready prefetch: ' + JSON.stringify(playerPlayCalls[0]));
}
const repeatedTransitionPreload = xhrRequests.find((r) => r.method === 'GET' && /\/stream\//.test(r.url));
if (repeatedTransitionPreload) {
  throw new Error('Card B ready prefetch should not restart from 0, got: ' + repeatedTransitionPreload.url);
}
storage.cw_buffer_modal = false;
tick(1950);
console.log('prefetch card transition OK:', transitionStateA.last_index + '->' + transitionStateB.last_index);

storage.cw_buffer_pct = 20;
const upgradedOldTargetState = cw.prefetch(true, 5);
if (upgradedOldTargetState.target !== 20) {
  throw new Error('Old prefetch target=5 should be lifted to buffer threshold=20: ' + JSON.stringify(upgradedOldTargetState));
}
storage.cw_buffer_pct = 5;

const readyPrefetchTitle = 'Smoke Ready Prefetch Movie';
const readyPrefetchHash = Lampa.Utils.hash(readyPrefetchTitle);
storage.continue_watch_params[readyPrefetchHash] = {
  title: readyPrefetchTitle,
  percent: 21,
  time: 420,
  duration: 2400,
  timestamp: Date.now() + 9000,
  torrent_link: nextPrefetchEntry.torrent_link,
  file_name: `${readyPrefetchTitle} ready.mkv`,
  file_index: 13,
};
notifyContinueStorageChanged();
const readyPrefetchMovie = {title: readyPrefetchTitle, name: readyPrefetchTitle};
const readyPrefetchRender = makeCardRender();
storage.cw_buffer_modal = true;
activeActivity = {
  component: 'full',
  movie: readyPrefetchMovie,
  activity: {render: () => readyPrefetchRender},
};
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: readyPrefetchMovie},
  object: activeActivity,
});
xhrRequests = [];
playerPlayCalls = [];
const readyPrefetchBtn = readyPrefetchRender.find('.button--continue-watch').first();
if (!readyPrefetchBtn.length) throw new Error('Ready-prefetch continue button was not injected');
readyPrefetchBtn.trigger('hover:enter');
tick(50);
if (playerPlayCalls.length !== 1 || playerPlayCalls[0].position !== 420) {
  throw new Error('Ready prefetch should launch from saved position without waiting: ' + JSON.stringify(playerPlayCalls[0]));
}
const repeatedReadyPreload = xhrRequests.find((r) => r.method === 'GET' && /\/stream\//.test(r.url));
if (repeatedReadyPreload) {
  throw new Error('Ready prefetch must not restart preload for same file, got: ' + repeatedReadyPreload.url);
}
storage.cw_buffer_modal = false;
tick(1950);
console.log('ready prefetch no-restart OK');

const beforeChangedIndexCount = cw.prefetch().count;
nextPrefetchEntry.file_index = 14;
xhrRequests = [];
const changedIndexRender = makeCardRender();
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: prefetchMovie},
  object: {activity: {render: () => changedIndexRender}},
});
const changedIndexState = cw.prefetch();
if (changedIndexState.count !== beforeChangedIndexCount + 1 || changedIndexState.last_index !== 14) {
  throw new Error('Prefetch should restart when file_index changes in same torrent: ' + JSON.stringify(changedIndexState));
}
const changedIndexPreload = xhrRequests.find((r) => r.method === 'GET' && /\/stream\//.test(r.url));
if (!changedIndexPreload || changedIndexPreload.url.indexOf('index=14') === -1) {
  throw new Error('Changed-index prefetch should call preload with index=14');
}
console.log('prefetch OK:', changedIndexState.last_index, changedIndexState.last_pct + '%');

const sameTorrentBufferTitle = 'Smoke Same Torrent Buffer Movie';
const sameTorrentBufferHash = Lampa.Utils.hash(sameTorrentBufferTitle);
storage.continue_watch_params[sameTorrentBufferHash] = {
  title: sameTorrentBufferTitle,
  percent: 25,
  time: 600,
  duration: 2400,
  timestamp: Date.now() + 9000,
  torrent_link: nextPrefetchEntry.torrent_link,
  file_name: `${sameTorrentBufferTitle} S02 E15.mkv`,
  file_index: 15,
};
notifyContinueStorageChanged();
const sameTorrentBufferMovie = {title: sameTorrentBufferTitle, name: sameTorrentBufferTitle};
const sameTorrentBufferRender = makeCardRender();
storage.cw_buffer_modal = true;
sandbox.window.cw.prefetch(false);
activeActivity = {
  component: 'full',
  movie: sameTorrentBufferMovie,
  activity: {render: () => sameTorrentBufferRender},
};
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: sameTorrentBufferMovie},
  object: activeActivity,
});
xhrRequests = [];
playerPlayCalls = [];
const sameTorrentBufferBtn = sameTorrentBufferRender.find('.button--continue-watch').first();
if (!sameTorrentBufferBtn.length) throw new Error('Same-torrent buffer button was not injected');
sameTorrentBufferBtn.trigger('hover:enter');
const sameTorrentBufferPreload = xhrRequests.find((r) => r.method === 'GET' && /\/stream\//.test(r.url));
if (!sameTorrentBufferPreload || sameTorrentBufferPreload.url.indexOf('index=15') === -1) {
  throw new Error('Same-torrent buffer should preload current file index=15, got: ' + (sameTorrentBufferPreload && sameTorrentBufferPreload.url));
}
if (playerPlayCalls.length !== 1 || playerPlayCalls[0].position !== 600) {
  throw new Error('Same-torrent buffer should launch current movie at saved position: ' + JSON.stringify(playerPlayCalls[0]));
}
storage.cw_buffer_modal = false;
tick(2000);
console.log('same-torrent buffer index OK:', sameTorrentBufferPreload.url.match(/index=\d+/)[0]);

const autoNextTitle = 'Smoke AutoNext Series';
const autoNextMovie = {title: autoNextTitle, name: autoNextTitle, number_of_seasons: 1};
addSeriesEntry(autoNextTitle, 1, 1, {
  percent: 30,
  time: 700,
  file_index: 1,
  timestamp: Date.now() + 9000,
});
addSeriesEntry(autoNextTitle, 1, 2, {
  percent: 0,
  time: 0,
  file_index: 2,
  timestamp: Date.now() + 8000,
});
const autoRender = makeCardRender();
playerPlayCalls = [];
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: autoNextMovie},
  object: {activity: {render: () => autoRender}},
});
const autoBtn = autoRender.find('.button--continue-watch').first();
if (!autoBtn.length) throw new Error('Auto-next continue button was not injected');
autoBtn.trigger('hover:enter');
if (playerPlayCalls.length !== 1) throw new Error('Auto-next continue click did not start player');
tick(2000);

const h1 = seriesHash(autoNextTitle, 1, 1);
const h2 = seriesHash(autoNextTitle, 1, 2);
sendPlayerStart({
  card: autoNextMovie,
  season: 1,
  episode: 1,
  url: 'http://192.168.31.244:8090/stream/S01E01.mkv?link=magnet-one&index=1&play',
});
Lampa.Timeline.update({hash: h1, percent: 35, time: 800, duration: 2400});

sendPlayerStart({
  card: autoNextMovie,
  season: 1,
  episode: 2,
  url: 'http://192.168.31.244:8090/stream/S01E02.mkv?link=magnet-one&index=2&play',
});
Lampa.Timeline.update({hash: h2, percent: 3, time: 75, duration: 2400});

const afterAutoNext = storage.continue_watch_params[h2];
if (!afterAutoNext) throw new Error('Auto-next episode entry was not saved');
if (afterAutoNext.season !== 1 || afterAutoNext.episode !== 2) {
  throw new Error('Auto-next episode metadata was not preserved: ' + JSON.stringify(afterAutoNext));
}
if (afterAutoNext.percent !== 3 || afterAutoNext.time !== 75 || afterAutoNext.duration !== 2400) {
  throw new Error('Auto-next first timeline tick was not saved: ' + JSON.stringify(afterAutoNext));
}
if (afterAutoNext.file_index !== 2) {
  throw new Error('Auto-next player_start did not update file_index=2: ' + JSON.stringify(afterAutoNext));
}
sendPlayerDestroy();
console.log('auto-next timeline OK:', afterAutoNext.percent + '%', afterAutoNext.time + 's');

const seasonBoundaryTitle = 'Smoke Season Boundary Series';
const seasonBoundaryMovie = {title: seasonBoundaryTitle, name: seasonBoundaryTitle, number_of_seasons: 5};
const seasonBoundaryLink = 'magnet:?xt=urn:btih:cccccccccccccccccccccccccccccccccccccccc';
torserverFileStats = [
  {id: 21, path: `${seasonBoundaryTitle} S02 E21.mkv`},
  {id: 22, path: `${seasonBoundaryTitle} S02 E22.mkv`},
  {id: 23, path: `${seasonBoundaryTitle} S03 E01.mkv`},
  {id: 24, path: `${seasonBoundaryTitle} S03 E02.mkv`},
];
addSeriesEntry(seasonBoundaryTitle, 2, 22, {
  percent: 40,
  time: 900,
  file_index: 22,
  torrent_link: seasonBoundaryLink,
  file_name: `${seasonBoundaryTitle} S02 E22.mkv`,
  timestamp: Date.now() + 9500,
});
const seasonBoundaryRender = makeCardRender();
playerPlayCalls = [];
storage.cw_buffer_modal = false;
sandbox.window.cw.prefetch(false);
activeActivity = {
  component: 'full',
  movie: seasonBoundaryMovie,
  activity: {render: () => seasonBoundaryRender},
};
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: seasonBoundaryMovie},
  object: activeActivity,
});
const seasonBoundaryBtn = seasonBoundaryRender.find('.button--continue-watch').first();
if (!seasonBoundaryBtn.length) throw new Error('Season-boundary continue button was not injected');
seasonBoundaryBtn.trigger('hover:enter');
if (playerPlayCalls.length !== 1) throw new Error('Season-boundary click did not start player');
tick(2000);
const seasonBoundaryPlaylist = playerPlayCalls[0].playlist || [];
const seasonBoundaryKeys = seasonBoundaryPlaylist.map((item) => `S${item.season}E${item.episode}`);
if (!seasonBoundaryKeys.includes('S3E1')) {
  throw new Error('Playlist should include S3E1 after S2E22: ' + seasonBoundaryKeys.join(', '));
}
const s2e22Index = seasonBoundaryKeys.indexOf('S2E22');
const s3e1Index = seasonBoundaryKeys.indexOf('S3E1');
if (s2e22Index === -1 || s3e1Index === -1 || s3e1Index <= s2e22Index) {
  throw new Error('Playlist should sort by season then episode: ' + seasonBoundaryKeys.join(', '));
}
console.log('season-boundary playlist OK:', seasonBoundaryKeys.join(' -> '));

const cachedSeasonBoundaryTitle = 'Smoke Cached Season Boundary Series';
const cachedSeasonBoundaryMovie = {title: cachedSeasonBoundaryTitle, name: cachedSeasonBoundaryTitle, number_of_seasons: 5};
const cachedSeasonBoundaryLink = 'magnet:?xt=urn:btih:dddddddddddddddddddddddddddddddddddddddd';
const cachedSeasonBoundaryFiles = [
  {id: 41, path: `${cachedSeasonBoundaryTitle} S02 E21.mkv`},
  {id: 42, path: `${cachedSeasonBoundaryTitle} S02 E22.mkv`},
  {id: 43, path: `${cachedSeasonBoundaryTitle} S03 E01.mkv`},
  {id: 44, path: `${cachedSeasonBoundaryTitle} S03 E02.mkv`},
];
addSeriesEntry(cachedSeasonBoundaryTitle, 2, 22, {
  percent: 40,
  time: 900,
  file_index: 42,
  torrent_link: cachedSeasonBoundaryLink,
  file_name: `${cachedSeasonBoundaryTitle} S02 E22.mkv`,
  timestamp: Date.now() + 9600,
});
sandbox.window.cw.state.files[cachedSeasonBoundaryLink] = cachedSeasonBoundaryFiles;
const cachedSeasonBoundaryRender = makeCardRender();
playerPlayCalls = [];
activeActivity = {
  component: 'full',
  movie: cachedSeasonBoundaryMovie,
  activity: {render: () => cachedSeasonBoundaryRender},
};
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: cachedSeasonBoundaryMovie},
  object: activeActivity,
});
const cachedSeasonBoundaryBtn = cachedSeasonBoundaryRender.find('.button--continue-watch').first();
if (!cachedSeasonBoundaryBtn.length) throw new Error('Cached season-boundary continue button was not injected');
cachedSeasonBoundaryBtn.trigger('hover:enter');
if (playerPlayCalls.length !== 1) throw new Error('Cached season-boundary click did not start player');
tick(2000);
const cachedSeasonBoundaryKeys = (playerPlayCalls[0].playlist || []).map((item) => `S${item.season}E${item.episode}`);
if (!cachedSeasonBoundaryKeys.includes('S3E1')) {
  throw new Error('Cached playlist should include S3E1 after S2E22: ' + cachedSeasonBoundaryKeys.join(', '));
}
const cachedS2E22Index = cachedSeasonBoundaryKeys.indexOf('S2E22');
const cachedS3E1Index = cachedSeasonBoundaryKeys.indexOf('S3E1');
if (cachedS2E22Index === -1 || cachedS3E1Index === -1 || cachedS3E1Index <= cachedS2E22Index) {
  throw new Error('Cached playlist should sort by season then episode: ' + cachedSeasonBoundaryKeys.join(', '));
}
console.log('cached season-boundary playlist OK:', cachedSeasonBoundaryKeys.join(' -> '));

const duplicateTitle = 'Smoke Duplicate Series';
addSeriesEntry(duplicateTitle, 2, 4, {
  percent: 93,
  time: 2200,
  file_index: 4,
  timestamp: Date.now() + 9000,
});
const staleDupHash = 'manual-stale-duplicate-s2e5';
storage.continue_watch_params[staleDupHash] = {
  title: duplicateTitle,
  season: 2,
  episode: 5,
  percent: 10,
  time: 100,
  duration: 2400,
  file_index: 5,
  file_name: `${duplicateTitle} S02 E05 stale.mkv`,
  torrent_link: 'magnet:?xt=urn:btih:abcdefabcdefabcdefabcdefabcdefabcdefabcd',
  timestamp: Date.now() + 1000,
};
addSeriesEntry(duplicateTitle, 2, 5, {
  percent: 0,
  time: 0,
  file_index: 55,
  file_name: `${duplicateTitle} S02 E05 fresh.mkv`,
  timestamp: Date.now() + 8000,
});
notifyContinueStorageChanged();
const duplicateRender = makeCardRender();
const duplicateMovie = {title: duplicateTitle, name: duplicateTitle, number_of_seasons: 2};
activeActivity = {component: 'full', movie: duplicateMovie, activity: {render: () => duplicateRender}};
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: duplicateMovie},
  object: activeActivity,
});
const duplicateState = sandbox.window.cw.inspect();
if (!duplicateState.target || !duplicateState.target.next || duplicateState.target.next.file_index !== 55) {
  throw new Error('Duplicate episode lookup should prefer latest S2E5 entry: ' + JSON.stringify(duplicateState.target));
}
console.log('duplicate episode lookup OK:', duplicateState.target.next.file_index);

// =========================================================================
// REGRESSION: v151 — кнопка «Продолжить» показывала позицию из прошлого
// захода (Lampa.Timeline кешировал старое значение даже после того как
// syncEntryFromFileView записал свежее) и карточка отрисовывалась 2-3 раза.
// =========================================================================

const staleTimelineTitle = 'Smoke Stale Timeline Movie';
const staleTimelineHash = Lampa.Utils.hash(staleTimelineTitle);
storage.continue_watch_params[staleTimelineHash] = {
  title: staleTimelineTitle,
  percent: 72,
  time: 3120,
  duration: 4200,
  timestamp: Date.now() + 12000,
  torrent_link: 'magnet:?xt=urn:btih:9999999999999999999999999999999999999999',
  file_name: 'Stale Timeline.mkv',
  file_index: 0,
};
timelineStore[staleTimelineHash] = {
  hash: staleTimelineHash,
  percent: 25,
  time: 800,
  duration: 4200,
};
notifyContinueStorageChanged();
const staleTimelineMovie = {title: staleTimelineTitle, name: staleTimelineTitle};
const staleTimelineRender = makeCardRender();
activeActivity = {component: 'full', movie: staleTimelineMovie, activity: {render: () => staleTimelineRender}};
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: staleTimelineMovie},
  object: activeActivity,
});
const staleTimelineBtn = staleTimelineRender.find('.button--continue-watch').first();
if (!staleTimelineBtn.length) throw new Error('Stale-timeline continue button was not injected');
const staleTimelineLabel = staleTimelineBtn.nodes[0].html || '';
if (staleTimelineLabel.indexOf('52:00') === -1) {
  throw new Error('Continue button must use fresh params time (52:00), not stale Lampa.Timeline cache, got: ' + staleTimelineLabel);
}
console.log('stale timeline ignored OK: button shows 52:00 (params), not Lampa cache');

// =========================================================================
// REGRESSION: v151 — повторные full:complite события должны быть идемпотентны.
// Если данные не изменились, не пересоздаём кнопку, чтобы Lampa.Controller
// не дёргал фокус (раньше курсор скакал между Продолжить и Смотреть).
// =========================================================================

const idempotentTitle = 'Smoke Idempotent Card';
addMovieContinueEntry(idempotentTitle);
const idempotentMovie = {title: idempotentTitle, name: idempotentTitle};
const idempotentRender = makeCardRender();
activeActivity = {component: 'full', movie: idempotentMovie, activity: {render: () => idempotentRender}};

const buttonsBefore = idempotentRender.find('.button--continue-watch').length;
if (buttonsBefore !== 0) throw new Error('Idempotent render must start with no Continue button');
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: idempotentMovie},
  object: activeActivity,
});
const buttonsAfterFirst = idempotentRender.find('.button--continue-watch').length;
if (buttonsAfterFirst !== 1) {
  throw new Error('First full:complite must inject exactly one Continue button, got ' + buttonsAfterFirst);
}
const firstSignature = idempotentRender.find('.button--continue-watch').nodes[0].cwSig;
if (!firstSignature) throw new Error('Continue button must expose cwSig signature for dedup');

for (let i = 0; i < 3; i++) {
  Lampa.Listener.send('full', {
    type: 'complite',
    data: {movie: idempotentMovie},
    object: activeActivity,
  });
}
const buttonsAfterRepeat = idempotentRender.find('.button--continue-watch').length;
if (buttonsAfterRepeat !== 1) {
  throw new Error('Repeated identical full:complite events must NOT duplicate the button, got ' + buttonsAfterRepeat);
}
const repeatSignature = idempotentRender.find('.button--continue-watch').nodes[0].cwSig;
if (repeatSignature !== firstSignature) {
  throw new Error('Dedup must keep the same button instance, signatures differ: ' + firstSignature + ' vs ' + repeatSignature);
}
console.log('idempotent button render OK: sig=' + firstSignature);

const menuFocusBtn = idempotentRender.find('.button--continue-watch').first();
Lampa.Controller.collectionFocus(menuFocusBtn[0], idempotentRender);
Lampa.Controller.toggle('menu');
menuFocusBtn.removeClass('focus');
focusedNode = null;
Lampa.Controller.toggle('content');
tick(0);
if (!idempotentRender.find('.button--continue-watch').first().hasClass('focus')) {
  throw new Error('Continue button focus must be restored after returning from menu');
}
playerPlayCalls = [];
idempotentRender.find('.button--continue-watch').first().trigger('hover:enter');
if (playerPlayCalls.length !== 1) {
  throw new Error('Continue button must start playback after returning from menu');
}
tick(2000);
console.log('menu return focus restore OK');

// =========================================================================
// REGRESSION: v151 — file_view обновляется ВНЕ привязки к S.last_player_hash
// (например после рестарта Lampa, или когда внешний плеер не вызвал
// player.destroy). syncAllKnownFileViewEntries должен подтянуть новое время.
// =========================================================================

const bulkSyncTitle = 'Smoke Bulk FileView Sync';
const bulkSyncHash = Lampa.Utils.hash(bulkSyncTitle);
storage.continue_watch_params[bulkSyncHash] = {
  title: bulkSyncTitle,
  percent: 12,
  time: 240,
  duration: 3600,
  timestamp: Date.now() + 15000,
  torrent_link: 'magnet:?xt=urn:btih:8888888888888888888888888888888888888888',
  file_name: 'Bulk Sync.mkv',
  file_index: 0,
};
notifyContinueStorageChanged();
const bulkSyncMovie = {title: bulkSyncTitle, name: bulkSyncTitle};
const bulkSyncRender = makeCardRender();
activeActivity = {component: 'full', movie: bulkSyncMovie, activity: {render: () => bulkSyncRender}};
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: bulkSyncMovie},
  object: activeActivity,
});

// Simulate restart: clear all session/player tracking, like cold-boot of Lampa.
// On real device this happens when Lampa is killed and re-opened, or when the
// external player (ViMu) didn't trigger Lampa.Player.listener('destroy').
const cwStateForReset = sandbox.window.cw && sandbox.window.cw.state;
if (cwStateForReset) {
  cwStateForReset.last_player_hash = null;
  cwStateForReset.session_play_hash = null;
  cwStateForReset.last_player_card = null;
  cwStateForReset.session_play_card = null;
  cwStateForReset.last_launched_card = bulkSyncMovie;
}
storage.file_view_756763 = Object.assign({}, storage.file_view_756763 || {}, {
  [bulkSyncHash]: {
    hash: bulkSyncHash,
    percent: 88,
    time: 3168,
    duration: 3600,
  },
});
Lampa.Storage.set('file_view_756763', storage.file_view_756763);
const bulkSyncedEntry = storage.continue_watch_params[bulkSyncHash];
if (!bulkSyncedEntry || bulkSyncedEntry.time !== 3168 || bulkSyncedEntry.percent !== 88) {
  throw new Error('Bulk file_view sync must update params even without S.last_player_hash: ' + JSON.stringify(bulkSyncedEntry));
}
console.log('bulk file_view sync OK:', bulkSyncedEntry.percent + '% / ' + bulkSyncedEntry.time + 's');

// =========================================================================
// REGRESSION: stale file_view after watching another episode must NOT
// bump the timestamp of the old episode above the new one.
// Scenario: user watched E6 (40%), then E5 external player sends a late
// file_view with 79% (was 80%). Without the fix this would update E5's
// timestamp to "now", making findStreamParams return E5 instead of E6.
// =========================================================================
const staleViewTitle = 'Smoke Stale FileView Series';
const staleViewNow = Date.now() + 17000;
addSeriesEntry(staleViewTitle, 1, 5, {
  percent: 100,
  time: 3000,
  duration: 3000,
  timestamp: staleViewNow - 5000,
});
addSeriesEntry(staleViewTitle, 1, 6, {
  percent: 40,
  time: 1200,
  duration: 3000,
  timestamp: staleViewNow,
});
const staleViewHash5 = seriesHash(staleViewTitle, 1, 5);
const staleViewHash6 = seriesHash(staleViewTitle, 1, 6);
const tsE5Before = storage.continue_watch_params[staleViewHash5].timestamp;
const tsE6Before = storage.continue_watch_params[staleViewHash6].timestamp;
// Simulate a stale external-player update for E5 with slightly regressed percent.
storageSetCalls = [];
storage.file_view = Object.assign(storage.file_view || {}, {
  [staleViewHash5]: {hash: staleViewHash5, percent: 99, time: 2950, duration: 3000},
});
Lampa.Storage.set('file_view', storage.file_view);
const tsE5After = storage.continue_watch_params[staleViewHash5].timestamp;
const tsE6After = storage.continue_watch_params[staleViewHash6].timestamp;
if (tsE5After !== tsE5Before) {
  throw new Error('Stale file_view (regression) must NOT bump E5 timestamp: before=' + tsE5Before + ' after=' + tsE5After);
}
if (tsE6After !== tsE6Before) {
  throw new Error('Stale file_view must NOT touch E6 timestamp at all: before=' + tsE6Before + ' after=' + tsE6After);
}
const staleViewParamWrites = storageSetCalls.filter((call) => call.key === 'continue_watch_params').length;
if (staleViewParamWrites < 1) {
  throw new Error('Stale file_view changed fields must still be persisted without bumping timestamp');
}
// findStreamParams must still prefer E6 (newer timestamp).
const staleViewMovie = {title: staleViewTitle, name: staleViewTitle, number_of_seasons: 1};
const staleViewRender = makeCardRender();
activeActivity = {component: 'full', movie: staleViewMovie, activity: {render: () => staleViewRender}};
Lampa.Listener.send('full', {type: 'complite', data: {movie: staleViewMovie}, object: activeActivity});
const staleViewResult = sandbox.window.cw.inspect();
if (!staleViewResult.target || !staleViewResult.target.current || staleViewResult.target.current.episode !== 6) {
  throw new Error('After stale file_view update E6 must still win findStreamParams, got: ' + JSON.stringify(staleViewResult.target && staleViewResult.target.current));
}
console.log('stale file_view timestamp guard OK: E6 still wins after stale E5 update');

// =========================================================================
// REGRESSION: exit-summary должен брать название из записи по hash, а не из
// stale card от предыдущего сериала (Хирург -> Оффлайн).
// =========================================================================

const staleSummaryOldMovie = {title: 'Хирург', name: 'Хирург', number_of_seasons: 1};
const staleSummaryNewTitle = 'Оффлайн';
const staleSummaryHash = seriesHash(staleSummaryNewTitle, 1, 1);
addSeriesEntry(staleSummaryNewTitle, 1, 1, {
  percent: 12,
  time: 320,
  duration: 3180,
  timestamp: Date.now() + 16000,
});
const stateForStaleSummary = sandbox.window.cw.state;
stateForStaleSummary.last_player_hash = staleSummaryHash;
stateForStaleSummary.last_player_card = staleSummaryOldMovie;
stateForStaleSummary.session_play_hash = null;
stateForStaleSummary.session_play_card = null;
stateForStaleSummary.last_launched_card = staleSummaryOldMovie;

const oldSetTimeout = sandbox.setTimeout;
const oldWindowSetTimeout = sandbox.window.setTimeout;
sandbox.setTimeout = sandbox.window.setTimeout = function (fn) {
  fn();
  return 0;
};
const notiesBeforeSummary = noties.length;
sendPlayerDestroy();
sandbox.setTimeout = oldSetTimeout;
sandbox.window.setTimeout = oldWindowSetTimeout;

const summaryNoty = noties.slice(notiesBeforeSummary).join(' | ');
if (summaryNoty.indexOf(staleSummaryNewTitle) === -1 || summaryNoty.indexOf('Хирург') !== -1) {
  throw new Error('Exit summary must use saved entry title, not stale card title: ' + summaryNoty);
}
console.log('stale exit-summary title OK:', summaryNoty);

// =========================================================================
// REGRESSION: обычный запуск через Lampa.Player.play ("Смотреть" / файлы)
// должен поднимать timestamp выбранного эпизода. Иначе после перезапуска
// findStreamParams может вернуть предыдущий сохранённый эпизод.
// =========================================================================

const nativeLaunchTitle = 'Smoke Native Launch Series';
addSeriesEntry(nativeLaunchTitle, 1, 7, {
  percent: 60,
  time: 1200,
  file_index: 7,
  timestamp: 1_700_000_010_000,
});
addSeriesEntry(nativeLaunchTitle, 1, 8, {
  percent: 20,
  time: 500,
  file_index: 8,
  timestamp: 1_700_000_000_000,
});
const nativeLaunchMovie = {title: nativeLaunchTitle, name: nativeLaunchTitle, number_of_seasons: 1};
const nativeHash7 = seriesHash(nativeLaunchTitle, 1, 7);
const nativeHash8 = seriesHash(nativeLaunchTitle, 1, 8);
timelineStore[nativeHash8] = {hash: nativeHash8, percent: 20, time: 500, duration: 2400};
playerPlayCalls = [];
Lampa.Player.play({
  card: nativeLaunchMovie,
  season: 1,
  episode: 8,
  title: 'S1 E8',
  timeline: timelineStore[nativeHash8],
  torrent_hash: storage.continue_watch_params[nativeHash8].torrent_link,
  url: 'http://192.168.31.244:8090/stream/Native%20S01E08.mkv?link=magnet-native&index=8&play',
});
const nativeTs7 = storage.continue_watch_params[nativeHash7].timestamp;
const nativeTs8 = storage.continue_watch_params[nativeHash8].timestamp;
if (!(nativeTs8 > nativeTs7)) {
  throw new Error('Native Lampa.Player.play must touch launched episode timestamp: e8=' + nativeTs8 + ' e7=' + nativeTs7);
}
const nativeRender = makeCardRender();
activeActivity = {component: 'full', movie: nativeLaunchMovie, activity: {render: () => nativeRender}};
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: nativeLaunchMovie},
  object: activeActivity,
});
const nativeState = sandbox.window.cw.inspect(nativeLaunchTitle);
if (!nativeState.target || !nativeState.target.current || nativeState.target.current.episode !== 8) {
  throw new Error('After native launch latest continue target must be S1E8: ' + JSON.stringify(nativeState.target));
}
console.log('native player launch touch OK: S1E8 wins latest target');

// =========================================================================
// REGRESSION: season > 10 должен использовать тот же hash, что Lampa Timeline.
// Последний refactor добавлял ":" в generateHash для S11+, из-за чего
// Player.play создавал запись с metadata под одним hash, а Timeline.update
// писал прогресс под другим hash-стабом без season/episode.
// =========================================================================
const nativeHighSeasonTitle = 'Smoke Native High Season';
const nativeHighSeasonMovie = {title: nativeHighSeasonTitle, name: nativeHighSeasonTitle, number_of_seasons: 12};
const nativeHighSeasonHash = seriesHash(nativeHighSeasonTitle, 11, 2);
const nativeHighSeasonLegacyHash = Lampa.Utils.hash([11, 2, nativeHighSeasonTitle].join(''));
delete storage.continue_watch_params[nativeHighSeasonHash];
delete storage.continue_watch_params[nativeHighSeasonLegacyHash];
playerPlayCalls = [];
Lampa.Player.play({
  card: nativeHighSeasonMovie,
  season: 11,
  episode: 2,
  title: 'S11 E2',
  torrent_hash: 'magnet:?xt=urn:btih:1111111111111111111111111111111111111111',
  url: 'http://192.168.31.244:8090/stream/Native%20S11E02.mkv?link=magnet-high-season&index=112&play',
});
Lampa.Timeline.update({hash: nativeHighSeasonHash, percent: 15, time: 360, duration: 2400});
const nativeHighSeasonEntry = storage.continue_watch_params[nativeHighSeasonHash];
qaAssert(
  nativeHighSeasonEntry && nativeHighSeasonEntry.season === 11 && nativeHighSeasonEntry.episode === 2,
  'S11E2 progress must use official colon hash with metadata: ' + JSON.stringify(nativeHighSeasonEntry)
);
qaAssert(
  nativeHighSeasonEntry && nativeHighSeasonEntry.percent === 15 && nativeHighSeasonEntry.time === 360,
  'S11E2 timeline progress must remain on official colon hash: ' + JSON.stringify(nativeHighSeasonEntry)
);
qaAssert(
  !storage.continue_watch_params[nativeHighSeasonLegacyHash],
  'S11E2 must not create legacy no-colon duplicate: ' + JSON.stringify(storage.continue_watch_params[nativeHighSeasonLegacyHash])
);
console.log('native high-season hash contract checked');

// =========================================================================
// REGRESSION: обычный запуск из списка файлов Lampa может прийти без
// season/episode, но с S01E06 в stream URL. В таком случае нельзя сохранять
// прогресс как "фильм" по hash(title), иначе кнопка продолжит старую серию.
// =========================================================================
const nativeFileListTitle = 'Smoke Native File List Series';
const nativeFileListMovie = {title: nativeFileListTitle, name: nativeFileListTitle, number_of_seasons: 1};
const nativeFileListHash = seriesHash(nativeFileListTitle, 1, 6);
const nativeFileListMovieHash = Lampa.Utils.hash(nativeFileListTitle);
delete storage.continue_watch_params[nativeFileListHash];
delete storage.continue_watch_params[nativeFileListMovieHash];
playerPlayCalls = [];
Lampa.Player.play({
  card: nativeFileListMovie,
  title: '6 эпизод',
  torrent_hash: 'magnet:?xt=urn:btih:2222222222222222222222222222222222222222',
  url: 'http://192.168.31.244:8090/stream/If.Wishes.Could.Kill.S01E06.CF.Episode.6.avi?link=magnet-file-list&index=6&play',
});
const nativeFileListPlay = playerPlayCalls[playerPlayCalls.length - 1];
if (nativeFileListPlay.season !== 1 || nativeFileListPlay.episode !== 6) {
  throw new Error('Native file-list play must infer S1E6 from stream URL: ' + JSON.stringify(nativeFileListPlay));
}
if (!nativeFileListPlay.timeline || nativeFileListPlay.timeline.hash !== nativeFileListHash) {
  throw new Error('Native file-list play must force episode timeline hash: ' + JSON.stringify(nativeFileListPlay.timeline));
}
Lampa.Timeline.update({hash: nativeFileListHash, percent: 85, time: 2595, duration: 3028});
const nativeFileListEntry = storage.continue_watch_params[nativeFileListHash];
if (!nativeFileListEntry || nativeFileListEntry.season !== 1 || nativeFileListEntry.episode !== 6) {
  throw new Error('Native file-list progress must be saved as S1E6 entry: ' + JSON.stringify(nativeFileListEntry));
}
if (nativeFileListEntry.percent !== 85 || nativeFileListEntry.time !== 2595) {
  throw new Error('Native file-list S1E6 progress was not saved correctly: ' + JSON.stringify(nativeFileListEntry));
}
if (storage.continue_watch_params[nativeFileListMovieHash]) {
  throw new Error('Native file-list must not create movie entry for a series: ' + JSON.stringify(storage.continue_watch_params[nativeFileListMovieHash]));
}
console.log('native file-list episode inference OK');

// =========================================================================
// REGRESSION: v151 — launchPlayer должен сразу повышать timestamp выбранного
// эпизода, чтобы findStreamParams возвращал его, а не sibling-эпизод
// со случайно более свежим timestamp'ом.
// =========================================================================

// Реальный кейс из бага: пользователь запускает S1E1, дальше syncFromFileView
// или другой источник «случайно» помечает S1E2 более свежим timestamp'ом
// (например, stub из loadEpisodesPlaylist предыдущего захода, или
// flushHashFromTimeline после авто-next). После рестарта findStreamParams
// должен по-прежнему отдавать запущенный эпизод (S1E1), а не S1E2.
const launchTouchTitle = 'Smoke Launch Touch Series';
addSeriesEntry(launchTouchTitle, 1, 1, {
  percent: 30,
  time: 500,
  file_index: 1,
  timestamp: 1_700_000_000_000,
});
addSeriesEntry(launchTouchTitle, 1, 2, {
  percent: 0,
  time: 0,
  file_index: 2,
  // Имитируем stub-запись из loadEpisodesPlaylist'а предыдущего захода:
  // у неё свежее timestamp, хотя юзер её фактически не смотрел.
  timestamp: 1_700_000_001_000,
});
const launchTouchMovie = {title: launchTouchTitle, name: launchTouchTitle, number_of_seasons: 1};
const launchTouchRender = makeCardRender();
storage.cw_buffer_modal = false;
sandbox.window.cw.prefetch(false);
activeActivity = {component: 'full', movie: launchTouchMovie, activity: {render: () => launchTouchRender}};
Lampa.Listener.send('full', {
  type: 'complite',
  data: {movie: launchTouchMovie},
  object: activeActivity,
});
const launchedHash1 = seriesHash(launchTouchTitle, 1, 1);
const launchedHash2 = seriesHash(launchTouchTitle, 1, 2);
playerPlayCalls = [];
sandbox.window.cw.state.last_player_hash = null;
sandbox.window.cw.state.session_play_hash = null;
const launchTouchTargetBtn = launchTouchRender.find('.button--continue-watch').first();
if (!launchTouchTargetBtn.length) throw new Error('Launch-touch button missing');
launchTouchTargetBtn.trigger('hover:enter');
if (playerPlayCalls.length !== 1) throw new Error('Launch-touch click did not start player');
const launchedEpisode = playerPlayCalls[0].episode;
const launchedHash = seriesHash(launchTouchTitle, 1, launchedEpisode);
const otherHash = launchedEpisode === 1 ? launchedHash2 : launchedHash1;
const launchedTs = storage.continue_watch_params[launchedHash].timestamp;
const otherTs = storage.continue_watch_params[otherHash].timestamp;
if (!(launchedTs > otherTs)) {
  throw new Error('Launched episode (S1E' + launchedEpisode + ') timestamp must be > sibling after launchPlayer: launched=' + launchedTs + ' other=' + otherTs);
}
tick(2000);
console.log('launch touch OK: launched S1E' + launchedEpisode + ' wins findStreamParams (ts ' + launchedTs + ' > ' + otherTs + ')');

// =========================================================================
// REGRESSION: equal timestamp → compareParams fallback (season/episode/percent)
// =========================================================================
const eqTsTitle = 'Smoke EqualTs Series';
const eqTsNow = Date.now() + 90000;
// Three episodes with the identical timestamp: S1E3 (highest episode) must win.
addSeriesEntry(eqTsTitle, 1, 1, {percent: 80, time: 2400, duration: 3000, timestamp: eqTsNow});
addSeriesEntry(eqTsTitle, 1, 3, {percent: 10, time: 300, duration: 3000, timestamp: eqTsNow});
addSeriesEntry(eqTsTitle, 1, 2, {percent: 50, time: 1500, duration: 3000, timestamp: eqTsNow});
const eqTsMovie = {title: eqTsTitle, name: eqTsTitle, number_of_seasons: 1};
const eqTsRender = makeCardRender();
activeActivity = {component: 'full', movie: eqTsMovie, activity: {render: () => eqTsRender}};
Lampa.Listener.send('full', {type: 'complite', data: {movie: eqTsMovie}, object: activeActivity});
const eqTsResult = sandbox.window.cw.inspect();
if (!eqTsResult.target || !eqTsResult.target.current || eqTsResult.target.current.episode !== 3) {
  throw new Error('Equal timestamp: highest episode (S1E3) must win, got: ' + JSON.stringify(eqTsResult.target && eqTsResult.target.current));
}

// Same timestamp, same episode, higher percent must win (two hash collisions for same ep).
// Since hashes are keyed per season/episode combination, duplicate hashes overwrite
// each other — so we verify via direct findStreamParams comparison at inject time.
// Render a fresh card for a different title to confirm button label picks correct episode.
const eqTsHiTitle = 'Smoke EqualTs Higher Episode';
const eqTsHiNow = Date.now() + 91000;
// S1E2 added first then S1E5 — both same timestamp. Button must show E5.
addSeriesEntry(eqTsHiTitle, 1, 2, {percent: 70, time: 2100, duration: 3000, timestamp: eqTsHiNow});
addSeriesEntry(eqTsHiTitle, 1, 5, {percent: 20, time: 600, duration: 3000, timestamp: eqTsHiNow});
const eqTsHiMovie = {title: eqTsHiTitle, name: eqTsHiTitle, number_of_seasons: 1};
const eqTsHiRender = makeCardRender();
activeActivity = {component: 'full', movie: eqTsHiMovie, activity: {render: () => eqTsHiRender}};
Lampa.Listener.send('full', {type: 'complite', data: {movie: eqTsHiMovie}, object: activeActivity});
const eqTsHiBtn = eqTsHiRender.find('.button--continue-watch').first();
if (!eqTsHiBtn.length) throw new Error('EqualTs-hi button not injected');
const eqTsHiResult = sandbox.window.cw.inspect();
if (!eqTsHiResult.target || !eqTsHiResult.target.current || eqTsHiResult.target.current.episode !== 5) {
  throw new Error('Equal timestamp: higher episode (S1E5 over S1E2) must win, got: ' + JSON.stringify(eqTsHiResult.target && eqTsHiResult.target.current));
}

const eqTsPctTitle = 'Smoke EqualTs Higher Percent';
const eqTsPctNow = Date.now() + 92000;
storage.continue_watch_params['manual-eq-pct-low'] = {
  title: eqTsPctTitle,
  season: 1,
  episode: 4,
  percent: 20,
  time: 600,
  duration: 3000,
  file_index: 4,
  file_name: `${eqTsPctTitle} low.mkv`,
  torrent_link: 'magnet:?xt=urn:btih:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  timestamp: eqTsPctNow,
};
storage.continue_watch_params['manual-eq-pct-high'] = {
  title: eqTsPctTitle,
  season: 1,
  episode: 4,
  percent: 90,
  time: 2700,
  duration: 3000,
  file_index: 44,
  file_name: `${eqTsPctTitle} high.mkv`,
  torrent_link: 'magnet:?xt=urn:btih:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  timestamp: eqTsPctNow,
};
sandbox.window.cw.state.mem = null;
const eqTsPctMovie = {title: eqTsPctTitle, name: eqTsPctTitle, number_of_seasons: 1};
const eqTsPctRender = makeCardRender();
activeActivity = {component: 'full', movie: eqTsPctMovie, activity: {render: () => eqTsPctRender}};
Lampa.Listener.send('full', {type: 'complite', data: {movie: eqTsPctMovie}, object: activeActivity});
const eqTsPctResult = sandbox.window.cw.inspect();
if (!eqTsPctResult.target || !eqTsPctResult.target.current || eqTsPctResult.target.current.percent !== 90) {
  throw new Error('Equal timestamp/episode: higher percent must win, got: ' + JSON.stringify(eqTsPctResult.target && eqTsPctResult.target.current));
}
console.log('equal timestamp tiebreak OK');

// =========================================================================
// REGRESSION: online_mod playback must not save progress into the previous
// torrent entry. online_mod calls Lampa.Player.play without torrent_hash and
// often without card; cw must pick active full-card, save source=online, and
// render Continue for that card using the online URL.
// =========================================================================
const previousTorrentTitle = 'Smoke Previous Torrent Movie';
const previousTorrentHash = addMovieContinueEntry(previousTorrentTitle);
const previousTorrentBefore = Object.assign({}, storage.continue_watch_params[previousTorrentHash]);
const onlineMovieTitle = 'Smoke Online Movie';
const onlineMovieHash = Lampa.Utils.hash(onlineMovieTitle);
const onlineMovie = {title: onlineMovieTitle, name: onlineMovieTitle, original_title: onlineMovieTitle};
const onlineMovieUrl = 'https://online.example/video/movie-720.m3u8';
delete storage.continue_watch_params[onlineMovieHash];
activeActivity = {component: 'full', movie: onlineMovie};
sandbox.window.cw.state.last_player_hash = previousTorrentHash;
sandbox.window.cw.state.last_player_card = {title: previousTorrentTitle, name: previousTorrentTitle};
playerPlayCalls = [];
Lampa.Player.play({
  url: onlineMovieUrl,
  timeline: {hash: onlineMovieHash},
  title: onlineMovieTitle,
});
Lampa.Timeline.update({hash: onlineMovieHash, percent: 42, time: 840, duration: 2000});
sendPlayerDestroy();
const previousTorrentAfter = storage.continue_watch_params[previousTorrentHash];
if (previousTorrentAfter.time !== previousTorrentBefore.time || previousTorrentAfter.percent !== previousTorrentBefore.percent) {
  throw new Error('Online playback must not overwrite previous torrent entry: before=' + JSON.stringify(previousTorrentBefore) + ' after=' + JSON.stringify(previousTorrentAfter));
}
const onlineMovieEntry = storage.continue_watch_params[onlineMovieHash];
if (!onlineMovieEntry || onlineMovieEntry.source !== 'online' || onlineMovieEntry.online_url !== onlineMovieUrl) {
  throw new Error('Online movie entry was not saved with source/url: ' + JSON.stringify(onlineMovieEntry));
}
if (onlineMovieEntry.torrent_link || onlineMovieEntry.file_name) {
  throw new Error('Online movie entry must not keep torrent fields: ' + JSON.stringify(onlineMovieEntry));
}
const onlineMovieRender = makeCardRender();
activeActivity = {component: 'full', movie: onlineMovie, activity: {render: () => onlineMovieRender}};
Lampa.Listener.send('full', {type: 'complite', data: {movie: onlineMovie}, object: activeActivity});
const onlineMovieBtn = onlineMovieRender.find('.button--continue-watch').first();
if (!onlineMovieBtn.length) throw new Error('Online movie Continue button was not injected');
playerPlayCalls = [];
onlineMovieBtn.trigger('hover:enter');
if (playerPlayCalls.length !== 1 || playerPlayCalls[0].url !== onlineMovieUrl || playerPlayCalls[0].torrent_hash) {
  throw new Error('Online movie Continue must launch online URL without torrent_hash: ' + JSON.stringify(playerPlayCalls[0]));
}
tick(2000);
console.log('online movie source isolation OK');

const onlineSeriesTitle = 'Smoke Online Series';
const onlineSeriesMovie = {
  title: onlineSeriesTitle,
  name: onlineSeriesTitle,
  original_title: onlineSeriesTitle,
  number_of_seasons: 1,
};
const onlineSeriesHash = seriesHash(onlineSeriesTitle, 1, 3);
const onlineSeriesUrl = 'https://online.example/video/s01e03.m3u8';
delete storage.continue_watch_params[onlineSeriesHash];
activeActivity = {component: 'full', movie: onlineSeriesMovie};
playerPlayCalls = [];
Lampa.Player.play({
  url: onlineSeriesUrl,
  timeline: {hash: onlineSeriesHash},
  title: 'S1 E3',
});
Lampa.Timeline.update({hash: onlineSeriesHash, percent: 33, time: 990, duration: 3000});
sendPlayerDestroy();
const onlineSeriesEntry = storage.continue_watch_params[onlineSeriesHash];
if (!onlineSeriesEntry || onlineSeriesEntry.source !== 'online' || onlineSeriesEntry.season !== 1 || onlineSeriesEntry.episode !== 3) {
  throw new Error('Online series metadata was not saved: ' + JSON.stringify(onlineSeriesEntry));
}
const onlineSeriesRender = makeCardRender();
activeActivity = {component: 'full', movie: onlineSeriesMovie, activity: {render: () => onlineSeriesRender}};
Lampa.Listener.send('full', {type: 'complite', data: {movie: onlineSeriesMovie}, object: activeActivity});
const onlineSeriesBtn = onlineSeriesRender.find('.button--continue-watch').first();
if (!onlineSeriesBtn.length) throw new Error('Online series Continue button was not injected');
if ((onlineSeriesBtn.nodes[0].html || '').indexOf('S1 E3') === -1) {
  throw new Error('Online series Continue label should show S1 E3: ' + (onlineSeriesBtn.nodes[0].html || ''));
}
playerPlayCalls = [];
onlineSeriesBtn.trigger('hover:enter');
if (playerPlayCalls.length !== 1 || playerPlayCalls[0].url !== onlineSeriesUrl || playerPlayCalls[0].torrent_hash) {
  throw new Error('Online series Continue must launch online URL without torrent_hash: ' + JSON.stringify(playerPlayCalls[0]));
}
tick(2000);
console.log('online series Continue OK');

// =========================================================================
// REGRESSION: active progress must be persisted silently every 30 seconds and
// immediately when Android/WebView sends the app to background (Home button).
// =========================================================================
const checkpointTitle = 'Smoke Background Checkpoint';
const checkpointHash = addMovieContinueEntry(checkpointTitle);
const checkpointMovie = {title: checkpointTitle, name: checkpointTitle};
sandbox.window.cw.state.last_player_hash = null;
sandbox.window.cw.state.last_player_card = null;
sandbox.window.cw.state.session_play_hash = checkpointHash;
sandbox.window.cw.state.session_play_card = checkpointMovie;
timelineStore[checkpointHash] = {
  hash: checkpointHash,
  percent: 48,
  time: 1440,
  duration: 3000,
};
storage.file_view = Object.assign({}, storage.file_view || {}, {
  [checkpointHash]: {
    hash: checkpointHash,
    percent: 20,
    time: 600,
    duration: 3000,
  },
});
storageSetCalls = [];
const notiesBeforeCheckpoint = noties.length;
const checkpointInterval = intervalCalls.find((item) => item.ms === 30000);
if (!checkpointInterval) throw new Error('30-second progress checkpoint interval was not registered');
checkpointInterval.fn();
const intervalEntry = storage.continue_watch_params[checkpointHash];
if (!intervalEntry || intervalEntry.percent !== 48 || intervalEntry.time !== 1440) {
  throw new Error('30-second checkpoint did not capture timeline progress: ' + JSON.stringify(intervalEntry));
}
if (!storageSetCalls.some((call) => call.key === 'continue_watch_params')) {
  throw new Error('30-second checkpoint must synchronously persist continue_watch_params');
}
if (noties.length !== notiesBeforeCheckpoint) {
  throw new Error('Background checkpoint must not show notifications: ' + noties.slice(notiesBeforeCheckpoint).join(' | '));
}
console.log('silent 30-second checkpoint OK');

timelineStore[checkpointHash] = {
  hash: checkpointHash,
  percent: 67,
  time: 2010,
  duration: 3000,
};
storageSetCalls = [];
sandbox.document.hidden = true;
(documentEventListeners.visibilitychange || []).forEach((cb) => cb());
const hiddenEntry = storage.continue_watch_params[checkpointHash];
if (!hiddenEntry || hiddenEntry.percent !== 67 || hiddenEntry.time !== 2010) {
  throw new Error('visibility hidden checkpoint did not save progress: ' + JSON.stringify(hiddenEntry));
}
if (!storageSetCalls.some((call) => call.key === 'continue_watch_params')) {
  throw new Error('visibility hidden checkpoint must synchronously persist storage');
}
if (sandbox.window.cw.state.session_play_hash !== checkpointHash) {
  throw new Error('Eco cleanup must preserve active playback context after Home/background');
}
if (noties.length !== notiesBeforeCheckpoint) {
  throw new Error('Home/background checkpoint must not show notifications: ' + noties.slice(notiesBeforeCheckpoint).join(' | '));
}
sandbox.document.hidden = false;
console.log('Home/background emergency checkpoint OK');

// =========================================================================
// QA CYCLE: deterministic lifecycle/race coverage (Android TV + ViMu)
// =========================================================================

// D1: a stale files_pending flag must be released after the 12 × 300ms wait.
const pendingLeakTitle = 'QA Pending Timeout Series';
const pendingLeakLink = 'magnet:?xt=urn:btih:abababababababababababababababababababab';
addSeriesEntry(pendingLeakTitle, 1, 4, {
  percent: 100,
  time: 2400,
  duration: 2400,
  file_index: 4,
  torrent_link: pendingLeakLink,
  timestamp: Date.now() + 200000,
});
const pendingLeakMovie = {title: pendingLeakTitle, name: pendingLeakTitle, number_of_seasons: 1};
const pendingLeakRender = makeCardRender();
activeActivity = {component: 'full', movie: pendingLeakMovie, activity: {render: () => pendingLeakRender}};
Lampa.Listener.send('full', {type: 'complite', data: {movie: pendingLeakMovie}, object: activeActivity});
delete sandbox.window.cw.state.files[pendingLeakLink];
sandbox.window.cw.state.files_pending[pendingLeakLink] = true;
const pendingLeakBtn = pendingLeakRender.find('.button--continue-watch').first();
pendingLeakBtn.trigger('hover:enter');
tick(3600);
qaAssert(
  !sandbox.window.cw.state.files_pending[pendingLeakLink],
  'D1 files_pending remains set after 3.6s timeout; repeated smart-next waits again'
);
delete sandbox.window.cw.state.files_pending[pendingLeakLink];

// Slow TorrServer: start the current episode at 3.5s, then accept a late playlist.
const slowTitle = 'QA Slow TorrServer Series';
const slowLink = 'magnet:?xt=urn:btih:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';
addSeriesEntry(slowTitle, 1, 1, {
  percent: 30,
  time: 700,
  file_index: 1,
  torrent_link: slowLink,
  timestamp: Date.now() + 210000,
});
storage.cw_prefetch = false;
sandbox.window.cw.prefetch(false);
delete sandbox.window.cw.state.files[slowLink];
delete sandbox.window.cw.state.files_pending[slowLink];
const originalSlowFiles = Lampa.Torserver.files;
let lateFilesOk = null;
Lampa.Torserver.files = function (hash, ok) {
  lateFilesOk = ok;
};
const slowMovie = {title: slowTitle, name: slowTitle, number_of_seasons: 1};
const slowRender = makeCardRender();
activeActivity = {component: 'full', movie: slowMovie, activity: {render: () => slowRender}};
Lampa.Listener.send('full', {type: 'complite', data: {movie: slowMovie}, object: activeActivity});
playerPlayCalls = [];
playerPlaylistCalls = [];
slowRender.find('.button--continue-watch').first().trigger('hover:enter');
tick(3499);
qaAssert(playerPlayCalls.length === 0, 'Slow playlist fallback started before 3.5s deadline');
tick(1);
qaAssert(playerPlayCalls.length === 1, 'Slow playlist fallback did not start current episode at 3.5s');
if (lateFilesOk) {
  lateFilesOk({
    file_stats: [
      {id: 1, path: `${slowTitle} S01 E01.mkv`},
      {id: 2, path: `${slowTitle} S01 E02.mkv`},
    ],
  });
}
qaAssert(
  playerPlaylistCalls.length === 1 && playerPlaylistCalls[0].length === 2,
  'Late TorrServer result did not update Player.playlist exactly once'
);
Lampa.Torserver.files = originalSlowFiles;

// ViMu contract: external without start, progress arrives through Timeline/file_view.
const vimuTitle = 'QA ViMu External Movie';
const vimuHash = addMovieContinueEntry(vimuTitle);
const vimuMovie = {title: vimuTitle, name: vimuTitle};
const vimuRender = makeCardRender();
activeActivity = {component: 'full', movie: vimuMovie, activity: {render: () => vimuRender}};
Lampa.Listener.send('full', {type: 'complite', data: {movie: vimuMovie}, object: activeActivity});
playerPlayCalls = [];
vimuRender.find('.button--continue-watch').first().trigger('hover:enter');
sendPlayerExternal({card: vimuMovie});
Lampa.Timeline.update({hash: vimuHash, percent: 64, time: 2304, duration: 3600});
tick(80);
const vimuEntry = storage.continue_watch_params[vimuHash];
qaAssert(
  vimuEntry && vimuEntry.percent === 64 && vimuEntry.time === 2304,
  'ViMu external return without player:start did not sync file_view progress'
);
qaAssert(
  (vimuRender.find('.button--continue-watch').first().nodes[0].html || '').indexOf('38:24') !== -1,
  'ViMu external return did not refresh Continue position'
);
tick(1920);

// Buffer UX: a failed /echo health-check must keep the modal open and never autoplay.
const pingFailTitle = 'QA TorrServer Ping Failure';
addMovieContinueEntry(pingFailTitle);
const pingFailMovie = {title: pingFailTitle, name: pingFailTitle};
const pingFailRender = makeCardRender();
storage.cw_buffer_modal = true;
xhrBehavior.echo = 'network-error';
activeActivity = {component: 'full', movie: pingFailMovie, activity: {render: () => pingFailRender}};
Lampa.Listener.send('full', {type: 'complite', data: {movie: pingFailMovie}, object: activeActivity});
playerPlayCalls = [];
pingFailRender.find('.button--continue-watch').first().trigger('hover:enter');
qaAssert(playerPlayCalls.length === 0, 'TorrServer ping failure must not autoplay');
qaAssert(
  controllerName === 'cw_buffer_modal' && typeof sandbox.window.cw.state.buffer_close === 'function',
  'TorrServer ping failure must leave a cancellable buffer modal open'
);
Lampa.Controller.controllers.cw_buffer_modal.back();
xhrBehavior.echo = 'success';
storage.cw_buffer_modal = false;
tick(2000);

// =========================================================================
// QA: TorrServer stream contract, buffer fill, speed limits
// =========================================================================
storage.cw_prefetch = false;
sandbox.window.cw.prefetch(false);
storage.cw_buffer_modal = true;
storage.cw_buffer_pct = 20;
storage.player_torrent = 'tizen';

function openTorrentBufferCard(title, extras) {
  extras = extras || {};
  const hash = addMovieContinueEntry(title);
  Object.assign(storage.continue_watch_params[hash], extras);
  notifyContinueStorageChanged();
  const movie = {title, name: title};
  const render = makeCardRender();
  activeActivity = {component: 'full', movie, activity: {render: () => render}};
  Lampa.Listener.send('full', {type: 'complite', data: {movie}, object: activeActivity});
  return {hash, movie, render, entry: storage.continue_watch_params[hash]};
}

const streamTitle = 'QA Stream Contract Movie';
const streamLink = 'magnet:?xt=urn:btih:feedfeedfeedfeedfeedfeedfeedfeedfeedfeed';
const streamFile = 'QA Stream Contract Movie.mkv';
xhrRequests = [];
playerPlayCalls = [];
torrentGetResponse = {
  preloaded_bytes: 80,
  preload_size: 100,
  download_speed: 200 * 1024,
};
const streamCard = openTorrentBufferCard(streamTitle, {
  torrent_link: streamLink,
  file_name: streamFile,
  file_index: 7,
});
streamCard.render.find('.button--continue-watch').first().trigger('hover:enter');
tick(50);
const playUrl = playerPlayCalls[0] && playerPlayCalls[0].url;
assertStreamContract(playUrl, {fileName: streamFile, link: streamLink, index: 7});
qaAssert(
  playerPlayCalls[0] && playerPlayCalls[0].torrent_hash === streamLink,
  'Non-inner player must keep torrent_hash for torrent client / ViMu: ' + JSON.stringify(playerPlayCalls[0])
);
const streamPreloadReq = xhrRequests.find((r) => r.method === 'GET' && /\/stream\//.test(r.url));
assertStreamContract(streamPreloadReq && streamPreloadReq.url, {
  fileName: streamFile,
  link: streamLink,
  index: 7,
  preload: true,
});
const statusReq = xhrRequests.find((r) => r.method === 'POST' && /\/torrents$/.test(r.url) && String(r.body).indexOf('"get"') !== -1);
qaAssert(!!statusReq, 'Buffer poll must POST /torrents action=get');
qaAssert(
  statusReq && statusReq.headers && statusReq.headers['Content-Type'] === 'text/plain;charset=UTF-8',
  'TorrServer status poll must use text/plain to avoid CORS preflight: ' + JSON.stringify(statusReq && statusReq.headers)
);
tick(1950);

// Slow fill: speed below BUFFER_MIN_SPEED (50 KB/s) must still wait until buffer %.
let fillPolls = 0;
torrentGetResponse = function () {
  fillPolls++;
  return {
    preloaded_bytes: Math.min(100, 8 * fillPolls),
    preload_size: 100,
    download_speed: 20 * 1024,
    connected_seeders: 1,
    peers: 4,
  };
};
playerPlayCalls = [];
xhrRequests = [];
const slowFillCard = openTorrentBufferCard('QA Slow Buffer Fill', {
  torrent_link: 'magnet:?xt=urn:btih:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
  file_name: 'QA Slow Buffer Fill.mkv',
  file_index: 0,
});
slowFillCard.render.find('.button--continue-watch').first().trigger('hover:enter');
qaAssert(playerPlayCalls.length === 0, 'First buffer poll at 8% must not auto-launch');
const fillModal = lastBufferModal();
qaAssert(
  $(fillModal).find('.cw-buf__pct').text() === '8%',
  'Buffer modal must show first poll percent, got: ' + $(fillModal).find('.cw-buf__pct').text()
);
qaAssert(
  /20 KB\/s/.test($(fillModal).find('.cw-buf__speed').text()),
  'Buffer modal must show throttled speed, got: ' + $(fillModal).find('.cw-buf__speed').text()
);
tick(1000);
qaAssert(playerPlayCalls.length === 0, 'Second poll at 16% must still wait for 20% threshold');
tick(1000);
qaAssert(playerPlayCalls.length === 1, 'Buffer must auto-launch once fill reaches threshold despite 20 KB/s');
qaAssert(
  playerPlayCalls[0] && /[?&]play(?:&|$)/.test(playerPlayCalls[0].url) && playerPlayCalls[0].url.indexOf('preload') === -1,
  'Auto-launch after fill must hand play URL, not preload: ' + (playerPlayCalls[0] && playerPlayCalls[0].url)
);
tick(2000);

// Incomplete buffer + throttled speed: never autoplay.
torrentGetResponse = {
  preloaded_bytes: 12,
  preload_size: 100,
  download_speed: 10 * 1024,
  connected_seeders: 1,
  peers: 8,
};
playerPlayCalls = [];
const throttleCard = openTorrentBufferCard('QA Throttled Incomplete Buffer', {
  torrent_link: 'magnet:?xt=urn:btih:b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
  file_name: 'QA Throttled Incomplete Buffer.mkv',
});
throttleCard.render.find('.button--continue-watch').first().trigger('hover:enter');
tick(8000);
qaAssert(playerPlayCalls.length === 0, 'Throttled torrent below buffer threshold must not auto-launch');
$(lastBufferModal()).find('.cw-buf__btn--launch').trigger('hover:enter');
qaAssert(playerPlayCalls.length === 1, 'Запустить сейчас must start playback while buffer is still filling');
tick(2000);

// Full buffer with speed=0 (preload already finished) must auto-launch.
torrentGetResponse = {
  preloaded_bytes: 100,
  preload_size: 100,
  download_speed: 0,
  peers: 0,
};
playerPlayCalls = [];
const fullZeroSpeed = openTorrentBufferCard('QA Full Buffer Zero Speed', {
  torrent_link: 'magnet:?xt=urn:btih:c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3',
  file_name: 'QA Full Buffer Zero Speed.mkv',
});
fullZeroSpeed.render.find('.button--continue-watch').first().trigger('hover:enter');
qaAssert(playerPlayCalls.length === 1, 'Completed preload with 0 KB/s must still auto-launch');
tick(2000);

// No preload_size: only autoplay if loaded>5MB AND speed > 50 KB/s.
torrentGetResponse = {
  preloaded_bytes: 0,
  preload_size: 0,
  loaded_size: 6 * 1024 * 1024,
  download_speed: 30 * 1024,
  peers: 3,
};
playerPlayCalls = [];
const noPreloadSlow = openTorrentBufferCard('QA No Preload Size Slow', {
  torrent_link: 'magnet:?xt=urn:btih:d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4',
  file_name: 'QA No Preload Size Slow.mkv',
});
noPreloadSlow.render.find('.button--continue-watch').first().trigger('hover:enter');
tick(3000);
qaAssert(playerPlayCalls.length === 0, 'No preload_size + speed below 50 KB/s must not auto-launch even with 6MB loaded');
if (Lampa.Controller.controllers.cw_buffer_modal && Lampa.Controller.controllers.cw_buffer_modal.back) {
  Lampa.Controller.controllers.cw_buffer_modal.back();
}
tick(2000);

torrentGetResponse = {
  preloaded_bytes: 0,
  preload_size: 0,
  loaded_size: 6 * 1024 * 1024,
  download_speed: 60 * 1024,
  peers: 3,
};
playerPlayCalls = [];
const noPreloadFast = openTorrentBufferCard('QA No Preload Size Fast', {
  torrent_link: 'magnet:?xt=urn:btih:e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5',
  file_name: 'QA No Preload Size Fast.mkv',
});
noPreloadFast.render.find('.button--continue-watch').first().trigger('hover:enter');
qaAssert(playerPlayCalls.length === 1, 'No preload_size fallback must auto-launch when loaded>5MB and speed>50 KB/s');
tick(2000);

// Cancel must stop polling so a later stats jump cannot start the player.
torrentGetResponse = {
  preloaded_bytes: 5,
  preload_size: 100,
  download_speed: 8 * 1024,
};
playerPlayCalls = [];
const cancelCard = openTorrentBufferCard('QA Buffer Cancel Stops Poll', {
  torrent_link: 'magnet:?xt=urn:btih:f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6',
  file_name: 'QA Buffer Cancel Stops Poll.mkv',
});
cancelCard.render.find('.button--continue-watch').first().trigger('hover:enter');
$(lastBufferModal()).find('.cw-buf__btn--cancel').trigger('hover:enter');
torrentGetResponse = {
  preloaded_bytes: 100,
  preload_size: 100,
  download_speed: 200 * 1024,
};
tick(4000);
qaAssert(playerPlayCalls.length === 0, 'Cancelled buffer poll must not auto-launch after later 100% stats');

// =========================================================================
// QA: next-episode prefetch must not compete with the current file's buffer
// =========================================================================
const gateTitle = 'QA Prefetch Gate Series';
const gateLink = 'magnet:?xt=urn:btih:0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a';
addSeriesEntry(gateTitle, 1, 7, {
  percent: 99,
  time: 2380,
  duration: 2400,
  file_index: 7,
  torrent_link: gateLink,
  file_name: `${gateTitle} S01 E07.mkv`,
  timestamp: Date.now() + 300000,
});
addSeriesEntry(gateTitle, 1, 8, {
  percent: 0,
  time: 0,
  duration: 2400,
  file_index: 8,
  torrent_link: gateLink,
  file_name: `${gateTitle} S01 E08.mkv`,
  timestamp: Date.now() + 290000,
});
const gateMovie = {title: gateTitle, name: gateTitle, number_of_seasons: 1};

storage.cw_buffer_modal = true;
storage.cw_buffer_pct = 20;
sandbox.window.cw.prefetch(false);
sandbox.window.cw.prefetch(true, 20);
delete sandbox.window.cw.state.files[gateLink];
delete sandbox.window.cw.state.files_pending[gateLink];

// Current file is starved: preload stays far below the 20% threshold.
torrentGetResponse = {
  preloaded_bytes: 8,
  preload_size: 100,
  download_speed: 15 * 1024,
  connected_seeders: 2,
  peers: 250,
};

const gateRender = makeCardRender();
activeActivity = {component: 'full', movie: gateMovie, activity: {render: () => gateRender}};
xhrRequests = [];
Lampa.Listener.send('full', {type: 'complite', data: {movie: gateMovie}, object: activeActivity});
qaAssert(
  xhrRequests.some((r) => r.method === 'GET' && /index=8/.test(r.url) && /preload/.test(r.url)),
  'Card open should warm the next episode before playback starts'
);

playerPlayCalls = [];
gateRender.find('.button--continue-watch').first().trigger('hover:enter');
const gateConfirm = bodyChildren[bodyChildren.length - 1];
$(gateConfirm).find('.cw-cnf__btn--secondary').trigger('hover:enter');
tick(50);
const gateBufferModal = lastBufferModal();
qaAssert(!!gateBufferModal, 'Finishing the current episode must open its buffer modal');
$(gateBufferModal).find('.cw-buf__btn--launch').trigger('hover:enter');
qaAssert(playerPlayCalls.length === 1, 'Запустить сейчас must start the under-buffered current episode');

// Android TV re-renders the card right after launch; that must not restart
// next-episode prefetch while the current file is still starved.
const gatePrefetchBefore = sandbox.window.cw.prefetch().count;
xhrRequests = [];
const gateRenderDuringPlayback = makeCardRender();
activeActivity = {
  component: 'full',
  movie: gateMovie,
  activity: {render: () => gateRenderDuringPlayback},
};
Lampa.Listener.send('full', {type: 'complite', data: {movie: gateMovie}, object: activeActivity});
tick(3000);
qaAssert(
  !xhrRequests.some((r) => r.method === 'GET' && /index=8/.test(r.url) && /preload/.test(r.url)),
  'Next-episode preload must be suspended while the current file is below the buffer threshold'
);
qaAssert(
  sandbox.window.cw.prefetch().count === gatePrefetchBefore,
  'Next-episode prefetch must not restart while the current file is still buffering'
);

// Once the current file reaches the threshold, prefetch is allowed again.
torrentGetResponse = {
  preloaded_bytes: 40,
  preload_size: 100,
  download_speed: 400 * 1024,
  connected_seeders: 12,
  peers: 250,
};
xhrRequests = [];
tick(6000);
const gateRenderAfterBuffer = makeCardRender();
activeActivity = {
  component: 'full',
  movie: gateMovie,
  activity: {render: () => gateRenderAfterBuffer},
};
Lampa.Listener.send('full', {type: 'complite', data: {movie: gateMovie}, object: activeActivity});
tick(3000);
qaAssert(
  xhrRequests.some((r) => r.method === 'GET' && /index=8/.test(r.url) && /preload/.test(r.url)),
  'Next-episode prefetch must resume once the current file buffer reaches the threshold'
);

// The gate must never stick: an unrelated card still prefetches normally.
sendPlayerDestroy();
tick(4000);
const unrelatedGateTitle = 'QA Prefetch Gate Unrelated';
const unrelatedGateLink = 'magnet:?xt=urn:btih:0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b';
addSeriesEntry(unrelatedGateTitle, 1, 2, {
  percent: 99,
  time: 2380,
  duration: 2400,
  file_index: 2,
  torrent_link: unrelatedGateLink,
  file_name: `${unrelatedGateTitle} S01 E02.mkv`,
  timestamp: Date.now() + 320000,
});
addSeriesEntry(unrelatedGateTitle, 1, 3, {
  percent: 0,
  file_index: 3,
  torrent_link: unrelatedGateLink,
  file_name: `${unrelatedGateTitle} S01 E03.mkv`,
  timestamp: Date.now() + 310000,
});
const unrelatedGateMovie = {
  title: unrelatedGateTitle,
  name: unrelatedGateTitle,
  number_of_seasons: 1,
};
const unrelatedGateRender = makeCardRender();
activeActivity = {
  component: 'full',
  movie: unrelatedGateMovie,
  activity: {render: () => unrelatedGateRender},
};
xhrRequests = [];
Lampa.Listener.send('full', {type: 'complite', data: {movie: unrelatedGateMovie}, object: activeActivity});
qaAssert(
  xhrRequests.some((r) => r.method === 'GET' && /index=3/.test(r.url) && /preload/.test(r.url)),
  'Prefetch gate must not stay closed for unrelated cards'
);

sandbox.window.cw.prefetch(false);
storage.cw_buffer_modal = false;
storage.cw_buffer_pct = 5;
storage.player_torrent = 'inner';
torrentGetResponse = {
  preloaded_bytes: 10,
  preload_size: 100,
  download_speed: 2048,
};
tick(4000);

// =========================================================================
// QA: concurrent TorrServer preloads / orphan XHR / stacked buffer modal
// =========================================================================
storage.cw_buffer_modal = true;
storage.cw_buffer_pct = 20;
sandbox.window.cw.prefetch(true, 20);
torrentGetResponse = {
  preloaded_bytes: 8,
  preload_size: 100,
  download_speed: 15 * 1024,
  connected_seeders: 2,
  peers: 250,
};

function setupConcurrentSeries(title, link, currentIndex) {
  addSeriesEntry(title, 1, currentIndex, {
    percent: 99,
    time: 2380,
    duration: 2400,
    file_index: currentIndex,
    torrent_link: link,
    file_name: `${title} S01 E${String(currentIndex).padStart(2, '0')}.mkv`,
    timestamp: Date.now() + 400000,
  });
  addSeriesEntry(title, 1, currentIndex + 1, {
    percent: 0,
    time: 0,
    duration: 2400,
    file_index: currentIndex + 1,
    torrent_link: link,
    file_name: `${title} S01 E${String(currentIndex + 1).padStart(2, '0')}.mkv`,
    timestamp: Date.now() + 390000,
  });
  const movie = {title, name: title, number_of_seasons: 1};
  const render = makeCardRender();
  delete sandbox.window.cw.state.files[link];
  delete sandbox.window.cw.state.files_pending[link];
  activeActivity = {component: 'full', movie, activity: {render: () => render}};
  Lampa.Listener.send('full', {type: 'complite', data: {movie}, object: activeActivity});
  return {movie, render};
}

function confirmContinueCurrent(render) {
  render.find('.button--continue-watch').first().trigger('hover:enter');
  const confirm = bodyChildren[bodyChildren.length - 1];
  $(confirm).find('.cw-cnf__btn--secondary').trigger('hover:enter');
  tick(50);
}

// P0-2: while the buffer modal is open, a card re-render must not start
// next-episode preload. Gate is currently armed only on launch.
const overlapTitle = 'QA Concurrent Buffer Prefetch';
const overlapLink = 'magnet:?xt=urn:btih:1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c';
const overlap = setupConcurrentSeries(overlapTitle, overlapLink, 4);
qaAssert(
  livePreloadIndexes(overlapLink).indexOf(5) !== -1,
  'Card open must start next-episode preload before Continue'
);
confirmContinueCurrent(overlap.render);
qaAssert(!!lastBufferModal(), 'Continue current must open the buffer modal');
const overlapRerender = makeCardRender();
activeActivity = {
  component: 'full',
  movie: overlap.movie,
  activity: {render: () => overlapRerender},
};
Lampa.Listener.send('full', {type: 'complite', data: {movie: overlap.movie}, object: activeActivity});
tick(1500);
qaAssert(
  livePreloadIndexes(overlapLink).indexOf(5) === -1,
  'P0-2: next-episode preload must not be live while the current file buffer modal is open, got indexes ' + livePreloadIndexes(overlapLink).join(',')
);
qaAssert(
  livePreloadIndexes(overlapLink).indexOf(4) !== -1,
  'P0-2: current file preload must stay active in the buffer modal'
);

// P0-1: closing the modal must abort the current-file preload XHR so cancel
// + resumed next prefetch cannot keep two files downloading.
$(lastBufferModal()).find('.cw-buf__btn--cancel').trigger('hover:enter');
qaAssert(
  livePreloadIndexes(overlapLink).indexOf(4) === -1,
  'P0-1: cancel must abort the current-file preload XHR, still live: ' + livePreloadIndexes(overlapLink).join(',')
);

// P1-1: a second launchPlayer must close the first buffer modal.
const stackTitle = 'QA Stacked Buffer Modal';
const stackLink = 'magnet:?xt=urn:btih:2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d';
const stack = setupConcurrentSeries(stackTitle, stackLink, 1);
confirmContinueCurrent(stack.render);
qaAssert(liveBufferModals().length === 1, 'First Continue must leave exactly one buffer modal');
stack.render.find('.button--continue-watch').first().trigger('hover:enter');
const stackedConfirm = bodyChildren
  .filter((node) => String(node.html || '').indexOf('cw-cnf') !== -1 && !node.removed)
  .pop();
if (stackedConfirm) $(stackedConfirm).find('.cw-cnf__btn--secondary').trigger('hover:enter');
tick(50);
qaAssert(
  liveBufferModals().length === 1,
  'P1-1: second Continue must close the previous buffer modal, open=' + liveBufferModals().length
);
if (lastBufferModal()) $(lastBufferModal()).find('.cw-buf__btn--cancel').trigger('hover:enter');

// P0-3: late getTorrentHash callback must not start preload for a stale index.
torrentAddHold = true;
const staleTitle = 'QA Stale Prefetch Hash';
const staleLink = 'http://192.168.31.244:8090/qa-stale-prefetch.torrent';
const stale = setupConcurrentSeries(staleTitle, staleLink, 9);
qaAssert(pendingTorrentAdds.length > 0, 'Non-magnet prefetch must wait on POST /torrents add');
sandbox.window.cw.state.prefetch_hash = '0123456789abcdef0123456789abcdef01234567';
confirmContinueCurrent(stale.render);
qaAssert(!!lastBufferModal(), 'P0-3 setup must open buffer modal with seeded hash');
flushPendingTorrentAdds();
torrentAddHold = false;
qaAssert(
  livePreloadIndexes(staleLink).indexOf(10) === -1,
  'P0-3: late hash callback must not start next-episode preload while buffering current, live=' + livePreloadIndexes(staleLink).join(',')
);
qaAssert(
  livePreloadIndexes(staleLink).every((idx) => idx === 9),
  'P0-3: current file preload must remain the only active stream, live=' + livePreloadIndexes(staleLink).join(',')
);
if (lastBufferModal()) $(lastBufferModal()).find('.cw-buf__btn--cancel').trigger('hover:enter');

sandbox.window.cw.prefetch(false);
storage.cw_buffer_modal = false;
storage.cw_buffer_pct = 5;
storage.player_torrent = 'inner';
torrentGetResponse = {
  preloaded_bytes: 10,
  preload_size: 100,
  download_speed: 2048,
};
tick(4000);

// Context menus: movie reset/mark-watched and series previous/next actions.
const contextMovieTitle = 'QA Context Movie';
const contextMovieHash = addMovieContinueEntry(contextMovieTitle);
const contextMovie = {title: contextMovieTitle, name: contextMovieTitle};
const contextMovieRender = makeCardRender();
activeActivity = {component: 'full', movie: contextMovie, activity: {render: () => contextMovieRender}};
Lampa.Listener.send('full', {type: 'complite', data: {movie: contextMovie}, object: activeActivity});
selectCalls = [];
contextMovieRender.find('.button--continue-watch').first().trigger('hover:long');
let contextOpts = selectCalls[selectCalls.length - 1];
qaAssert(
  contextOpts && contextOpts.items.some((item) => /просмотренный/.test(item.title)) &&
    contextOpts.items.some((item) => /Сбросить/.test(item.title)),
  'Movie context menu must expose mark-watched and reset actions'
);
if (contextOpts) contextOpts.onSelect(contextOpts.items.find((item) => /просмотренный/.test(item.title)));
qaAssert(storage.continue_watch_params[contextMovieHash].percent === 100, 'Movie mark-watched action did not persist 100%');
contextMovieRender.find('.button--continue-watch').first().trigger('hover:long');
contextOpts = selectCalls[selectCalls.length - 1];
if (contextOpts) contextOpts.onSelect(contextOpts.items.find((item) => /Сбросить/.test(item.title)));
qaAssert(storage.continue_watch_params[contextMovieHash].percent === 0, 'Movie reset action did not clear progress');

const contextSeriesTitle = 'QA Context Series';
addSeriesEntry(contextSeriesTitle, 1, 1, {percent: 100, timestamp: Date.now() + 100});
addSeriesEntry(contextSeriesTitle, 1, 2, {percent: 40, timestamp: Date.now() + 300});
addSeriesEntry(contextSeriesTitle, 1, 3, {percent: 0, timestamp: Date.now() + 200});
const contextSeriesMovie = {title: contextSeriesTitle, name: contextSeriesTitle, number_of_seasons: 1};
const contextSeriesRender = makeCardRender();
activeActivity = {component: 'full', movie: contextSeriesMovie, activity: {render: () => contextSeriesRender}};
Lampa.Listener.send('full', {type: 'complite', data: {movie: contextSeriesMovie}, object: activeActivity});
selectCalls = [];
contextSeriesRender.find('.button--continue-watch').first().trigger('hover:long');
contextOpts = selectCalls[selectCalls.length - 1];
const prevAction = contextOpts && contextOpts.items.find((item) => /предыдущему/.test(item.title));
const nextAction = contextOpts && contextOpts.items.find((item) => /следующий/.test(item.title));
qaAssert(prevAction && nextAction, 'Series context menu must expose previous and next actions');
playerPlayCalls = [];
if (prevAction) contextOpts.onSelect(prevAction);
qaAssert(playerPlayCalls.length === 1 && playerPlayCalls[0].episode === 1, 'Previous context action must launch E1');
contextSeriesRender.find('.button--continue-watch').first().trigger('hover:long');
contextOpts = selectCalls[selectCalls.length - 1];
const freshNextAction = contextOpts && contextOpts.items.find((item) => /следующий/.test(item.title));
playerPlayCalls = [];
if (freshNextAction) contextOpts.onSelect(freshNextAction);
qaAssert(playerPlayCalls.length === 1 && playerPlayCalls[0].episode === 3, 'Next context action must launch E3');

// Android lifecycle events must checkpoint silently without discarding playback context.
const lifecycleNoties = noties.length;
const lifecycleHash = sandbox.window.cw.state.session_play_hash;
(windowEventListeners.pagehide || []).forEach((cb) => cb());
(windowEventListeners.freeze || []).forEach((cb) => cb());
(windowEventListeners.pause || []).forEach((cb) => cb());
qaAssert(noties.length === lifecycleNoties, 'pagehide/freeze/pause checkpoints must not show Noty');
qaAssert(
  sandbox.window.cw.state.session_play_hash === lifecycleHash,
  'Eco cleanup on pagehide/freeze/pause must preserve playback context'
);

// Profile isolation: switching profile must invalidate both storage cache and playback/card session state.
storage.continue_watch_params__migrated_to_profiles = true;
const profileTitle = 'QA Profile Isolated Movie';
const profileHash = Lampa.Utils.hash(profileTitle);
storage.continue_watch_params_1001 = {
  [profileHash]: {
    title: profileTitle,
    percent: 51,
    time: 1020,
    duration: 2000,
    timestamp: Date.now(),
    torrent_link: 'magnet:?xt=urn:btih:efefefefefefefefefefefefefefefefefefefef',
    file_index: 0,
  },
};
storage.continue_watch_params_1002 = {};
Lampa.Account.Permit.sync = true;
Lampa.Account.Permit.account.profile.id = 1001;
Lampa.Listener.send('profile_select');
const profileAInspect = sandbox.window.cw.inspect(profileTitle);
qaAssert(
  profileAInspect.entries.some((entry) => entry.title === profileTitle),
  'Profile A must see its own Continue entry'
);
const profileState = sandbox.window.cw.state;
profileState.last_player_hash = profileHash;
profileState.session_play_hash = profileHash;
profileState.last_full_movie = {title: profileTitle};
profileState.last_full_render = makeCardRender();
Lampa.Account.Permit.account.profile.id = 1002;
Lampa.Listener.send('profile_select');
const profileBInspect = sandbox.window.cw.inspect(profileTitle);
qaAssert(
  !profileBInspect.entries.some((entry) => entry.title === profileTitle),
  'Profile B must not see Profile A Continue data'
);
qaAssert(
  !profileState.last_player_hash &&
    !profileState.session_play_hash &&
    !profileState.last_full_movie &&
    !profileState.last_full_render,
  'Profile switch must clear player/session hash and cached full-card render'
);

if (noties.some((n) => /error|ошиб/i.test(n))) {
  throw new Error('Lampa.Noty error shown: ' + noties.join(' | '));
}

if (qaFailures.length) {
  throw new Error('QA regressions (' + qaFailures.length + '):\n- ' + qaFailures.join('\n- '));
}

console.log('cw smoke OK');
