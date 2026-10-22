import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
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

const argument = flag => {
  const position = process.argv.indexOf(flag);
  if (position < 0) return null;
  const value = process.argv[position + 1];
  if (!value || value.startsWith('--')) throw new Error(`Informe um valor após ${flag}.`);
  return value;
};

const base = argument('--base');
const comparison = base || 'HEAD';
const diff = spawnSync('git', ['diff', '--name-status', '--no-renames', comparison, '--', 'supabase'], {
  cwd: root, encoding: 'utf8'
});
if (diff.status !== 0) {
  throw new Error(`Não foi possível comparar migrações com ${comparison} em ${root}: ${diff.stderr?.trim() || diff.error?.message || 'erro desconhecido'}`);
}
const changed = diff.stdout.trim().split(/\r?\n/).filter(Boolean)
  .map(line => line.split('\t'))
  .filter(([, path]) => path?.startsWith('supabase/') && /\d{3}_[a-z0-9_]+\.sql$/i.test(path.slice('supabase/'.length)))
  .filter(([status]) => status !== 'A');
if (changed.length) {
  throw new Error(`Migrações já existentes não podem ser alteradas ou removidas (${comparison}): ${changed.map(([, path]) => path).join(', ')}. Crie a próxima migração.`);
}

const pendingAfter = argument('--pending-after');
if (pendingAfter !== null) {
  if (!/^\d{3}$/.test(pendingAfter)) throw new Error('Use --pending-after com três dígitos, por exemplo 083.');
  const lastApplied = Number(pendingAfter);
  if (lastApplied > migrations.at(-1).number) throw new Error(`A migração ${pendingAfter} ainda não existe neste projeto.`);
  const pending = migrations.filter(migration => migration.number > lastApplied);
  console.log(`Plano local após ${pendingAfter} — confirme a última migração aplicada no ambiente antes de executar SQL:`);
  for (const migration of pending) {
    const digest = createHash('sha256').update(readFileSync(resolve(directory, migration.name))).digest('hex');
    console.log(`${migration.name}  SHA-256 ${digest}`);
  }
  if (!pending.length) console.log('Nenhuma migração pendente neste checkout.');
}
console.log(`✓ ${migrations.length} migrações verificadas (013 é uma numeração retirada e documentada).`);
