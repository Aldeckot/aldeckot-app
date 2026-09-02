const { ensureConfig, normalizeEmail, normalizeName, passwordValid, readBody, requestSupabase, send } = require('../server/supabase-admin');

module.exports = async (request, response) => {
  if (request.method !== 'POST') return send(response, 405, { error: 'Método não permitido.' });
  const config = ensureConfig(response);
  if (!config) return;
  const { fullName, email, password } = readBody(request);
  const cleanName = normalizeName(fullName);
  const cleanEmail = normalizeEmail(email);
  if (cleanName.length < 3 || !/^\S+@\S+\.\S+$/.test(cleanEmail) || !passwordValid(password)) {
    return send(response, 400, { error: 'Informe nome completo, e-mail válido e senha com ao menos 8 caracteres.' });
  }
  try {
    const user = await requestSupabase(config, '/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: cleanEmail, password, email_confirm: true, user_metadata: { full_name: cleanName } })
    });
    await requestSupabase(config, '/rest/v1/profiles?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: user.id, display_name: cleanName, full_name: cleanName, email: cleanEmail, role: 'standard', status: 'pending' })
    });
    await requestSupabase(config, '/rest/v1/user_audit_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ target_user_id: user.id, action: 'access_requested', details: { email: cleanEmail } })
    });
    return send(response, 201, { message: 'Solicitação enviada. Sua conta está aguardando aprovação do administrador.' });
  } catch (error) {
    const duplicate = /already|exists|registered|duplicate/i.test(`${error.message} ${JSON.stringify(error.body || {})}`);
    return send(response, duplicate ? 409 : (error.status || 500), { error: duplicate ? 'Já existe uma conta com este e-mail.' : 'Não foi possível enviar sua solicitação.' });
  }
};
