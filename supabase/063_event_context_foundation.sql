-- ALDECKOT | Fundação de eventos compartilhados
-- Requer 062_status_identity_safety.sql.
-- Etapa aditiva: não reconcilia registros históricos e não inventa vínculos.
-- O inventory_item_id reutiliza a identidade física já existente no Inventário.

begin;

create table if not exists public.equipment_events (
  id uuid primary key default gen_random_uuid(),
  source_module text not null check (source_module in (
    'inventory', 'management', 'control', 'flux', 'supplies', 'nfe'
  )),
  source_event_key text not null check (char_length(btrim(source_event_key)) between 1 and 180),
  source_id uuid,
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  action text not null check (char_length(btrim(action)) between 1 and 120),
  previous_status text,
  new_status text,
  previous_location text,
  new_location text,
  previous_assignment text,
  new_assignment text,
  origin_location text,
  destination_location text,
  reason text,
  affected_modules jsonb not null default '[]'::jsonb check (jsonb_typeof(affected_modules) = 'array'),
  processing_result jsonb not null default '{}'::jsonb check (jsonb_typeof(processing_result) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (source_module, source_event_key)
);

create index if not exists equipment_events_inventory_created_idx
  on public.equipment_events (inventory_item_id, created_at desc)
  where inventory_item_id is not null;
create index if not exists equipment_events_source_created_idx
  on public.equipment_events (source_module, created_at desc);

create table if not exists public.equipment_event_effects (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.equipment_events(id) on delete cascade,
  module text not null check (module in (
    'inventory', 'management', 'control', 'flux', 'supplies', 'nfe'
  )),
  status text not null default 'pending' check (status in ('pending', 'applied', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  error_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (event_id, module)
);

create index if not exists equipment_event_effects_status_idx
  on public.equipment_event_effects (status, created_at desc);
create index if not exists equipment_event_effects_event_idx
  on public.equipment_event_effects (event_id, module);

-- Os módulos atuais preservam seus logs e passam a poder apontar para o mesmo
-- evento-raiz. NULL mantém compatibilidade com históricos anteriores à 063.
alter table public.inventory_item_logs
  add column if not exists event_id uuid references public.equipment_events(id) on delete set null;
alter table public.control_item_logs
  add column if not exists event_id uuid references public.equipment_events(id) on delete set null;
alter table public.flux_item_logs
  add column if not exists event_id uuid references public.equipment_events(id) on delete set null;
alter table public.supply_logs
  add column if not exists event_id uuid references public.equipment_events(id) on delete set null;
alter table public.sync_events
  add column if not exists event_id uuid references public.equipment_events(id) on delete set null;
alter table public.equipment_sync_events
  add column if not exists event_id uuid references public.equipment_events(id) on delete set null;

create index if not exists inventory_item_logs_event_idx on public.inventory_item_logs (event_id, created_at desc);
create index if not exists control_item_logs_event_idx on public.control_item_logs (event_id, created_at desc);
create index if not exists flux_item_logs_event_idx on public.flux_item_logs (event_id, created_at desc);
create index if not exists supply_logs_event_idx on public.supply_logs (event_id, created_at desc);
create index if not exists sync_events_event_idx on public.sync_events (event_id, created_at desc);
create index if not exists equipment_sync_events_event_idx on public.equipment_sync_events (event_id, created_at desc);

alter table public.equipment_events enable row level security;
alter table public.equipment_event_effects enable row level security;
revoke all on public.equipment_events, public.equipment_event_effects from anon;
grant select on public.equipment_events, public.equipment_event_effects to authenticated;

drop policy if exists "Contas ativas consultam eventos compartilhados" on public.equipment_events;
create policy "Contas ativas consultam eventos compartilhados"
  on public.equipment_events for select to authenticated
  using (app.has_active_account());
drop policy if exists "Contas ativas consultam efeitos de eventos" on public.equipment_event_effects;
create policy "Contas ativas consultam efeitos de eventos"
  on public.equipment_event_effects for select to authenticated
  using (app.has_active_account());

commit;
