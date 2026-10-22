-- SOMENTE LEITURA. Executar no Supabase Logs Explorer, fonte "Logs",
-- NÃO no SQL Editor do banco PostgreSQL. Escolher o maior período disponível.
-- Mostra apenas contagens e user-agent; não expõe IP nem corpo da requisição.
-- Uma ausência de resultados vale somente para o período retido nos logs.
select
  log_attributes['request.headers.user_agent'] as user_agent,
  log_attributes['request.method'] as method,
  toInt32OrZero(log_attributes['response.status_code']) as status_code,
  count() as requests,
  min(timestamp) as first_seen,
  max(timestamp) as last_seen
from logs
where source = 'edge_logs'
  and match(log_attributes['request.path'],
    '^/rest/v1/rpc/inventory_swap_locations/?$')
group by user_agent, method, status_code
order by requests desc, last_seen desc
limit 100;
