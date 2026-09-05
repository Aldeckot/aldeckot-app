-- ALDECKOT | Terminais fixos da Gestão TI e transferência atômica
-- Execute depois da migração 022 no SQL Editor do Supabase.
-- Esta implantação arquiva uma cópia dos computadores atuais da Gestão TI
-- antes de substituí-los pelos terminais fixos definidos para a operação.

begin;

insert into public.module_tables (module, name, icon, position)
select 'management', 'Infraestrutura ALDECKOT', '🖥️', 0
where not exists (
  select 1 from public.module_tables where module = 'management'
);

-- Preserva um snapshot recuperável no próprio módulo antes da substituição.
insert into public.management_backups (label, snapshot, source)
select
  'Backup antes dos terminais fixos da Gestão TI',
  jsonb_build_object(
    'module', 'management',
    'version', 2,
    'createdAt', timezone('utc', now()),
    'data', jsonb_build_object(
      'items', jsonb_agg(record_row.payload order by record_row.position, record_row.created_at)
    )
  ),
  'network'
from public.module_records record_row
join public.module_tables table_row on table_row.id = record_row.table_id
where table_row.module = 'management'
  and not exists (
    select 1 from public.management_backups
    where label = 'Backup antes dos terminais fixos da Gestão TI'
  )
having count(*) > 0;

-- A solicitação aprovada substitui apenas os registros de computadores da Gestão TI.
delete from public.module_records record_row
using public.module_tables table_row
where record_row.table_id = table_row.id
  and table_row.module = 'management';

with management_table as (
  select id from public.module_tables where module = 'management' order by created_at, id limit 1
), terminals(area, sector, terminal, position) as (
  values
    ('Escritório', 'Escritório', 'RH', 1),
    ('Escritório', 'Escritório', 'CFTV', 2),
    ('Escritório', 'Escritório', 'TESOURARIA 01', 3),
    ('Escritório', 'Escritório', 'TESOURARIA 02', 4),
    ('Escritório', 'Escritório', 'SERVIDOR 01', 5),
    ('Escritório', 'Escritório', 'SERVIDOR 02', 6),
    ('Escritório', 'Escritório', 'AUDITÓRIO', 7),
    ('Escritório', 'Escritório', 'RECEPÇÃO 01', 8),
    ('Escritório', 'Escritório', 'RECEPÇÃO 02', 9),
    ('Escritório', 'Escritório', 'PC SOM', 10),
    ('Estoque', 'Estoque', 'ESTOQUE 01', 11),
    ('Estoque', 'Estoque', 'ESTOQUE 02', 12),
    ('Estoque', 'Estoque', 'ESTOQUE 03', 13),
    ('Frente de Loja', 'Frente de Loja', 'PDV 01', 14),
    ('Frente de Loja', 'Frente de Loja', 'PDV 02', 15),
    ('Frente de Loja', 'Frente de Loja', 'PDV 03', 16),
    ('Frente de Loja', 'Frente de Loja', 'PDV 05', 17),
    ('Frente de Loja', 'Frente de Loja', 'PDV 06', 18),
    ('Frente de Loja', 'Frente de Loja', 'PDV 07', 19),
    ('Frente de Loja', 'Frente de Loja', 'PDV 08', 20),
    ('Frente de Loja', 'Frente de Loja', 'PDV 09', 21),
    ('Frente de Loja', 'Frente de Loja', 'PDV 10', 22),
    ('Frente de Loja', 'Frente de Loja', 'PDV 11', 23),
    ('Frente de Loja', 'Frente de Loja', 'PDV 12', 24),
    ('Frente de Loja', 'Frente de Loja', 'PDV 13', 25),
    ('Frente de Loja', 'Frente de Loja', 'PDV 14', 26),
    ('Frente de Loja', 'Frente de Loja', 'RES 01', 27),
    ('Frente de Loja', 'Frente de Loja', 'RES 02', 28),
    ('Frente de Loja', 'Frente de Loja', 'RES 03', 29)
)
insert into public.module_records (table_id, payload, position)
select
  management_table.id,
  jsonb_build_object(
    'terminal', terminals.terminal,
    'equipment', '',
    'tag', '',
    'brand', '',
    'model', '',
    'serial', '',
    'ip', '',
    'gateway', '',
    'subnetMask', '',
    'hostname', '',
    'operatingSystem', '',
    'osVersion', '',
    'processor', '',
    'memory', '',
    'storage', '',
    'sector', terminals.sector,
    'location', terminals.terminal,
    'status', 'Ativo',
    'priority', 'Estável',
    'situation', 'Em Uso',
    'cleaning', 'Preventiva',
    'area', terminals.area,
    'isFixed', true,
    'peripherals', '[]'::jsonb,
    'monitoring', '{}'::jsonb,
    'registeredAt', to_char(timezone('utc', now()), 'YYYY-MM-DD'),
    'logs', '[]'::jsonb,
    'lastActivity', format('Terminal fixo %s configurado.', terminals.terminal)
  ),
  terminals.position
from management_table cross join terminals;

-- Troca o computador e todos os seus dados técnicos entre dois terminais de forma atômica.
create or replace function public.management_transfer_terminal(
  p_source_id uuid,
  p_destination_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_row public.module_records%rowtype;
  destination_row public.module_records%rowtype;
  source_terminal jsonb;
  destination_terminal jsonb;
  source_computer jsonb;
  destination_computer jsonb;
  source_logs jsonb;
  destination_logs jsonb;
  source_name text;
  destination_name text;
  source_next jsonb;
  destination_next jsonb;
begin
  if p_source_id is null or p_destination_id is null or p_source_id = p_destination_id then
    raise exception 'Selecione dois terminais diferentes para transferir.';
  end if;
  if not app.is_admin() then
    raise exception 'Somente administradores podem transferir computadores entre terminais.';
  end if;

  select record_row.* into source_row
  from public.module_records record_row
  join public.module_tables table_row on table_row.id = record_row.table_id
  where record_row.id = p_source_id and table_row.module = 'management'
  for update of record_row;

  if not found then
    raise exception 'O terminal de origem não foi encontrado.';
  end if;

  select record_row.* into destination_row
  from public.module_records record_row
  join public.module_tables table_row on table_row.id = record_row.table_id
  where record_row.id = p_destination_id and table_row.module = 'management'
  for update of record_row;

  if not found then
    raise exception 'O terminal de destino não foi encontrado.';
  end if;
  if source_row.table_id <> destination_row.table_id then
    raise exception 'Os terminais devem pertencer à mesma Gestão TI.';
  end if;
  if lower(btrim(coalesce(source_row.payload ->> 'area', ''))) is distinct from lower(btrim(coalesce(destination_row.payload ->> 'area', ''))) then
    raise exception 'A transferência só é permitida entre terminais do mesmo setor.';
  end if;

  source_name := nullif(btrim(source_row.payload ->> 'terminal'), '');
  destination_name := nullif(btrim(destination_row.payload ->> 'terminal'), '');
  if source_name is null or destination_name is null then
    raise exception 'A transferência está disponível apenas para terminais fixos.';
  end if;
  if nullif(btrim(source_row.payload ->> 'equipment'), '') is null then
    raise exception 'O terminal de origem não possui computador atribuído.';
  end if;

  source_terminal := jsonb_build_object(
    'terminal', source_name,
    'area', coalesce(source_row.payload ->> 'area', 'Escritório'),
    'sector', coalesce(source_row.payload ->> 'sector', ''),
    'location', coalesce(source_row.payload ->> 'location', source_name),
    'isFixed', true
  );
  destination_terminal := jsonb_build_object(
    'terminal', destination_name,
    'area', coalesce(destination_row.payload ->> 'area', 'Escritório'),
    'sector', coalesce(destination_row.payload ->> 'sector', ''),
    'location', coalesce(destination_row.payload ->> 'location', destination_name),
    'isFixed', true
  );
  source_computer := source_row.payload - array['terminal', 'area', 'sector', 'location', 'isFixed', 'logs', 'lastActivity'];
  destination_computer := destination_row.payload - array['terminal', 'area', 'sector', 'location', 'isFixed', 'logs', 'lastActivity'];
  source_logs := coalesce(source_row.payload -> 'logs', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid()::text,
    'at', timezone('utc', now()),
    'text', format('Computador transferido de %s para %s.', source_name, destination_name)
  ));
  destination_logs := coalesce(destination_row.payload -> 'logs', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid()::text,
    'at', timezone('utc', now()),
    'text', format('Computador recebido do terminal %s.', source_name)
  ));
  source_next := destination_computer || source_terminal || jsonb_build_object(
    'logs', source_logs,
    'lastActivity', format('Transferência concluída: computador enviado para %s.', destination_name)
  );
  destination_next := source_computer || destination_terminal || jsonb_build_object(
    'logs', destination_logs,
    'lastActivity', format('Transferência concluída: computador recebido de %s.', source_name)
  );

  update public.module_records set payload = source_next where id = source_row.id;
  update public.module_records set payload = destination_next where id = destination_row.id;
end;
$$;

revoke all on function public.management_transfer_terminal(uuid, uuid) from public;
grant execute on function public.management_transfer_terminal(uuid, uuid) to authenticated;

commit;
