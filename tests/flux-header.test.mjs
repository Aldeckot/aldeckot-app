import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name), 'utf8');

test('cabeçalho do Flux usa arte transparente e animação enquadrada sem deslocamento', () => {
  const css = read('module-header-cards.css');
  const source = read('inventory.js');

  assert.match(css, /\.module-header-summary-art\.flux\s*\{\s*background-image:\s*url\('assets\/module-flux-illustration-transparent\.png'\)/);
  assert.match(css, /body\.inventory-open\[data-module="flux"\] \.inventory-header \.module-header-summary-art\.flux\s*\{[^}]*mix-blend-mode:\s*normal/s);
  assert.match(css, /body\.inventory-open\[data-module="flux"\] \.inventory-header \.module-header-animation \.flux-empty-illustration\s*\{[^}]*transform:\s*none/s);
  assert.match(css, /body\.inventory-open\[data-module="flux"\] \.inventory-header \.module-header-animation \.flux-empty-illustration\s*\{[^}]*mask-image:\s*linear-gradient\(90deg, transparent, #000 14%, #000 86%, transparent\)/s);
  assert.match(css, /body\.inventory-open\[data-module="flux"\] \.inventory-header \.module-header-animation \.flux-empty-road-surface\s*\{[^}]*stroke:\s*none/s);
  assert.match(source, /if \(fluxMode\) \{[^}]*querySelector\('\.flux-empty-illustration'\)\?\.setAttribute\('viewBox', '0 42 520 160'\)/s);
  const version = JSON.parse(read('package.json')).version;
  assert.ok(read('flux.html').includes(`module-header-cards.css?v=${version}`));
  assert.ok(read('flux.html').includes(`inventory.js?v=${version}`));
});
