(() => {
  const sent = new Set();
  const limit = 12;

  const clean = value => String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .slice(0, 900);

  const report = ({ kind, message, source, line }) => {
    const key = `${kind}|${message}|${source}|${line}`;
    if (!message || sent.has(key) || sent.size >= limit) return;
    sent.add(key);
    const payload = JSON.stringify({
      kind: clean(kind).slice(0, 40),
      message: clean(message),
      source: clean(source).slice(0, 220),
      line: Number(line) || undefined,
      page: clean(window.location.pathname).slice(0, 220),
      occurredAt: new Date().toISOString()
    });
    window.fetch?.('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true
    }).catch(() => {});
  };

  window.addEventListener('error', event => report({
    kind: 'error',
    message: event.message || 'Erro sem mensagem',
    source: event.filename,
    line: event.lineno
  }));
  window.addEventListener('unhandledrejection', event => report({
    kind: 'unhandled-rejection',
    message: event.reason?.message || event.reason || 'Promessa rejeitada sem mensagem'
  }));
})();
