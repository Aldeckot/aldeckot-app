-- Backfill classification must not refresh the legacy row, and normal edits must still do so.
do $check$
begin
  if (select count(*) from public.inventory_items where equipment='Fixture sector timestamp 108'
      and sector_code='frente-de-loja' and updated_at='2020-01-01 00:00:00+00'::timestamptz) <> 1 then
    raise exception 'Migration 108 changed the legacy timestamp or failed classification.';
  end if;
end;
$check$;

update public.inventory_items set notes='Normal edit after backfill'
where equipment='Fixture sector timestamp 108';

do $check$
begin
  if (select count(*) from public.inventory_items where equipment='Fixture sector timestamp 108'
      and updated_at > '2020-01-01 00:00:00+00'::timestamptz) <> 1 then
    raise exception 'Migration 108 did not restore the updated_at trigger.';
  end if;
end;
$check$;
