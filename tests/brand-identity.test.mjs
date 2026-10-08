import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file));

test('o símbolo oficial está nos cabeçalhos e nos formatos de exportação', () => {
  const symbol = read('assets/aldeckot-symbol.png');
  assert.equal(symbol.subarray(1, 4).toString('ascii'), 'PNG');
  for (const file of ['index.html', 'login.html', 'settings.html', 'header-official-logo.js', 'supplies.js']) {
    assert.match(read(file).toString('utf8'), /assets\/aldeckot-symbol\.png\?v=2\.0\.71/);
  }
  for (const file of ['inventory.js', 'management.js', 'supplies.js']) {
    assert.match(read(file).toString('utf8'), /class="print-brand" src="\$\{printBrand\}"/);
  }
  for (const file of ['central-equipment.js', 'nfe.js', 'settings.js']) {
    assert.match(read(file).toString('utf8'), /AldeckotBrand\.pdfDataUrl\(\)/);
  }
});

test('o PDF mensal automático incorpora o símbolo e mantém referências válidas', () => {
  const file = resolve(root, 'api/monthly-audit-finalize.js');
  const context = {
    Buffer,
    __dirname: dirname(file),
    module: { exports: {} },
    require: createRequire(pathToFileURL(file))
  };
  runInNewContext(`${read('api/monthly-audit-finalize.js').toString('utf8')}\nmodule.exports.testPdfLines = pdfLines;`, context, { filename: file });
  const pdf = context.module.exports.testPdfLines('ALDECKOT - Relatório mensal', ['Resumo de teste']);
  assert.equal(pdf.subarray(0, 8).toString('ascii'), '%PDF-1.4');
  assert.ok(pdf.includes(read('assets/aldeckot-symbol-pdf.jpg')));
  assert.match(pdf.toString('latin1'), /\/XObject << \/Logo 4 0 R >>/);
  const marker = pdf.lastIndexOf(Buffer.from('startxref\n'));
  const xrefOffset = Number(pdf.subarray(marker + 10).toString('ascii').match(/^\d+/)?.[0]);
  const xref = pdf.subarray(xrefOffset).toString('ascii').split('\n');
  assert.equal(xref[0], 'xref');
  const count = Number(xref[1].split(' ')[1]);
  for (let id = 1; id < count; id += 1) {
    const offset = Number(xref[id + 2].slice(0, 10));
    assert.equal(pdf.subarray(offset, offset + `${id} 0 obj`.length).toString('ascii'), `${id} 0 obj`);
  }
});
