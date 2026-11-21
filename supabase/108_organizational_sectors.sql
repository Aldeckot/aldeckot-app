-- ALDECKOT | Etapa 16: catálogo central de setores físicos.
-- Mantém inventário_branches separado: essas associações também classificam e compartilham itens.
begin;

create table if not exists public.organizational_sectors (
  code text primary key check (code ~ '^[a-z0-9-]+$'),
  name text not null unique check (char_length(btrim(name)) between 1 and 80),
  position integer not null unique check (position >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.organizational_sectors(code,name,position) values
  ('frente-de-loja','Frente de Loja',0), ('doca','Doca',1),
  ('escritorio','Escritório',2), ('informatica','Informática',3),
  ('monitoramento','Monitoramento',4), ('tesouraria','Tesouraria',5),
  ('padaria','Padaria',6), ('acougue','Açougue',7), ('refeitorio','Refeitório',8)
on conflict (code) do nothing;

create or replace function app.organizational_sector_code(p_sector text)
returns text language sql immutable set search_path=public as $$
  select case regexp_replace(translate(lower(btrim(coalesce(p_sector,''))),
    'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'), '[[:space:]]+', ' ', 'g')
    when 'frente de loja' then 'frente-de-loja' when 'doca' then 'doca'
    when 'escritorio' then 'escritorio' when 'informatica' then 'informatica'
    when 'monitoramento' then 'monitoramento' when 'tesouraria' then 'tesouraria'
    when 'padaria' then 'padaria' when 'acougue' then 'acougue' when 'refeitorio' then 'refeitorio'
    else null end
$$;

alter table public.inventory_items add column if not exists sector_code text;
alter table public.inventory_items drop constraint if exists inventory_items_sector_code_fk;
alter table public.inventory_items add constraint inventory_items_sector_code_fk
  foreign key (sector_code) references public.organizational_sectors(code) on update cascade on delete restrict;
create index if not exists inventory_items_sector_code_idx
  on public.inventory_items(sector_code) where sector_code is not null;

-- Backfill only exact catalog matches after accent/case/space normalization; never rewrite sector text.
-- Metadata classification is not an operational edit; preserve legacy updated_at values.
alter table public.inventory_items disable trigger inventory_items_set_updated_at;
update public.inventory_items set sector_code=app.organizational_sector_code(sector)
where sector_code is null and app.organizational_sector_code(sector) is not null;
alter table public.inventory_items enable trigger inventory_items_set_updated_at;

create or replace function app.sync_inventory_sector_code()
returns trigger language plpgsql security invoker set search_path=public,app as $$
declare canonical_name text;
begin
  if tg_op='UPDATE' and new.sector is distinct from old.sector then
    new.sector_code:=app.organizational_sector_code(new.sector);
  elsif new.sector_code is not null then
    select name into canonical_name from public.organizational_sectors
      where code=new.sector_code and active;
    if canonical_name is null then raise exception 'Selecione um setor ativo do catálogo.'; end if;
    new.sector:=canonical_name;
  else
    new.sector_code:=app.organizational_sector_code(new.sector);
  end if;
  return new;
end $$;
drop trigger if exists inventory_items_sector_catalog_sync on public.inventory_items;
create trigger inventory_items_sector_catalog_sync
  before insert or update of sector,sector_code on public.inventory_items
  for each row execute function app.sync_inventory_sector_code();

alter table public.organizational_sectors enable row level security;
revoke all on public.organizational_sectors from anon,authenticated;
grant select on public.organizational_sectors to authenticated;
drop policy if exists "Contas ativas consultam catálogo de setores" on public.organizational_sectors;
create policy "Contas ativas consultam catálogo de setores" on public.organizational_sectors
  for select to authenticated using (active and app.has_active_account());

commit;
