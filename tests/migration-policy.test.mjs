import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-migrations.mjs');

test('migração publicada é imutável; nova migração recebe plano e checksum', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'aldeckot-migrations-'));
  const run = (command, args = []) => spawnSync(command, args, { cwd: fixture, encoding: 'utf8' });
  try {
    mkdirSync(join(fixture, 'scripts'));
    mkdirSync(join(fixture, 'supabase'));
    copyFileSync(source, join(fixture, 'scripts', 'check-migrations.mjs'));
    writeFileSync(join(fixture, 'supabase', '001_initial.sql'), 'select 1;\n');
    writeFileSync(join(fixture, 'supabase', '002_next.sql'), 'select 2;\n');
    assert.equal(run('git', ['init', '-q']).status, 0);
    assert.equal(run('git', ['add', '.']).status, 0);
    assert.equal(run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'baseline']).status, 0);

    const checker = (...args) => run(process.execPath, ['scripts/check-migrations.mjs', ...args]);
    assert.equal(checker('--base', 'HEAD').status, 0);

    writeFileSync(join(fixture, 'supabase', '001_initial.sql'), 'select 99;\n');
    const changed = checker('--base', 'HEAD');
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /Migrações já existentes não podem ser alteradas/);

    writeFileSync(join(fixture, 'supabase', '001_initial.sql'), 'select 1;\n');
    writeFileSync(join(fixture, 'supabase', '003_new.sql'), 'select 3;\n');
    const pending = checker('--base', 'HEAD', '--pending-after', '002');
    assert.equal(pending.status, 0, pending.stderr);
    assert.match(pending.stdout, /003_new\.sql  SHA-256 [a-f0-9]{64}/);
    assert.equal(readFileSync(join(fixture, 'supabase', '003_new.sql'), 'utf8'), 'select 3;\n');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
