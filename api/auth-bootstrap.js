const { ensureConfig, normalizeEmail, normalizeName, passwordValid, requestSupabase, send } = require('../server/supabase-admin');

module.exports = async (request, response) => {
  if (request.method !== 'POST') return send(response, 405, { error: 'Método não permitido.' });
  const config = ensureConfig(response);
  if (!config) return;
  try {
    const admins = await requestSupabase(config, '/rest/v1/profiles?select=id&role=eq.admin&status=eq.active&limit=1');
    if (admins?.length) return send(response, 200, { configured: true });
    const name = normalizeName(process.env.ALDECKOT_BOOTSTRAP_ADMIN_NAME);
    const email = normalizeEmail(process.env.ALDECKOT_BOOTSTRAP_ADMIN_EMAIL);
    const password = process.env.ALDECKOT_BOOTSTRAP_ADMIN_PASSWORD;
    if (name.length < 3 || !/^\S+@\S+\.\S+$/.test(email) || !passwordValid(password)) {
      return send(response, 503, { error: 'Administrador inicial ainda não foi configurado no ambiente seguro.' });
    }
    let user;
    try {
      user = await requestSupabase(config, '/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } })
      });
    } catch (error) {
      const duplicate = /already|exists|registered|duplicate/i.test(`${error.message} ${JSON.stringify(error.body || {})}`);
      if (!duplicate) throw error;
      const records = await requestSupabase(config, '/auth/v1/admin/users?per_page=100&page=1');
      const candidates = records?.users || records || [];
      user = candidates.find(candidate => normalizeEmail(candidate.email) === email);
      if (!user?.id) throw error;
    }
    await requestSupabase(config, '/rest/v1/profiles?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: user.id, display_name: name, full_name: name, email, role: 'admin', status: 'active' })
    });
    await requestSupabase(config, '/rest/v1/user_audit_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ actor_id: user.id, target_user_id: user.id, action: 'bootstrap_admin_created', details: {} })
    });
    return send(response, 201, { configured: true });
  } catch (error) {
    return send(response, error.status || 500, { error: 'Não foi possível configurar o administrador inicial.' });
  }
};
