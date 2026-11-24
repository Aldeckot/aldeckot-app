-- Executar somente no Supabase de testes, depois da migração 131.
-- Cria vínculos e objetos de armazenamento fictícios; tudo é revertido.
-- Nenhuma imagem ou dado permanece após o ROLLBACK.
begin;

do $setup$
declare
  inventory_id uuid;
  control_id uuid;
  unrelated_id uuid;
  linked_ids uuid[];
  admin_id uuid;
  inventory_table_id uuid;
  control_table_id uuid;
  first_path text;
  second_path text;
begin
  select id into strict inventory_table_id from public.module_tables
    where module = 'inventory' order by id limit 1;
  select id into strict control_table_id from public.module_tables
    where module = 'control' order by id limit 1;
  insert into public.inventory_items(table_id,equipment,model,tag,serial,status)
    values(inventory_table_id,'Equipamento fictício de ensaio','Modelo de ensaio',
      'PHOTO-' || left(gen_random_uuid()::text,8),
      'PHOTO-' || gen_random_uuid()::text,'Ativo') returning id into inventory_id;
  insert into public.control_items(table_id,equipment,model,tag,serial,status,
    followup_kind,inventory_item_id)
    values(control_table_id,'Equipamento fictício de ensaio','Modelo de ensaio',
      'PHOTO-' || left(gen_random_uuid()::text,8),
      'PHOTO-' || gen_random_uuid()::text,'Aguardando avaliação',
      'maintenance',inventory_id) returning id into control_id;
  linked_ids := app.equipment_photo_candidates('inventory', inventory_id);
  assert control_id = any(linked_ids), 'Controle TI não encontrou a identidade do Inventário';
  assert inventory_id = any(app.equipment_photo_candidates('control', control_id)),
    'Inventário não encontrou a identidade do Controle TI';
  select i.id into unrelated_id from public.inventory_items i
    where i.id <> inventory_id and not (i.id = any(linked_ids)) limit 1;
  if unrelated_id is not null then
    assert unrelated_id <> all(linked_ids), 'Identidades sem vínculo foram misturadas';
  end if;
  select id into admin_id from public.profiles
    where role = 'admin' and status = 'active' order by id limit 1;
  if admin_id is null then raise exception 'O ensaio precisa de uma conta administradora ativa.'; end if;
  perform set_config('aldeckot.test_photo_131_item', inventory_id::text, true);
  perform set_config('aldeckot.test_photo_131_control', control_id::text, true);
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  first_path := 'equipment/' || inventory_id::text || '/'
    || replace(gen_random_uuid()::text, '-', '') || '.png';
  second_path := 'equipment/' || inventory_id::text || '/'
    || replace(gen_random_uuid()::text, '-', '') || '.webp';
  insert into storage.objects(bucket_id,name) values
    ('supply-images',first_path),('supply-images',second_path);
  perform set_config('aldeckot.test_photo_131_first', first_path, true);
  perform set_config('aldeckot.test_photo_131_second', second_path, true);
end;
$setup$;

set local role authenticated;
do $permissions$
declare
  inventory_id uuid := current_setting('aldeckot.test_photo_131_item')::uuid;
  control_id uuid := current_setting('aldeckot.test_photo_131_control')::uuid;
  first_path text := current_setting('aldeckot.test_photo_131_first');
  second_path text := current_setting('aldeckot.test_photo_131_second');
  admin_id uuid := current_setting('request.jwt.claim.sub')::uuid;
  before_path text;
  rejected boolean := false;
  absent_path text := 'equipment/' || inventory_id::text || '/'
    || replace(gen_random_uuid()::text, '-', '') || '.png';
begin
  assert app.is_admin(), 'A conta de ensaio deve ser administradora';
  before_path := public.equipment_photo_get('inventory', inventory_id);
  begin
    perform public.equipment_photo_set('inventory', inventory_id, absent_path, before_path);
  exception when raise_exception then
    rejected := sqlerrm like 'O arquivo da fotografia ainda não foi confirmado%';
  end;
  assert rejected, 'Não foi bloqueada uma referência sem upload confirmado';
  assert public.equipment_photo_get('inventory', inventory_id) is not distinct from before_path,
    'A falha de upload alterou a fotografia oficial';
  assert before_path is null, 'O equipamento de ensaio começou com foto';
  assert public.equipment_photo_set('inventory',inventory_id,first_path,null) is null,
    'A primeira foto tinha referência anterior';
  assert public.equipment_photo_get('control',control_id) = first_path,
    'Controle TI não recebeu a foto oficial do Inventário';
  rejected := false;
  begin
    perform public.equipment_photo_set('control',control_id,second_path,null);
  exception when raise_exception then
    rejected := sqlerrm like 'A fotografia foi alterada por outra sessão%';
  end;
  assert rejected and public.equipment_photo_get('inventory',inventory_id) = first_path,
    'Uma alteração concorrente substituiu a foto atual';
  assert public.equipment_photo_set('control',control_id,second_path,first_path) = first_path,
    'A troca não devolveu a referência anterior';
  assert public.equipment_photo_get('inventory',inventory_id) = second_path,
    'A fotografia nova não apareceu no Inventário';
  assert public.equipment_photo_set('inventory',inventory_id,null,second_path) = second_path,
    'A remoção não devolveu a referência anterior';
  assert public.equipment_photo_get('control',control_id) = '',
    'A remoção deve preservar a marcação que bloqueia fotos legadas';
  assert (select count(*) from public.equipment_events
    where metadata->>'equipment_id'=inventory_id::text and action like 'Foto %') = 3,
    'Inclusão, troca e remoção devem gerar um evento cada';
  assert public.equipment_photo_set('inventory',inventory_id,first_path,'') = '',
    'O novo envio após a remoção não preservou o estado anterior';
  assert (select action from public.equipment_events
    where metadata->>'equipment_id'=inventory_id::text
    order by created_at desc, id desc limit 1) = 'Foto adicionada',
    'O novo envio após a remoção deve ser descrito como foto adicionada';
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  rejected := false;
  begin
    perform public.equipment_photo_set('inventory',inventory_id,second_path,first_path);
  exception when raise_exception then
    rejected := sqlerrm like 'Apenas administradores alteram fotos%';
  end;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  assert rejected and public.equipment_photo_get('inventory',inventory_id) = first_path,
    'Uma conta sem autorização alterou a fotografia oficial';
end;
$permissions$;
reset role;

select 'equipment_photos_131_identity_and_upload_guard_ok';
rollback;
