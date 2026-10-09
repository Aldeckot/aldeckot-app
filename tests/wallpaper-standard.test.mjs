import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name));
const pages = [
  'index.html', 'inventory.html', 'management.html', 'control.html',
  'flux.html', 'nfe.html', 'supplies.html', 'settings.html', 'login.html'
];

test('todos os módulos carregam o mesmo wallpaper e sincronizador', () => {
  for (const page of pages) {
    const html = read(page).toString('utf8');
    assert.match(html, /wallpaper-standard\.css\?v=2\.0\.89/, page);
    assert.match(html, /wallpaper-standard\.js\?v=2\.0\.89/, page);
  }
});

test('os dois temas usam as imagens enviadas em escala e movimento comuns', () => {
  const css = read('wallpaper-standard.css').toString('utf8');
  assert.match(css, /--aldeckot-wallpaper-duration:\s*28s/);
  assert.match(css, /background-dark\.png\?v=2\.0\.89/);
  assert.match(css, /background-light-v2\.png\?v=2\.0\.89/);
  assert.match(css, /@keyframes aldeckot-wallpaper-orbit\s*\{[\s\S]*?25%[\s\S]*?50%[\s\S]*?75%/);
  assert.match(css, /animation:\s*aldeckot-wallpaper-orbit var\(--aldeckot-wallpaper-duration\)/);
  assert.match(css, /animation-delay:\s*var\(--aldeckot-wallpaper-phase\)/);
  assert.match(css, /body\.home-page \.app\s*\{\s*background-image:\s*none !important; animation:\s*none !important;/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);

  const dark = read('assets/background-dark.png');
  const light = read('assets/background-light-v2.png');
  assert.equal(dark.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(light.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(dark.readUInt32BE(20), light.readUInt32BE(20));
  assert.ok(Math.abs(dark.readUInt32BE(16) - light.readUInt32BE(16)) <= 1);
  assert.deepEqual(read('assets/background-light.png'), light);
});

test('a fase do movimento acompanha o relógio ao navegar e voltar à aba', () => {
  const listeners = new Map();
  const styleValues = new Map();
  let now = 33_000;
  const rootElement = { style: { setProperty: (name, value) => styleValues.set(name, value) } };
  const document = {
    documentElement: rootElement,
    hidden: false,
    addEventListener: (name, callback) => listeners.set(name, callback)
  };
  const window = { addEventListener: (name, callback) => listeners.set(name, callback) };
  runInNewContext(read('wallpaper-standard.js').toString('utf8'), {
    document, window, Date: { now: () => now },
    getComputedStyle: () => ({ getPropertyValue: () => '28s' })
  });
  assert.equal(styleValues.get('--aldeckot-wallpaper-phase'), '-5000ms');
  now = 34_000;
  listeners.get('pageshow')();
  assert.equal(styleValues.get('--aldeckot-wallpaper-phase'), '-6000ms');
  now = 35_000;
  listeners.get('visibilitychange')();
  assert.equal(styleValues.get('--aldeckot-wallpaper-phase'), '-7000ms');
});
