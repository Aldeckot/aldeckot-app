-- Fictional account and the single MONITORES table expected by migration 082.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000001', 'test-admin@invalid.example',
  '{"full_name":"Teste Isolado"}'::jsonb) on conflict (id) do nothing;
update public.profiles set role = 'admin', status = 'active'
where id = '00000000-0000-4000-8000-000000000001';
insert into public.module_tables (module, name)
values ('inventory', 'MONITORES') on conflict do nothing;
