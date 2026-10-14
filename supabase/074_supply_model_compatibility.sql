-- ALDECKOT | Compatibilidade explícita por modelo, complementar à categoria.
-- Aplicar após 073. Não preenche relações por semelhança de nomes e não altera estoque.
begin;

create table if not exists public.supply_model_compatibility (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.supplies(id) on delete restrict,
  equipment_category text not null default '',
  brand text not null default '',
  model text not null check (char_length(btrim(model)) between 1 and 160),
  specification text not null default '',
  connection_type text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  inactive_at timestamptz,
  constraint supply_compatibility_category_length check (char_length(equipment_category) <= 120),
  constraint supply_compatibility_brand_length check (char_length(brand) <= 120),
  constraint supply_compatibility_spec_length check (char_length(specification) <= 500),
  constraint supply_compatibility_connection_length check (char_length(connection_type) <= 120)
);

create unique index if not exists supply_model_compatibility_unique_active
  on public.supply_model_compatibility (
    supply_id, lower(btrim(equipment_category)), lower(btrim(brand)),
    lower(btrim(model)), lower(btrim(specification)), lower(btrim(connection_type))
  ) where inactive_at is null;
create index if not exists supply_model_compatibility_supply_idx
  on public.supply_model_compatibility (supply_id, created_at desc);

alter table public.supply_model_compatibility enable row level security;
revoke all on public.supply_model_compatibility from public, anon, authenticated;
grant select on public.supply_model_compatibility to authenticated;
drop policy if exists "Contas ativas consultam compatibilidade" on public.supply_model_compatibility;
create policy "Contas ativas consultam compatibilidade"
  on public.supply_model_compatibility for select to authenticated
  using (app.has_active_account());

create or replace function public.supply_save_model_compatibility(
  p_supply_id uuid, p_id uuid, p_equipment_category text, p_brand text,
  p_model text, p_specification text, p_connection_type text
) returns uuid language plpgsql security definer set search_path = public as $$
declare relation_id uuid; prior public.supply_model_compatibility%rowtype;
begin
  if auth.uid() is null or not app.is_admin() or
     not app.can_manage_module('supplies', 'update') then
    raise exception 'Sem permissão para administrar compatibilidade.';
  end if;
  if p_supply_id is null or not exists (select 1 from public.supplies
    where id = p_supply_id and deleted_at is null) then
    raise exception 'Suprimento não encontrado.';
  end if;
  if nullif(btrim(coalesce(p_model, '')), '') is null then
    raise exception 'Informe o modelo exato do equipamento compatível.';
  end if;
  if p_id is null then
    insert into public.supply_model_compatibility
      (supply_id, equipment_category, brand, model, specification,
       connection_type, created_by, updated_by)
    values (p_supply_id, btrim(coalesce(p_equipment_category, '')),
      btrim(coalesce(p_brand, '')), btrim(p_model),
      btrim(coalesce(p_specification, '')), btrim(coalesce(p_connection_type, '')),
      auth.uid(), auth.uid()) returning id into relation_id;
  else
    select * into prior from public.supply_model_compatibility
      where id = p_id and supply_id = p_supply_id and inactive_at is null for update;
    if not found then raise exception 'Relação de compatibilidade não encontrada.'; end if;
    update public.supply_model_compatibility set
      equipment_category = btrim(coalesce(p_equipment_category, '')),
      brand = btrim(coalesce(p_brand, '')), model = btrim(p_model),
      specification = btrim(coalesce(p_specification, '')),
      connection_type = btrim(coalesce(p_connection_type, '')),
      updated_by = auth.uid(), updated_at = now()
    where id = p_id returning id into relation_id;
  end if;
  insert into public.supply_logs (supply_id, action, details)
    values (p_supply_id, 'compatibility', left(format(
      'Compatibilidade por modelo %s: %s %s.',
      case when p_id is null then 'cadastrada' else 'atualizada' end,
      btrim(coalesce(p_brand, '')), btrim(p_model)), 500));
  return relation_id;
end; $$;

create or replace function public.supply_deactivate_model_compatibility(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare relation public.supply_model_compatibility%rowtype;
begin
  if auth.uid() is null or not app.is_admin() or
     not app.can_manage_module('supplies', 'update') then
    raise exception 'Sem permissão para administrar compatibilidade.';
  end if;
  select * into relation from public.supply_model_compatibility
    where id = p_id and inactive_at is null for update;
  if not found then raise exception 'Relação não encontrada ou já inativada.'; end if;
  update public.supply_model_compatibility
    set inactive_at = now(), updated_at = now(), updated_by = auth.uid()
    where id = relation.id;
  insert into public.supply_logs (supply_id, action, details)
    values (relation.supply_id, 'compatibility', left(format(
      'Compatibilidade por modelo inativada: %s %s.', relation.brand, relation.model), 500));
end; $$;

revoke all on function public.supply_save_model_compatibility(uuid, uuid, text, text, text, text, text)
  from public, anon;
grant execute on function public.supply_save_model_compatibility(uuid, uuid, text, text, text, text, text)
  to authenticated;
revoke all on function public.supply_deactivate_model_compatibility(uuid)
  from public, anon;
grant execute on function public.supply_deactivate_model_compatibility(uuid)
  to authenticated;
commit;
