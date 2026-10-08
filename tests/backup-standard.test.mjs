import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

test('todos os módulos com backup carregam o padrão visual do Inventário', () => {
  for (const page of ['inventory.html', 'control.html', 'flux.html', 'management.html', 'nfe.html', 'supplies.html']) {
    assert.match(read(page), /backup-standard\.css\?v=2\.0\.72/, page);
  }
  const css = read('backup-standard.css');
  for (const selector of ['.backup-dialog', '.management-backup-dialog', '.nfe-backup-dialog', '.sp-backup-dialog']) {
    assert.ok(css.includes(selector), selector);
  }
});

test('Suprimentos adota a hierarquia visual sem oferecer restauração insegura', () => {
  const source = read('supplies-backup.js');
  assert.match(source, /Sistema de Backup/);
  assert.match(source, /Último backup/);
  assert.match(source, /Criar Backup/);
  assert.match(source, /Histórico de backups/);
  assert.match(source, /Restaurar Backup<\/b><small>Indisponível/);
  assert.match(source, /data-sp-backup="local"/);
  assert.match(source, /data-sp-backup="network"/);
  assert.match(source, /data-sp-backup="download-history"/);
  assert.doesNotMatch(source, /data-sp-backup="confirm-restore"/);
});
