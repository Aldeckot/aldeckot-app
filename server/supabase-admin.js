const readConfig = () => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
});

const send = (response, status, payload) => response.status(status).json(payload);
const readBody = request => typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body || {});
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const normalizeName = value => String(value || '').trim().replace(/\s+/g, ' ');
const passwordValid = value => typeof value === 'string' && value.length >= 8;

const ensureConfig = response => {
  const config = readConfig();
  if (!config.url || !config.serviceRoleKey) {
    send(response, 500, { error: 'Configuração segura do Supabase ausente.' });
    return null;
  }
  return config;
};

const requestSupabase = async (config, path, options = {}) => {
  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const error = new Error(body?.msg || body?.message || body?.error_description || 'Operação indisponível no Supabase.');
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
};

const profileFor = async (config, userId) => {
  const rows = await requestSupabase(config, `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,full_name,email,role,status`);
  return rows?.[0] || null;
};

const authenticate = async (request, response, { admin = false, active = true } = {}) => {
  const config = ensureConfig(response);
  if (!config) return null;
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    send(response, 401, { error: 'Sessão obrigatória.' });
    return null;
  }
  let user;
  try {
    const authResponse = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.publishableKey || config.serviceRoleKey, Authorization: `Bearer ${token}` }
    });
    user = await authResponse.json();
    if (!authResponse.ok || !user?.id) throw new Error('Sessão inválida.');
  } catch {
    send(response, 401, { error: 'Sessão inválida ou expirada.' });
    return null;
  }
  try {
    const profile = await profileFor(config, user.id);
    if (!profile || (active && profile.status !== 'active')) {
      send(response, 403, { error: profile?.status === 'blocked' ? 'Sua conta está bloqueada.' : 'Sua conta ainda não está aprovada.' });
      return null;
    }
    if (admin && profile.role !== 'admin') {
      send(response, 403, { error: 'Acesso administrativo obrigatório.' });
      return null;
    }
    return { config, user, profile, token };
  } catch (error) {
    send(response, error.status || 500, { error: error.message || 'Não foi possível validar a conta.' });
    return null;
  }
};

const audit = async (config, actorId, targetUserId, action, details = {}) => {
  await requestSupabase(config, '/rest/v1/user_audit_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ actor_id: actorId, target_user_id: targetUserId, action, details })
  });
};

module.exports = {
  audit, authenticate, ensureConfig, normalizeEmail, normalizeName, passwordValid,
  profileFor, readBody, requestSupabase, send
};
