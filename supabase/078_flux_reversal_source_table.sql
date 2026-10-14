-- ALDECKOT | Corrige a tabela de origem consultada pelo estorno da migração 076.
-- module_tables possui id, não table_id. A substituição é restrita à linha
-- conhecida e recusa versões divergentes, sem alterar dados ou permissões.
begin;

do $fix$
declare definition text;
begin
  definition := pg_get_functiondef(
    'public.flux_reverse_movement(uuid,text,uuid,text)'::regprocedure);
  if position('select id into source_table from public.module_tables' in definition) > 0 then
    return;
  end if;
  if position('select table_id into source_table from public.module_tables' in definition) = 0 then
    raise exception 'Função de estorno divergente; correção 078 não aplicada.';
  end if;
  execute replace(definition,
    'select table_id into source_table from public.module_tables',
    'select id into source_table from public.module_tables');
end $fix$;

commit;
