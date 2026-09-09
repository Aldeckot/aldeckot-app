const { allowRequest } = require('../server/rate-limit');

const clean = (value, limit = 900) => String(value || '')
  .replace(/[\r\n\t]+/g, ' ')
  .replace(/https?:\/\/[^\s]+/gi, '[url]')
  .slice(0, limit);

module.exports = async (request, response) => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  if (request.method !== 'POST') return response.status(405).json({ error: 'Método não permitido.' });
  if (!allowRequest(request, response, { namespace: 'client-error', limit: 20, windowMs: 60_000 })) {
    return response.status(429).json({ error: 'Muitos registros em pouco tempo.' });
  }

  let body = request.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      body = {};
    }
  }
  const payload = {
    kind: clean(body.kind, 40),
    message: clean(body.message),
    page: clean(body.page, 220),
    source: clean(body.source, 220),
    line: Number.isFinite(Number(body.line)) ? Number(body.line) : undefined,
    occurredAt: clean(body.occurredAt, 40)
  };
  console.error('ALDECKOT_CLIENT_ERROR', JSON.stringify(payload));
  return response.status(204).end();
};
