/* Fotografia oficial de cada equipamento, vinculada por IDs confirmados no banco. */
((root, factory) => {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AldeckotEquipmentPhoto = api;
})(typeof window !== 'undefined' ? window : null, root => {
  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const storage = 'supply-images';
  const channel = root && typeof root.BroadcastChannel === 'function'
    ? new root.BroadcastChannel('aldeckot:equipment-photos') : null;
  channel?.addEventListener('message', event => {
    root.dispatchEvent(new CustomEvent('aldeckot:equipment-photo-changed', { detail: event.data }));
  });
  const announce = detail => {
    channel?.postMessage(detail);
  };
  const client = async () => (await root.AldeckotSupabase.init()).client;
  const check = result => { if (result.error) throw result.error; return result.data; };
  const args = (module, id) => ({ p_module: module, p_id: id });
  const officialPath = path => /^equipment\/[0-9a-f-]{36}\/[0-9a-f]{32}\.(?:png|jpg|webp)$/i.test(path || '');
  async function get(module, id) {
    if (!module || !id) return null;
    return check(await (await client()).rpc('equipment_photo_get', args(module, id)));
  }
  async function url(path) {
    if (!path) return '';
    if (root.AldeckotEquipmentImages?.urlForPath) return root.AldeckotEquipmentImages.urlForPath(path);
    return check(await (await client()).storage.from(storage).createSignedUrl(path, 3600))?.signedUrl || '';
  }
  async function isReferenced(db, path) {
    const results = await Promise.all([
      db.from('equipment_photos').select('equipment_id').eq('image_path', path).limit(1),
      db.from('supplies').select('id').eq('image_path', path).limit(1),
      db.from('supply_variants').select('id').eq('image_path', path).limit(1)
    ]);
    return results.some(result => result.error || result.data?.length);
  }
  async function cleanup(db, path) {
    if (!officialPath(path) || await isReferenced(db, path)) return;
    const result = await db.storage.from(storage).remove([path]);
    if (result.error) console.warn('O arquivo anterior permaneceu no armazenamento para limpeza posterior.', result.error);
  }
  async function save(module, id, file, expectedPath = null) {
    if (!file || !allowed.has(file.type) || !file.size || file.size > 5242880)
      throw new Error('Escolha uma imagem PNG, JPG ou WebP de até 5 MB.');
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      try {
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 32000000)
          throw new Error('A imagem tem dimensões inválidas ou excessivas.');
      } finally { bitmap.close?.(); }
    }
    const db = await client();
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hash = [...new Uint8Array(digest)].slice(0, 16)
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `equipment/${id}/${hash}.${ext}`;
    if (path === expectedPath) return path;
    const uploaded = await db.storage.from(storage).upload(path, file, { upsert: false, contentType: file.type });
    const reused = uploaded.error && (String(uploaded.error.statusCode) === '409' || /already exists|duplicate/i.test(uploaded.error.message || ''));
    if (uploaded.error && !reused) throw uploaded.error;
    try {
      check(await db.rpc('equipment_photo_set', { ...args(module, id), p_path: path,
        p_expected_path: expectedPath }));
    } catch (error) {
      if (!reused) await cleanup(db, path);
      throw error;
    }
    if (expectedPath && expectedPath !== path) await cleanup(db, expectedPath);
    announce({ module, id, path });
    return path;
  }
  async function remove(module, id, expectedPath) {
    if (!expectedPath) return;
    const db = await client();
    check(await db.rpc('equipment_photo_set', { ...args(module, id), p_path: null,
      p_expected_path: expectedPath }));
    await cleanup(db, expectedPath);
    announce({ module, id, path: '' });
  }
  return { get, url, save, remove, officialPath };
});
