-- ALDECKOT | Impede retorno presumido de legado e criação concorrente por série.
begin;

create or replace function app.lock_new_flux_serial()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.movement = 'Envio' and new.source_module is null and new.return_of is null
    and nullif(btrim(coalesce(new.serial, '')), '') is not null then
    perform pg_advisory_xact_lock(89114, hashtext(lower(btrim(new.serial))));
  end if;
  return new;
end; $$;
create trigger a_flux_new_serial_lock before insert on public.flux_items
  for each row execute function app.lock_new_flux_serial();

create or replace function app.guard_flux_lifecycle_dates()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  original public.flux_items%rowtype;
begin
  if new.delivered_at is not null and new.delivered_at > now() + interval '5 minutes' then
    raise exception 'A entrega não pode ter data futura.';
  end if;
  if new.received_at is not null and new.received_at > now() + interval '5 minutes' then
    raise exception 'O retorno não pode ter data futura.';
  end if;
  if new.return_of is not null then
    select * into original from public.flux_items where id = new.return_of;
    if not found or original.movement <> 'Envio' then
      raise exception 'Envio original não encontrado.';
    end if;
    if original.delivered_at is null then
      raise exception 'Envio antigo sem entrega individual confirmada exige reconciliação antes do retorno.';
    end if;
    if new.received_at is null or new.received_at < original.delivered_at then
      raise exception 'O retorno precisa ocorrer após a confirmação da entrega.';
    end if;
  end if;
  return new;
end; $$;
create trigger flux_lifecycle_date_guard
  before insert or update of delivered_at, received_at, return_of
  on public.flux_items for each row execute function app.guard_flux_lifecycle_dates();

revoke all on function app.lock_new_flux_serial() from public, anon, authenticated;
revoke all on function app.guard_flux_lifecycle_dates() from public, anon, authenticated;
commit;
