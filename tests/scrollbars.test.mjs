import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('todos os módulos usam as barras de rolagem compartilhadas', () => {
  for (const page of ['index.html', 'inventory.html', 'management.html', 'control.html', 'flux.html', 'nfe.html', 'supplies.html']) {
    assert.match(read(page), /scrollbars\.css\?v=20261007-translucent1/, page);
  }
});

test('trilho transparente e indicador translúcido acompanham os dois temas', () => {
  const styles = read('scrollbars.css');
  assert.match(styles, /scrollbar-color:\s*var\(--app-scroll-thumb\) transparent/);
  assert.match(styles, /background:\s*transparent/);
  assert.match(styles, /backdrop-filter:\s*blur\(/);
  assert.match(styles, /html\[data-theme="light"\]/);
  assert.match(styles, /\.central-equipment-dialog::-webkit-scrollbar-thumb/);
  assert.doesNotMatch(read('home-notifications.css'), /scrollbar-color:\s*#[\da-f]+/i);
  assert.doesNotMatch(read('module-notifications.css'), /scrollbar-color:\s*#[\da-f]+/i);
});
