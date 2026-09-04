const { ensureConfig, normalizeUserCode, passwordValid, profileForUserCode, requestSupabase, send, userCodeValid } = require('../server/supabase-admin');

const invalidCredentials = response => send(response, 401, { error: 'Código de usuário ou senha inválidos.' });

module.exports = async (request, response) => {
  if (request.method !== 'POST') return send(response, 405, { error: 'Método não permitido.' });
  const config = ensureConfig(response);
  if (!config) return;
  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body || {});
  const userCode = normalizeUserCode(body.userCode);
  const password = String(body.password || '');
  if (!userCodeValid(userCode) || !passwordValid(password)) return invalidCredentials(response);

  try {
    const profile = await profileForUserCode(config, userCode);
    if (!profile?.email) return invalidCredentials(response);

    const authResponse = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey || config.serviceRoleKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: profile.email, password })
    });
    const token = await authResponse.json().catch(() => ({}));
    if (!authResponse.ok || !token?.access_token || !token?.refresh_token) return invalidCredentials(response);

    if (profile.status !== 'active') {
      const error = profile.status === 'blocked' ? 'Sua conta está bloqueada. Procure um administrador.' : 'Sua solicitação ainda aguarda aprovação do administrador.';
      return send(response, 403, { error, accountState: profile.status });
    }

    await requestSupabase(config, `/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_sign_in_at: new Date().toISOString() })
    });
    return send(response, 200, { session: { access_token: token.access_token, refresh_token: token.refresh_token } });
  } catch (error) {
    return send(response, error.status || 500, { error: error.status && error.status < 500 ? 'Código de usuário ou senha inválidos.' : 'Não foi possível entrar agora. Tente novamente.' });
  }
};
