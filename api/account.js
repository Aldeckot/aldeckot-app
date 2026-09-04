const { audit, authenticate, normalizeName, normalizeUserCode, passwordValid, readBody, requestSupabase, send, userCodeValid } = require('../server/supabase-admin');

module.exports = async (request, response) => {
  if (request.method !== 'PATCH') return send(response, 405, { error: 'Método não permitido.' });
  const context = await authenticate(request, response);
  if (!context) return;
  const { fullName, userCode, password } = readBody(request);
  const cleanName = normalizeName(fullName);
  const cleanUserCode = normalizeUserCode(userCode ?? context.profile.user_code);
  if (cleanName.length < 3 || !userCodeValid(cleanUserCode) || (password && !passwordValid(password))) {
    return send(response, 400, { error: 'Informe nome completo, código de usuário válido e, se necessário, senha com ao menos 8 caracteres.' });
  }
  try {
    const authPayload = { user_metadata: { ...(context.user.user_metadata || {}), full_name: cleanName, user_code: cleanUserCode } };
    if (password) authPayload.password = password;
    await requestSupabase(context.config, `/auth/v1/admin/users/${encodeURIComponent(context.user.id)}`, {
      method: 'PUT', body: JSON.stringify(authPayload)
    });
    await requestSupabase(context.config, `/rest/v1/profiles?id=eq.${encodeURIComponent(context.user.id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ display_name: cleanName, full_name: cleanName, user_code: cleanUserCode })
    });
    await audit(context.config, context.user.id, context.user.id, 'account_security_updated', { changedName: cleanName !== context.profile.full_name, changedUserCode: cleanUserCode !== context.profile.user_code, changedPassword: Boolean(password) });
    return send(response, 200, { profile: { ...context.profile, full_name: cleanName, user_code: cleanUserCode } });
  } catch (error) {
    const duplicate = /already|exists|registered|duplicate/i.test(`${error.message} ${JSON.stringify(error.body || {})}`);
    return send(response, duplicate ? 409 : (error.status || 500), { error: duplicate ? 'Este código de usuário já está em uso.' : 'Não foi possível atualizar sua conta.' });
  }
};
