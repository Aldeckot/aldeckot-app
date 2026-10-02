-- ALDECKOT | Reservas gerais e transferências entre Escritório e Estoque
-- Execute após 055_management_res_03_terminal.sql.
-- Frente de Loja continua limitada a transferências dentro do próprio setor.

begin;

do $$
declare
  management_table_id uuid;
begin
  select id into management_table_id
  from public.module_tables
  where module = 'management'
  order by created_at, id
  limit 1
  for update;

  if management_table_id is null then
    raise exception 'A tabela da Gestão TI não foi encontrada.';
  end if;

  with terminals(area, terminal, sort_order) as (
    values
      ('Escritório', 'RES GERAL 01', 1),
      ('Escritório', 'RES GERAL 02', 2),
      ('Estoque', 'RES GERAL 03', 3)
  )
  insert into public.module_records (table_id, payload, position)
  select
    management_table_id,
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
      'sector', terminals.area,
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
    (select coalesce(max(position), 0) from public.module_records where table_id = management_table_id)
      + row_number() over (order by terminals.sort_order)
  from terminals
  where not exists (
    select 1
    from public.module_records record_row
    where record_row.table_id = management_table_id
      and upper(btrim(coalesce(record_row.payload ->> 'terminal', ''))) = terminals.terminal
  );
end;
$$;

-- Mantém a transferência atômica e a sincronização diferida da migração 050.
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
  source_area text;
  destination_area text;
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

  source_area := lower(btrim(coalesce(source_row.payload ->> 'area', '')));
  destination_area := lower(btrim(coalesce(destination_row.payload ->> 'area', '')));
  if source_area not in ('escritório', 'estoque', 'frente de loja')
     or destination_area not in ('escritório', 'estoque', 'frente de loja')
     or (
       source_area <> destination_area
       and not (source_area in ('escritório', 'estoque') and destination_area in ('escritório', 'estoque'))
     ) then
    raise exception 'Transferências entre setores são permitidas apenas entre Escritório e Estoque.';
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

  perform set_config('app.management_transfer_in_progress', 'on', true);
  update public.module_records set payload = source_next where id = source_row.id;
  update public.module_records set payload = destination_next where id = destination_row.id;

  perform set_config('app.management_transfer_in_progress', 'off', true);
  perform app.sync_management_record_to_control(source_row.id, source_next);
  perform app.sync_management_record_to_control(destination_row.id, destination_next);
end;
$$;

revoke all on function public.management_transfer_terminal(uuid, uuid) from public;
grant execute on function public.management_transfer_terminal(uuid, uuid) to authenticated;

commit;
