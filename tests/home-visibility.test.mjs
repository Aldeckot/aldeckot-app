import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const version = JSON.parse(read('package.json')).version.replaceAll('.', '\\.');

test('marca animada, versão sem moldura e busca sem quadro permanecem visíveis na Home', () => {
  const styles = read('home-visibility.css');
  const index = read('index.html');
  assert.match(index, new RegExp(`home-visibility\\.css\\?v=${version}`));
  assert.match(styles, /\.home-page \.side \.brand b \{[^}]*background: linear-gradient\(90deg, #27d6ef, #726aff\);[^}]*animation: aldeckot-gradient 5\.5s/s);
  assert.match(styles, /\.home-page \.side \.brand \.home-brand-subtitle \{[^}]*font-size: 11px;/s);
  assert.match(styles, /\.home-page \.side \.brand \.home-brand-subtitle \{[^}]*padding: 0;[^}]*border: 0;[^}]*background: none;/s);
  assert.match(styles, /\.home-page \.side \.sidebar-search \.input \{[^}]*opacity: 1;[^}]*pointer-events: auto;/s);
  assert.match(styles, /\.home-page \.side \.sidebar-search \{\s*width: 132px;\s*max-width: 132px;/);
  assert.match(styles, /\.home-page \.side \.sidebar-search \.input \{[^}]*border: 0;[^}]*background: transparent;[^}]*box-shadow: none;[^}]*backdrop-filter: none;/s);
  assert.match(styles, /\.home-page \.side \.sidebar-search \.search-icon::before \{[^}]*width: 22px;[^}]*height: 22px;/s);
});

test('dica animada não interfere na busca digitada, no foco ou no movimento reduzido', () => {
  const search = read('central-equipment.js');
  const index = read('index.html');
  assert.match(index, new RegExp(`central-equipment\\.js\\?v=${version}`));
  assert.match(search, /const text = 'Seeking\.\.\.'/);
  assert.match(search, /length \+ \(deleting \? -1 : 1\)/);
  assert.match(search, /length === text\.length \? 1500 : length === 0 \? 700 : deleting \? 140 : 190/);
  assert.match(search, /document\.activeElement === input \|\| input\.value/);
  assert.match(search, /prefers-reduced-motion: reduce/);
  assert.match(search, /animateSearchPlaceholder\(input\)/);
});

test('painel diário fica oculto quando não há entradas para o dia', () => {
  const agenda = read('agenda.js');
  const styles = read('home-visibility.css');
  assert.match(agenda, /const todays = events\.filter\(event => event\.date === iso\(today\)\)/);
  assert.match(agenda, /panel\.hidden = !todays\.length/);
  assert.match(styles, /\.home-page \.agenda-today-panel\[hidden\] \{\s*display: none !important;/);
});

test('post-it alerta apenas após o dia agendado quando ainda há tarefas pendentes', () => {
  const notes = read('postit-notes.js');
  const styles = read('postit-notes.css');
  const index = read('index.html');
  assert.match(index, new RegExp(`postit-notes\\.css\\?v=${version}`));
  assert.match(index, new RegExp(`postit-notes\\.js\\?v=${version}`));
  assert.match(notes, /const noteOverdue = \(note, today\) => [^;]*note\.date < today && normalizeTasks\(note\.postitTasks\)\.some\(task => !task\.completed\);/s);
  assert.match(notes, /overdue \? ' is-overdue' : ''/);
  assert.match(notes, /window\.setInterval\(refreshOverdueState, 60_000\)/);
  assert.match(styles, /\.postit-note\.is-overdue:not\(\.is-dragging\):not\(:hover\):not\(:focus-within\)\{animation:postit-overdue-shake/);
  assert.match(styles, /\.postit-note\.is-overdue::after\{[^}]*opacity:\.58;[^}]*url\('assets\/postit-crumpled-paper\.jpg'\)/);
  assert.match(styles, /\.postit-checklist b\{[^}]*color:#061b27;[^}]*font-weight:800;[^}]*text-shadow:/);
  assert.match(styles, /\.postit-checklist \.is-completed b\{[^}]*opacity:1\}/);
  assert.match(styles, /\.postit-note\.is-overdue\{clip-path:polygon\(/);
  assert.ok(existsSync(new URL('../assets/postit-crumpled-paper.jpg', import.meta.url)));
  assert.match(styles, /prefers-reduced-motion:reduce[^}]*\.postit-note\.is-overdue/);
});

test('post-its futuros, concluídos ou sem tarefas não recebem alerta visual', () => {
  const board = { dataset: {}, innerHTML: '', hidden: true };
  const home = { querySelector: () => board };
  const listeners = {};
  const document = {
    querySelector: selector => selector === '.home-reference' ? home : null,
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  const window = {
    AldeckotAuth: { isAdmin: false },
    addEventListener: (name, listener) => { listeners[name] = listener; },
    setInterval: () => 0,
    setTimeout: () => 0
  };
  runInNewContext(read('postit-notes.js'), { document, window });
  const task = completed => [{ id: 't1', title: 'Verificar', completed }];
  listeners['aldeckot:agenda-ready']({ detail: { entries: [
    { id: 'late', kind: 'note', title: 'Vencida', date: '2000-01-01', postitTasks: task(false) },
    { id: 'future', kind: 'note', title: 'Futura', date: '2999-01-01', postitTasks: task(false) },
    { id: 'done', kind: 'note', title: 'Concluída', date: '2000-01-01', postitTasks: task(true) },
    { id: 'empty', kind: 'note', title: 'Sem itens', date: '2000-01-01', postitTasks: [] }
  ] } });
  assert.match(board.innerHTML, /class="postit-note postit-verify is-overdue" data-postit-id="late"/);
  assert.match(board.innerHTML, /class="postit-note postit-verify" data-postit-id="future"/);
  assert.match(board.innerHTML, /class="postit-note postit-verify" data-postit-id="empty"/);
  assert.doesNotMatch(board.innerHTML, /data-postit-id="done"/);
});
