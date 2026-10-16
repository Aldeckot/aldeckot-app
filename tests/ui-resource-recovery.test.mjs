import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const source = read('ui-resource-recovery.js');
const version = JSON.parse(read('package.json')).version;
const pages = ['index', 'inventory', 'management', 'control', 'flux', 'nfe', 'supplies', 'settings', 'login'];

function harness({ inputs = [], styles = [], queuedErrors = [] } = {}) {
  const listeners = { document: new Map(), window: new Map() };
  const timers = new Map();
  const storage = new Map();
  let timerId = 0;
  let reloads = 0;
  let notice = null;
  const addListener = (scope, name, callback) => {
    const callbacks = listeners[scope].get(name) || [];
    callbacks.push(callback);
    listeners[scope].set(name, callbacks);
  };
  const node = tagName => ({
    tagName: tagName.toUpperCase(), style: {}, dataset: {}, children: [], isConnected: false,
    setAttribute() {}, addEventListener() {},
    append(...children) { this.children.push(...children); },
    querySelector(selector) { return selector === 'button' ? this.children[1] : this.children[0]; },
    remove() { this.isConnected = false; }
  });
  const document = {
    readyState: 'complete', visibilityState: 'visible',
    body: { append(element) { element.isConnected = true; notice = element; } },
    addEventListener: (name, callback) => addListener('document', name, callback),
    querySelectorAll(selector) { return selector.startsWith('input') ? inputs : selector.startsWith('link') ? styles : []; },
    createElement: node
  };
  const window = {
    location: { pathname: '/inventory.html', href: 'http://localhost:4173/inventory.html', origin: 'http://localhost:4173', reload() { reloads += 1; } },
    navigator: { onLine: true },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    __aldeckotResourceErrors: queuedErrors,
    addEventListener: (name, callback) => addListener('window', name, callback),
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  runInNewContext(source, { window, document, URL, Date, Math, Set, WeakMap });
  return {
    document, window, storage,
    get reloads() { return reloads; },
    get notice() { return notice; },
    fire(scope, name, target) {
      for (const callback of listeners[scope].get(name) || []) callback({ target });
    },
    runTimer() {
      const [id, callback] = timers.entries().next().value || [];
      assert.ok(callback, 'há uma retentativa agendada');
      timers.delete(id);
      callback();
    }
  };
}

test('todas as páginas instalam a recuperação antes do primeiro estilo externo', () => {
  for (const page of pages) {
    const html = read(`${page}.html`);
    assert.match(html, /window\.__aldeckotResourceErrors=\[\]/, page);
    assert.ok(html.includes(`ui-resource-recovery.js?v=${version}`), page);
    assert.ok(html.indexOf('ui-resource-recovery.js') < html.indexOf('rel="stylesheet"'), page);
    if (page !== 'login') assert.ok(html.indexOf('auth-pending') < html.indexOf('ui-resource-recovery.js'), `${page}: proteção de acesso vem primeiro`);
  }
});

test('falha de CSS é recuperada sem recarregar a página', () => {
  const app = harness();
  const link = { tagName: 'LINK', rel: 'stylesheet', href: `http://localhost:4173/module-header-cards.css?v=${version}`, sheet: null, disabled: false, isConnected: true };
  app.fire('document', 'error', link);
  app.runTimer();
  assert.match(link.href, /uiRetry=/);
  assert.equal(app.reloads, 0);
  link.sheet = {};
  app.fire('document', 'load', link);
  assert.equal(app.notice, null);
});

test('retorno da aba identifica estilo ausente mesmo sem evento de erro', () => {
  const link = { tagName: 'LINK', rel: 'stylesheet', href: `http://localhost:4173/module-header-cards.css?v=${version}`, sheet: null, disabled: false, isConnected: true };
  const app = harness({ styles: [link] });
  app.window.AldeckotResourceRecovery.check();
  app.runTimer();
  assert.match(link.href, /uiRetry=/);
  assert.equal(app.reloads, 0);
});

test('imagem local da interface é tentada novamente sem alterar imagens externas', () => {
  const app = harness();
  const logo = { tagName: 'IMG', src: 'http://localhost:4173/assets/aldeckot-symbol.png', isConnected: true };
  app.fire('document', 'error', logo);
  app.runTimer();
  assert.match(logo.src, /uiRetry=/);
  assert.equal(app.reloads, 0);
  const remote = { tagName: 'IMG', src: 'https://example.org/asset.png', isConnected: true };
  app.fire('document', 'error', remote);
  assert.equal(remote.src, 'https://example.org/asset.png');
});

test('falha de script permite apenas uma recarga automática', () => {
  const app = harness();
  const script = { tagName: 'SCRIPT', src: 'http://localhost:4173/inventory.js' };
  app.fire('document', 'error', script);
  app.runTimer();
  assert.equal(app.reloads, 1);
  app.fire('document', 'error', script);
  app.runTimer();
  assert.equal(app.reloads, 1);
  assert.equal(app.notice?.isConnected, true);
});

test('dados digitados impedem recarga automática', () => {
  const input = { value: 'rascunho', matches: () => false };
  const app = harness({ inputs: [input] });
  app.fire('document', 'error', { tagName: 'SCRIPT', src: 'http://localhost:4173/inventory.js' });
  app.runTimer();
  assert.equal(app.reloads, 0);
  assert.equal(app.notice?.isConnected, true);
});

test('alteração em seletor também preserva o estado antes de uma falha de script', () => {
  const app = harness();
  app.fire('document', 'change', { tagName: 'SELECT' });
  app.fire('document', 'error', { tagName: 'SCRIPT', src: 'http://localhost:4173/inventory.js' });
  app.runTimer();
  assert.equal(app.reloads, 0);
  assert.equal(app.notice?.isConnected, true);
});

test('primeira falha do próprio recuperador não provoca recarga após retentativa bem-sucedida', () => {
  const app = harness({ queuedErrors: [{ tagName: 'SCRIPT', src: `http://localhost:4173/ui-resource-recovery.js?v=${version}` }] });
  assert.equal(app.reloads, 0);
  assert.ok(app.window.AldeckotResourceRecovery);
});
