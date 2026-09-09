import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'supabase');
const retiredNumbers = new Set([13]);
const migrations = readdirSync(directory)
  .map(name => ({ name, match: /^(\d{3})_[a-z0-9_]+\.sql$/i.exec(name) }))
  .filter(entry => entry.match)
  .map(entry => ({ name: entry.name, number: Number(entry.match[1]) }))
  .sort((left, right) => left.number - right.number);

if (!migrations.length) throw new Error('Nenhuma migração SQL foi encontrada.');

const seen = new Set();
for (const migration of migrations) {
  if (seen.has(migration.number)) throw new Error(`Número de migração repetido: ${String(migration.number).padStart(3, '0')}.`);
  seen.add(migration.number);
}

for (let number = migrations[0].number; number <= migrations.at(-1).number; number += 1) {
  if (!seen.has(number) && !retiredNumbers.has(number)) {
    throw new Error(`Falta a migração ${String(number).padStart(3, '0')}.`);
  }
}

if (migrations[0].number !== 1) throw new Error('A primeira migração deve ser a 001.');
console.log(`✓ ${migrations.length} migrações verificadas (013 é uma numeração retirada e documentada).`);
