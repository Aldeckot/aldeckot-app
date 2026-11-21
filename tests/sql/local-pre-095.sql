-- A fictional legacy ticket inserted immediately before migration 095.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
insert into public.module_tables (id,module,name)
values ('00000000-0000-4000-8000-000000000011','control','Legado fictício');
insert into public.control_items
  (id,table_id,equipment,model,serial,tag,sector,status,followup_kind)
values
  ('00000000-0000-4000-8000-000000000021',
   '00000000-0000-4000-8000-000000000011',
   'Impressora fictícia','Modelo legado','SERIAL-LEGADO-001',
   'TAG-LEGADO-001','Setor de teste','Em manutenção','maintenance');
