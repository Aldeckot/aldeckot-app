import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { localFilePath } from '../scripts/local-preview-server.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('prévia local serve apenas páginas e recursos públicos', () => {
  assert.equal(localFilePath('/'), resolve(root, 'index.html'));
  assert.equal(localFilePath('/nfe.html'), resolve(root, 'nfe.html'));
  assert.equal(localFilePath('/assets/aldeckot-favicon.png'), resolve(root, 'assets/aldeckot-favicon.png'));

  for (const path of ['/.env', '/.git/config', '/package.json', '/scripts/check-version.mjs', '/supabase/079_inventory_branches.sql', '/assets/../.env']) {
    assert.equal(localFilePath(path), null, `${path} não deve ser público`);
  }
});
