import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');
const packageVersion = JSON.parse(read('package.json')).version;
const lock = JSON.parse(read('package-lock.json'));
const versionSource = read('system-version.js');
const home = read('index.html');
const semver = /^\d+\.\d+\.\d+$/;

if (!semver.test(packageVersion)) throw new Error(`Versão inválida em package.json: ${packageVersion}`);

const versions = {
  'package-lock.json': lock.version,
  'package-lock.json (raiz)': lock.packages?.['']?.version,
  'system-version.js': versionSource.match(/\bconst value = '([^']+)'/)?.[1],
  'index.html (texto inicial)': home.match(/data-aldeckot-brand-subtitle="SISTEMA DE GESTÃO">SISTEMA DE GESTÃO V([^<]+)/)?.[1]
};

for (const [file, value] of Object.entries(versions)) {
  if (value !== packageVersion) throw new Error(`${file} usa ${value || 'nenhuma versão'}; esperado: ${packageVersion}.`);
}
if (!home.includes(`system-version.js?v=${packageVersion}"`)) {
  throw new Error('Atualize também a chave de cache de system-version.js em index.html.');
}

const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
const compare = (previous, source) => {
  if (!semver.test(previous)) throw new Error(`Versão anterior inválida em ${source}: ${previous}`);
  const currentParts = packageVersion.split('.').map(Number);
  const previousParts = previous.split('.').map(Number);
  const increased = currentParts.findIndex((part, index) => part !== previousParts[index]);
  if (increased < 0 || currentParts[increased] < previousParts[increased]) {
    throw new Error(`Uma alteração do projeto exige versão maior que ${previous} (${source}); atual: ${packageVersion}.`);
  }
};
const previousVersion = ref => {
  const result = git(['show', `${ref}:package.json`]);
  if (result.status !== 0) throw new Error(`Não foi possível ler package.json em ${ref}: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout).version;
};

const baseIndex = process.argv.indexOf('--base');
let checkedIncrement = false;
if (baseIndex >= 0) {
  const base = process.argv[baseIndex + 1];
  if (!base || base.startsWith('--')) throw new Error('Informe uma referência após --base.');
  compare(previousVersion(base), base);
  checkedIncrement = true;
} else {
  const status = git(['status', '--porcelain', '--untracked-files=all']);
  if (status.status === 0 && status.stdout.trim()) {
    compare(previousVersion('HEAD'), 'HEAD');
    checkedIncrement = true;
  }
}

console.log(`✓ Versão ${packageVersion} sincronizada${checkedIncrement ? ' e incrementada para as alterações atuais' : ''}.`);
