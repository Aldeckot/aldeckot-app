-- ALDECKOT | Acrescenta o terminal fixo RES 03 em Frente de Loja.
-- Execute após 054_module_backup_frequencies.sql.
-- A migração 023 já prevê RES 03 em instalações novas; esta inclusão
-- preserva os registros e os computadores de instalações existentes.

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

  if not exists (
    select 1
    from public.module_records
    where table_id = management_table_id
      and upper(btrim(coalesce(payload ->> 'terminal', ''))) = 'RES 03'
  ) then
    insert into public.module_records (table_id, payload, position)
    select management_table_id,
      jsonb_build_object(
        'terminal', 'RES 03',
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
        'sector', 'Frente de Loja',
        'location', 'RES 03',
        'status', 'Ativo',
        'priority', 'Estável',
        'situation', 'Em Uso',
        'cleaning', 'Preventiva',
        'area', 'Frente de Loja',
        'isFixed', true,
        'peripherals', '[]'::jsonb,
        'monitoring', '{}'::jsonb,
        'registeredAt', to_char(timezone('utc', now()), 'YYYY-MM-DD'),
        'logs', '[]'::jsonb,
        'lastActivity', 'Terminal fixo RES 03 configurado.'
      ),
      coalesce(max(position), 0) + 1
    from public.module_records
    where table_id = management_table_id;
  end if;
end;
$$;

commit;
