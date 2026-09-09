import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['.git', 'node_modules']);
const pageNames = ['index.html', 'login.html', 'inventory.html', 'management.html', 'control.html', 'flux.html', 'nfe.html', 'settings.html'];
const scriptFiles = [];

const walk = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) walk(join(directory, entry.name));
    } else if (extname(entry.name) === '.js' || extname(entry.name) === '.mjs') {
      scriptFiles.push(join(directory, entry.name));
    }
  }
};

walk(root);
for (const file of scriptFiles) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`Erro de sintaxe em ${relative(root, file)}:\n${check.stderr || check.stdout}`);
}

for (const pageName of pageNames) {
  const source = readFileSync(join(root, pageName), 'utf8');
  if (!source.includes('error-monitor.js')) throw new Error(`${pageName} não inclui o monitoramento de erros.`);
  if (!source.includes('loading-indicator.js')) throw new Error(`${pageName} não inclui o indicador de carregamento.`);
  if (!/<html[^>]+lang=["']pt-BR["']/i.test(source)) throw new Error(`${pageName} não declara o idioma da interface.`);
}

const ignore = readFileSync(join(root, '.gitignore'), 'utf8');
for (const sensitiveFile of ['.env', 'supabase-config.js']) {
  if (!ignore.split(/\r?\n/).map(line => line.trim()).includes(sensitiveFile)) {
    throw new Error(`${sensitiveFile} deve permanecer fora do Git.`);
  }
}

console.log(`✓ Sintaxe validada em ${scriptFiles.length} scripts e páginas essenciais verificadas.`);
