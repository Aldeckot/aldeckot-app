import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { simulation } = require('../inventory-branches.js');
const source = process.argv[2];
if (!source) {
  console.error('Uso: node scripts/simulate-inventory-branches.mjs <backup-do-inventario.json>');
  process.exitCode = 1;
} else {
  try {
    const input = JSON.parse(readFileSync(source, 'utf8'));
    const tables = input.data?.tables || input.tables;
    if (!Array.isArray(tables)) throw new Error('O arquivo precisa conter data.tables ou tables.');
    console.log(JSON.stringify(simulation(tables), null, 2));
  } catch (error) {
    console.error(`Simulação não executada: ${error.message}`);
    process.exitCode = 1;
  }
}
