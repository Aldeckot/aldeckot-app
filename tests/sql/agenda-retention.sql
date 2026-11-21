-- Retention never removes notes, and every run records its affected count.
begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
insert into public.agenda_entries(id,kind,title,due_date,created_at)
values
 ('00000000-0000-4000-8000-000000000091','event','Evento vencido fictício',current_date - 100,now() - interval '3 months'),
 ('00000000-0000-4000-8000-000000000092','note','Nota preservada fictícia',current_date - 100,now() - interval '3 months'),
 ('00000000-0000-4000-8000-000000000093','task','Tarefa recente fictícia',current_date,now());
select public.purge_expired_agenda_entries();
do $test$ begin
  if exists(select 1 from public.agenda_entries where id='00000000-0000-4000-8000-000000000091') then
    raise exception 'Expired event was not removed';
  end if;
  if not exists(select 1 from public.agenda_entries where id='00000000-0000-4000-8000-000000000092') then
    raise exception 'Note was removed';
  end if;
  if not exists(select 1 from public.agenda_entries where id='00000000-0000-4000-8000-000000000093') then
    raise exception 'Recent task was removed';
  end if;
  if not exists(select 1 from public.agenda_cleanup_runs where result='success' and affected_count>=1) then
    raise exception 'Retention run was not audited';
  end if;
end $test$;
rollback;
