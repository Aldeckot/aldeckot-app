const { ensureConfig, normalizeEmail, normalizeName, passwordValid, requestSupabase, send } = require('../server/supabase-admin');

module.exports = async (request, response) => {
  if (request.method !== 'POST') return send(response, 405, { error: 'Método não permitido.' });
  const config = ensureConfig(response);
  if (!config) return;
  try {
    const name = normalizeName(process.env.ALDECKOT_BOOTSTRAP_ADMIN_NAME);
    const email = normalizeEmail(process.env.ALDECKOT_BOOTSTRAP_ADMIN_EMAIL);
    const password = process.env.ALDECKOT_BOOTSTRAP_ADMIN_PASSWORD;
    if (name.length < 3 || !/^\S+@\S+\.\S+$/.test(email) || !passwordValid(password)) {
      return send(response, 503, { error: 'Administrador inicial ainda não foi configurado no ambiente seguro.' });
    }
    const records = await requestSupabase(config, '/auth/v1/admin/users?per_page=1000&page=1');
    const candidates = records?.users || records || [];
    let user = candidates.find(candidate => normalizeEmail(candidate.email) === email);
    const currentProfile = user?.id ? await requestSupabase(config, `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,status&limit=1`) : [];
    if (currentProfile?.[0]?.role === 'admin' && currentProfile[0].status === 'active') {
      return send(response, 200, { configured: true });
    }
    const created = !user;
    if (!user) {
      user = await requestSupabase(config, '/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } })
      });
    } else {
      await requestSupabase(config, `/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } })
      });
    }
    await requestSupabase(config, '/rest/v1/profiles?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: user.id, display_name: name, full_name: name, email, role: 'admin', status: 'active' })
    });
    await requestSupabase(config, '/rest/v1/user_audit_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ actor_id: user.id, target_user_id: user.id, action: created ? 'bootstrap_admin_created' : 'bootstrap_admin_repaired', details: {} })
    });
    return send(response, created ? 201 : 200, { configured: true });
  } catch (error) {
    return send(response, error.status || 500, { error: 'Não foi possível configurar o administrador inicial.' });
  }
};
