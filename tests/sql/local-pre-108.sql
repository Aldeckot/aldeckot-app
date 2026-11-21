-- A legacy row must retain its historical modification time during sector backfill.
insert into public.inventory_items(table_id,equipment,model,sector,location,created_at,updated_at)
select id,'Fixture sector timestamp 108','Offline test','Frente de Loja','Old room',
  '2020-01-01 00:00:00+00'::timestamptz,'2020-01-01 00:00:00+00'::timestamptz
from public.module_tables where module='inventory' order by id limit 1;

do $check$
begin
  if (select count(*) from public.inventory_items where equipment='Fixture sector timestamp 108'
      and updated_at='2020-01-01 00:00:00+00'::timestamptz) <> 1 then
    raise exception 'Pre-108 fixture missing or timestamp changed.';
  end if;
end;
$check$;
