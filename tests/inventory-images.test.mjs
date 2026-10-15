import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const images = require('../inventory-images.js');
const view = readFileSync(new URL('../inventory.js', import.meta.url), 'utf8');
const inventoryPage = readFileSync(new URL('../inventory.html', import.meta.url), 'utf8');
const homePage = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../inventory-global.css', import.meta.url), 'utf8');
const branchStyles = readFileSync(new URL('../inventory-branches.css', import.meta.url), 'utf8');

test('imagem da variante acompanha categoria com acentos e emoji', () => {
  const catalog = images.build(
    [{ id: 'group-1', inventory_group_key: 'balanças', category: 'Balanças', image_path: 'groups/scale.png' }],
    [{ supply_id: 'group-1', inventory_brand: 'Toledo', inventory_model: '9094C/6', image_path: 'variants/scale.png' }]
  );
  assert.equal(images.pathFor(catalog, 'BALANÇAS ⚖️', 'toledo', '9094C/6'), 'variants/scale.png');
  assert.equal(images.pathForKey(catalog, images.modelKey('BALANÇAS ⚖️', 'Toledo', '9094C/6')), 'variants/scale.png');
  assert.equal(images.pathFor(catalog, 'Balanças', 'Outra', 'Modelo'), 'groups/scale.png');
  assert.equal(images.pathFor(catalog, 'Leitores', 'Toledo', '9094C/6'), 'variants/scale.png');
});

test('mesmo modelo usa foto única entre categorias sem trocar imagens ambíguas', () => {
  const unique = images.build([
    { id: 'printer', category: 'Impressoras', brand: 'Bematech', model: 'MP-420', image_path: 'models/bematech.png' }
  ]);
  assert.equal(images.pathFor(unique, 'Impressoras de Checkout', 'Bematech', 'MP-420'), 'models/bematech.png');
  const ambiguous = images.build([
    { id: 'one', category: 'Checkout', brand: 'Marca', model: 'X', image_path: 'one.png' },
    { id: 'two', category: 'Setor', brand: 'Marca', model: 'X', image_path: 'two.png' }
  ]);
  assert.equal(images.pathFor(ambiguous, 'Terceira categoria', 'Marca', 'X'), null);
  assert.equal(images.pathFor(ambiguous, 'Checkout', 'Marca', 'X'), 'one.png');
});

test('chave legada da variante e imagem própria do modelo continuam acessíveis', () => {
  const catalog = images.build(
    [{ id: 'manual-1', category: 'Nobreaks', brand: 'APC', model: 'Back UPS 600', image_path: 'models/apc.png' },
      { id: 'group-2', inventory_group_key: 'máquinas de cartões' }],
    [{ supply_id: 'group-2', inventory_variant_key: 'Gertec\u001fPPC 930', image_path: 'variants/gertec.png' }]
  );
  assert.equal(images.pathFor(catalog, 'NOBREAKS 🔋', 'apc', 'Back UPS 600'), 'models/apc.png');
  assert.equal(images.pathFor(catalog, 'MÁQUINAS DE CARTÕES 🧮', 'Gertec', 'PPC 930'), 'variants/gertec.png');
  assert.equal(images.pathFor(catalog, 'MÁQUINAS DE CARTÕES', 'Outro', 'Sem foto'), null);
});

test('busca e integração de imagens estão disponíveis nas duas entradas do Inventário', () => {
  assert.match(styles, /max-width:620px/);
  assert.doesNotMatch(view, /insertAdjacentHTML\('afterbegin', '<button[^']*simulate-branches/);
  assert.match(view, /imageCatalog\.pathForKey/);
  assert.match(view, /imageMetadataPages/);
  for (const page of [inventoryPage, homePage]) {
    assert.match(page, /inventory-images\.js\?v=/);
    assert.ok(page.indexOf('inventory-images.js') < page.indexOf('inventory.js'));
  }
});

test('foto do modal ocupa uma área única sem placeholder sobreposto e campos compactos', () => {
  assert.match(branchStyles, /\.inv-equipment-image img\{position:absolute;inset:0;[^}]*object-fit:contain/);
  assert.match(branchStyles, /\.inv-equipment-image \.inventory-image-placeholder\[hidden\]\{display:none\}/);
  assert.match(branchStyles, /\.inv-equipment-section \.inv-detail\{min-height:56px;padding:8px 11px\}/);
  assert.doesNotMatch(branchStyles, /\.inv-equipment-section \.inv-detail\{[^}]*font-size:/);
});

test('miniaturas ocultas iniciam o carregamento e o modal não espera URLs em série', () => {
  assert.match(branchStyles, /\.inventory-image-cell \.inventory-image-placeholder\[hidden\]\{display:none\}/);
  assert.match(view, /data-inv-image-key="\$\{image\}" alt="" loading="eager" decoding="async" hidden/);
  assert.match(view, /await Promise\.all\(\[\.\.\.document\.querySelectorAll\('\[data-inv-image-key\]'\)\]\.map\(async node =>/);
  assert.match(view, /if \(node\.complete && node\.naturalWidth\) node\.onload\(\)/);
  assert.doesNotMatch(view, /sharedImagesLoadedAt = Date\.now\(\);\s*signedImageUrls\.clear\(\)/);
});
