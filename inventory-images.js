/* Resolve imagens do catálogo de Suprimentos sem copiar arquivos para o Inventário. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AldeckotInventoryImages = api;
})(typeof window !== 'undefined' ? window : null, () => {
  const normalize = value => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ').trim();
  const categoryKey = value => normalize(String(value || '')
    .replace(/[^\p{L}\p{N}\s/-]/gu, ' '));
  const modelKey = (category, brand, model) =>
    [categoryKey(category), normalize(brand), normalize(model)].join('|');
  const identityKey = (brand, model) => [normalize(brand), normalize(model)].join('|');

  function build(supplies = [], variants = []) {
    const parents = new Map(supplies.map(row => [row.id, row]));
    const models = new Map();
    const categories = new Map();
    const identities = new Map();
    const registerModel = (category, brand, model, path) => {
      if (!brand || !model) return;
      models.set(modelKey(category, brand, model), path);
      const key = identityKey(brand, model);
      if (!identities.has(key)) identities.set(key, path);
      else if (identities.get(key) !== path) identities.set(key, null);
    };
    for (const row of supplies) {
      if (!row.image_path) continue;
      const category = categoryKey(row.inventory_group_key || row.category || row.name);
      if (!category) continue;
      registerModel(category, row.brand, row.model, row.image_path);
      if (row.inventory_group_key && !categories.has(category)) categories.set(category, row.image_path);
    }
    for (const row of variants) {
      if (!row.image_path) continue;
      const parent = parents.get(row.supply_id);
      if (!parent) continue;
      const category = categoryKey(parent.inventory_group_key || parent.category || parent.name);
      const [keyBrand, keyModel] = String(row.inventory_variant_key || '').split('\u001f');
      const brand = row.inventory_brand || keyBrand;
      const model = row.inventory_model || keyModel;
      if (category) registerModel(category, brand, model, row.image_path);
    }
    return { models, categories, identities };
  }

  const pathFor = (catalog, category, brand, model) => pathForKey(catalog, modelKey(category, brand, model));
  const pathForKey = (catalog, key) => {
    const [category, brand, model] = String(key || '').split('|');
    return catalog?.models?.get(key)
      || (brand && model && catalog?.identities?.get(identityKey(brand, model)))
      || catalog?.categories?.get(category) || null;
  };

  return { normalize, categoryKey, modelKey, build, pathFor, pathForKey };
});
