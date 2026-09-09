const { allowRequest } = require('../server/rate-limit');

const config = () => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
});

const reply = (response, status, payload) => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  return response.status(status).json(payload);
};

module.exports = async (request, response) => {
  if (request.method !== 'GET') return reply(response, 405, { status: 'error', error: 'Método não permitido.' });
  if (!allowRequest(request, response, { namespace: 'health', limit: 60, windowMs: 60_000 })) {
    return reply(response, 429, { status: 'degraded', error: 'Muitas verificações em pouco tempo.' });
  }

  const { url, publishableKey } = config();
  if (!url || !publishableKey) return reply(response, 503, { status: 'degraded', error: 'Serviço de dados indisponível.' });

  try {
    const upstream = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/health`, {
      headers: { apikey: publishableKey },
      signal: AbortSignal.timeout(4_000)
    });
    if (!upstream.ok) throw new Error(`Serviço respondeu ${upstream.status}`);
    return reply(response, 200, { status: 'ok', service: 'aldeckot', checkedAt: new Date().toISOString() });
  } catch {
    return reply(response, 503, { status: 'degraded', error: 'Serviço de dados indisponível.' });
  }
};
