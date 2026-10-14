import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../nfe.html', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../nfe-header-layout.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../nfe-theme.css', import.meta.url), 'utf8');
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test('Fiscal NF-e keeps search, title and actions in one desktop header row', () => {
  assert.match(layout, /\.nfe-table-head\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(155px, 1fr\) minmax\(170px, 230px\) max-content/s);
  assert.doesNotMatch(layout, /\.nfe-table-actions\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(layout, /@media \(max-width: 760px\)[\s\S]*\.nfe-table-head\s*\{[^}]*flex-direction:\s*column/s);
});

test('Fiscal NF-e loads the shared wallpaper and its theme finish last', () => {
  assert.match(html, /wallpaper-standard\.css\?v=/);
  assert.match(html, /glass-transparency\.css\?v=/);
  assert.ok(html.includes(`nfe-theme.css?v=${version}`));
  assert.ok(html.indexOf('nfe-theme.css') > html.indexOf('glass-transparency.css'));
  assert.match(theme, /body\.nfe-open::before\s*\{[^}]*content:\s*'';[^}]*z-index:\s*0;/s);
  assert.match(theme, /body\.theme-light\.nfe-open::before\s*\{[^}]*aldeckot-wallpaper-light/s);
  assert.match(theme, /body\.nfe-open \.nfe-app\s*\{[^}]*z-index:\s*1/s);
  assert.match(theme, /body\.nfe-open \.nfe-table-head\s*\{[^}]*grid-template-areas:\s*'title search actions'/s);
  assert.match(theme, /body\.nfe-open:not\(\.theme-light\)/);
  assert.match(theme, /body\.theme-light\.nfe-open/);
  assert.match(theme, /prefers-reduced-motion:\s*reduce/);
});
