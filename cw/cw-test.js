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
let xhrRequests = [];
let activityPushCalls = [];
let focusedNode = null;
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

const Lampa = {
  Storage: {
    get(key, def) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : def; },
    set(key, value) {
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
    playlist() {},
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
      if (data && data.hash) timelineStore[data.hash] = Object.assign({}, timelineStore[data.hash] || {}, data);
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
  Account: {Permit: {sync: false}},
  Manifest: {plugins: []},
  Template: {js() { return nodeFromHtml('<div></div>'); }},
};

const sandbox = {
  window: {
    appready: true,
    Lampa,
    addEventListener() {},
    requestAnimationFrame(fn) { return fn(); },
  setTimeout(fn, ms) {
    if (ms === 1000) return fn();
    if (ms <= 100) return fn();
    if (ms >= 500) return 0;
    return setTimeout(fn, ms);
  },
    clearTimeout,
    setInterval() { return 0; },
    clearInterval() {},
    performance: {memory: {usedJSHeapSize: 10_000_000, totalJSHeapSize: 10_000_000, jsHeapSizeLimit: 1_000_000_000}},
  },
  document: {
    body: {appendChild(node) { bodyChildren.push(node); }},
    createElement() { return {style: {}, children: [], appendChild() {}, remove() {}}; },
    getElementById() { return null; },
    addEventListener() {},
    documentElement: {},
  },
  Lampa,
  $,
  console,
  requestAnimationFrame(fn) { return fn(); },
  setTimeout(fn, ms) {
    if (ms === 1000) return fn();
    if (ms <= 100) return fn();
    if (ms >= 500) return 0;
    return setTimeout(fn, ms);
  },
  clearTimeout,
  setInterval() { return 0; },
  clearInterval() {},
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
  xhrRequests.push({method: this.method, url: this.url, body: body || ''});
  if (this.method === 'POST' && /\/torrents$/.test(this.url)) {
    let payload = {};
    try { payload = body ? JSON.parse(body) : {}; } catch (e) {}
    if (payload.action === 'get') {
      this.responseText = JSON.stringify(torrentGetResponse);
    } else {
      this.responseText = JSON.stringify({hash: '0123456789abcdef0123456789abcdef01234567'});
    }
  }
  if (typeof this.onload === 'function') this.onload();
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
  return Lampa.Utils.hash([season, episode, title].join(''));
}

function sendPlayerStart(data) {
  (listeners['player:start'] || []).forEach((cb) => cb(data));
}

function sendPlayerDestroy() {
  (listeners['player:destroy'] || []).forEach((cb) => cb());
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
playerPlayCalls = [];
smartBtn.trigger('hover:enter');
smartModal = bodyChildren[bodyChildren.length - 1];
$(smartModal).find('.cw-cnf__btn--primary').trigger('hover:enter');
if (playerPlayCalls.length !== 1) throw new Error('Smart-next primary should start next episode');
if (playerPlayCalls[0].episode !== 8 || ![-1, 0].includes(playerPlayCalls[0].position)) {
  throw new Error('Smart-next primary should start S1E8 from beginning: ' + JSON.stringify(playerPlayCalls[0]));
}
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
console.log('watched episode resolves next from files OK');

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
if (playerPlayCalls.length !== 1) {
  throw new Error('Buffer modal should auto-launch after preload threshold, calls=' + playerPlayCalls.length);
}
const bufferPreloadReq = xhrRequests.find((r) => r.method === 'GET' && /\/stream\//.test(r.url));
if (!bufferPreloadReq || bufferPreloadReq.url.indexOf('preload') === -1) {
  throw new Error('Buffer modal should trigger current-file preload before polling');
}
storage.cw_buffer_modal = false;
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
if (playerPlayCalls.length !== 1 || playerPlayCalls[0].position !== 860) {
  throw new Error('Card B should start from saved position after ready prefetch: ' + JSON.stringify(playerPlayCalls[0]));
}
const repeatedTransitionPreload = xhrRequests.find((r) => r.method === 'GET' && /\/stream\//.test(r.url));
if (repeatedTransitionPreload) {
  throw new Error('Card B ready prefetch should not restart from 0, got: ' + repeatedTransitionPreload.url);
}
storage.cw_buffer_modal = false;
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
if (playerPlayCalls.length !== 1 || playerPlayCalls[0].position !== 420) {
  throw new Error('Ready prefetch should launch from saved position without waiting: ' + JSON.stringify(playerPlayCalls[0]));
}
const repeatedReadyPreload = xhrRequests.find((r) => r.method === 'GET' && /\/stream\//.test(r.url));
if (repeatedReadyPreload) {
  throw new Error('Ready prefetch must not restart preload for same file, got: ' + repeatedReadyPreload.url);
}
storage.cw_buffer_modal = false;
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
if (!idempotentRender.find('.button--continue-watch').first().hasClass('focus')) {
  throw new Error('Continue button focus must be restored after returning from menu');
}
playerPlayCalls = [];
idempotentRender.find('.button--continue-watch').first().trigger('hover:enter');
if (playerPlayCalls.length !== 1) {
  throw new Error('Continue button must start playback after returning from menu');
}
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
console.log('launch touch OK: launched S1E' + launchedEpisode + ' wins findStreamParams (ts ' + launchedTs + ' > ' + otherTs + ')');

if (noties.some((n) => /error|ошиб/i.test(n))) {
  throw new Error('Lampa.Noty error shown: ' + noties.join(' | '));
}

console.log('cw smoke OK');
