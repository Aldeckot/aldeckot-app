const { audit, authenticate, normalizeEmail, normalizeName, passwordValid, readBody, requestSupabase, send } = require('../server/supabase-admin');

module.exports = async (request, response) => {
  if (request.method !== 'PATCH') return send(response, 405, { error: 'Método não permitido.' });
  const context = await authenticate(request, response);
  if (!context) return;
  const { fullName, email, password } = readBody(request);
  const cleanName = normalizeName(fullName);
  const cleanEmail = normalizeEmail(email);
  if (cleanName.length < 3 || !/^\S+@\S+\.\S+$/.test(cleanEmail) || (password && !passwordValid(password))) {
    return send(response, 400, { error: 'Informe nome completo, e-mail válido e, se necessário, senha com ao menos 8 caracteres.' });
  }
  try {
    const authPayload = { email: cleanEmail, user_metadata: { ...(context.user.user_metadata || {}), full_name: cleanName } };
    if (password) authPayload.password = password;
    await requestSupabase(context.config, `/auth/v1/admin/users/${encodeURIComponent(context.user.id)}`, {
      method: 'PUT', body: JSON.stringify(authPayload)
    });
    await requestSupabase(context.config, `/rest/v1/profiles?id=eq.${encodeURIComponent(context.user.id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ display_name: cleanName, full_name: cleanName, email: cleanEmail })
    });
    await audit(context.config, context.user.id, context.user.id, 'account_security_updated', { changedName: cleanName !== context.profile.full_name, changedEmail: cleanEmail !== context.profile.email, changedPassword: Boolean(password) });
    return send(response, 200, { profile: { ...context.profile, full_name: cleanName, email: cleanEmail } });
  } catch (error) {
    const duplicate = /already|exists|registered|duplicate/i.test(`${error.message} ${JSON.stringify(error.body || {})}`);
    return send(response, duplicate ? 409 : (error.status || 500), { error: duplicate ? 'Este e-mail já está em uso.' : 'Não foi possível atualizar sua conta.' });
  }
};
