-- ALDECKOT | Identidade de variações próprias por marca, modelo e características.
-- Requer 064. Nenhuma variação, unidade, saldo ou histórico é mesclado.
begin;

alter table public.supply_variants add column if not exists brand text not null default '';
alter table public.supply_variants add column if not exists model text not null default '';

-- O cadastro anterior apresentava o nome como modelo e a marca do item pai.
-- Congelamos essa apresentação para que futuras edições do pai não mudem a identidade legada.
update public.supply_variants v set brand = coalesce(s.brand, ''), model = v.name
from public.supplies s
where s.id = v.supply_id and v.inventory_variant_key is null
  and v.brand = '' and v.model = '';

-- Uma colisão legada precisa de revisão humana: não é seguro fundir saldos e vínculos.
do $$ begin
  if exists (
    select 1 from public.supply_variants
    where inventory_variant_key is null
    group by supply_id,
      lower(regexp_replace(btrim(brand), '[[:space:]]+', ' ', 'g')),
      lower(regexp_replace(btrim(model), '[[:space:]]+', ' ', 'g')),
      lower(regexp_replace(btrim(description), '[[:space:]]+', ' ', 'g'))
    having count(*) > 1
  ) then
    raise exception 'Variações legadas com identidade equivalente exigem revisão antes da migração 067.';
  end if;
end $$;

drop index if exists public.supply_variants_local_name_unique;
create unique index if not exists supply_variants_local_identity_unique
on public.supply_variants (
  supply_id,
  lower(regexp_replace(btrim(brand), '[[:space:]]+', ' ', 'g')),
  lower(regexp_replace(btrim(model), '[[:space:]]+', ' ', 'g')),
  lower(regexp_replace(btrim(description), '[[:space:]]+', ' ', 'g'))
) where inventory_variant_key is null;

create or replace function public.supply_save_local_variant(
  p_id uuid, p_supply_id uuid, p_brand text, p_model text, p_description text,
  p_minimum_stock integer, p_location text
) returns uuid language plpgsql security definer set search_path = public as $$
declare parent public.supplies%rowtype; existing_id uuid; existing_inactive boolean; result_id uuid;
  clean_brand text := regexp_replace(btrim(coalesce(p_brand, '')), '[[:space:]]+', ' ', 'g');
  clean_model text := regexp_replace(btrim(coalesce(p_model, '')), '[[:space:]]+', ' ', 'g');
  clean_description text := regexp_replace(btrim(coalesce(p_description, '')), '[[:space:]]+', ' ', 'g');
  display_name text;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem alterar variações.'; end if;
  if p_minimum_stock is null or p_minimum_stock < 0 or p_minimum_stock > 1000000 then
    raise exception 'Informe um mínimo inteiro não negativo.';
  end if;
  if clean_model = '' and clean_description = '' then
    raise exception 'Informe o modelo ou uma característica que identifique a variação.';
  end if;
  if length(clean_brand) > 120 or length(clean_model) > 120 or length(clean_description) > 1000 then
    raise exception 'Marca, modelo ou características excedem o limite permitido.';
  end if;
  display_name := left(coalesce(nullif(clean_model, ''), clean_description), 120);
  select * into parent from public.supplies where id = p_supply_id for update;
  if not found or parent.inventory_group_key is not null then
    raise exception 'Somente variações próprias de Suprimentos podem ser alteradas aqui.';
  end if;
  select id, inactive into existing_id, existing_inactive from public.supply_variants
  where supply_id = p_supply_id and inventory_variant_key is null
    and lower(regexp_replace(btrim(brand), '[[:space:]]+', ' ', 'g')) = lower(clean_brand)
    and lower(regexp_replace(btrim(model), '[[:space:]]+', ' ', 'g')) = lower(clean_model)
    and lower(regexp_replace(btrim(description), '[[:space:]]+', ' ', 'g')) = lower(clean_description)
  limit 1;
  if existing_id is not null and p_id is null then
    if existing_inactive then raise exception 'Essa variação já existe, mas está inativa. Reative-a antes de registrar entradas.'; end if;
    return existing_id;
  end if;
  if existing_id is not null and existing_id is distinct from p_id then
    raise exception 'Já existe outra variação com essa marca, modelo e características. Os saldos e históricos não serão mesclados automaticamente.';
  end if;
  if p_id is null then
    insert into public.supply_variants(supply_id, name, brand, model, description, minimum_stock, location)
    values(p_supply_id, display_name, clean_brand, clean_model, clean_description,
      p_minimum_stock, coalesce(btrim(p_location), '')) returning id into result_id;
  else
    update public.supply_variants set name = display_name, brand = clean_brand, model = clean_model,
      description = clean_description, minimum_stock = p_minimum_stock,
      location = coalesce(btrim(p_location), ''), updated_at = now()
    where id = p_id and supply_id = p_supply_id and inventory_variant_key is null
    returning id into result_id;
    if result_id is null then raise exception 'Variação própria não encontrada.'; end if;
  end if;
  return result_id;
end; $$;

-- Clientes já abertos continuam usando a assinatura antiga com a marca do pai.
create or replace function public.supply_save_variant(
  p_id uuid, p_supply_id uuid, p_name text, p_description text, p_minimum_stock integer, p_location text
) returns uuid language plpgsql security definer set search_path = public as $$
declare parent_brand text;
begin
  if p_id is not null then
    select brand into parent_brand from public.supply_variants where id = p_id and supply_id = p_supply_id;
  else
    select brand into parent_brand from public.supplies where id = p_supply_id;
  end if;
  return public.supply_save_local_variant(p_id, p_supply_id, parent_brand, p_name,
    p_description, p_minimum_stock, p_location);
end; $$;

revoke all on function public.supply_save_local_variant(uuid,uuid,text,text,text,integer,text) from public, anon;
grant execute on function public.supply_save_local_variant(uuid,uuid,text,text,text,integer,text) to authenticated;

commit;
