const { createInternalAuthEmail, ensureConfig, normalizeName, normalizeUserCode, passwordValid, readBody, requestSupabase, send, userCodeValid } = require('../server/supabase-admin');

module.exports = async (request, response) => {
  if (request.method !== 'POST') return send(response, 405, { error: 'Método não permitido.' });
  const config = ensureConfig(response);
  if (!config) return;
  const { fullName, userCode, password } = readBody(request);
  const cleanName = normalizeName(fullName);
  const cleanUserCode = normalizeUserCode(userCode);
  if (cleanName.length < 3 || !userCodeValid(cleanUserCode) || !passwordValid(password)) {
    return send(response, 400, { error: 'Informe nome completo, código de usuário válido e senha com ao menos 8 caracteres.' });
  }
  try {
    const existing = await requestSupabase(config, `/rest/v1/profiles?user_code=eq.${encodeURIComponent(cleanUserCode)}&select=id&limit=1`);
    if (existing?.length) return send(response, 409, { error: 'Este código de usuário já está em uso.' });
    const internalEmail = createInternalAuthEmail();
    const user = await requestSupabase(config, '/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: internalEmail, password, email_confirm: true, user_metadata: { full_name: cleanName, user_code: cleanUserCode } })
    });
    await requestSupabase(config, '/rest/v1/profiles?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: user.id, display_name: cleanName, full_name: cleanName, user_code: cleanUserCode, email: internalEmail, role: 'standard', status: 'pending' })
    });
    await requestSupabase(config, '/rest/v1/user_audit_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ target_user_id: user.id, action: 'access_requested', details: { userCode: cleanUserCode } })
    });
    return send(response, 201, { message: 'Solicitação enviada. Sua conta está aguardando aprovação do administrador.' });
  } catch (error) {
    const duplicate = /already|exists|registered|duplicate/i.test(`${error.message} ${JSON.stringify(error.body || {})}`);
    return send(response, duplicate ? 409 : (error.status || 500), { error: duplicate ? 'Este código de usuário já está em uso.' : 'Não foi possível enviar sua solicitação.' });
  }
};
