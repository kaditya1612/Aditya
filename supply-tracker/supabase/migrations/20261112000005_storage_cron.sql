-- =====================================================================
-- Supabase-specific: private storage bucket + scheduled jobs
-- Object path convention: {task|requirement|costing}/{entity_id}/{random}-{file name}
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('supply-attachments', 'supply-attachments', false, 20971520)   -- 20 MB
on conflict (id) do nothing;

create or replace function public.can_access_attachment_path(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_kind text := split_part(p_name, '/', 1); v_id uuid;
begin
  begin
    v_id := split_part(p_name, '/', 2)::uuid;
  exception when others then
    return false;
  end;
  return case v_kind
    when 'task' then public.can_access_task(v_id)
    when 'requirement' then public.is_active_user()
    when 'costing' then public.can_access_costing(v_id)
    else false end;
end $$;

create policy "supply attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'supply-attachments' and public.can_access_attachment_path(name));
create policy "supply attachments upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'supply-attachments' and public.can_access_attachment_path(name));
-- no update/delete policies: uploaded evidence is retained

-- Scheduled jobs (pg_cron is available on all Supabase projects; enable it under Database → Extensions if needed)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    perform cron.schedule('supply-deadline-monitor', '*/15 * * * *', 'select public.run_deadline_monitor()');
    perform cron.schedule('supply-recurring-tasks', '5 0 * * *', 'select public.generate_recurring_tasks()');
  end if;
end $$;

-- Live notification badge (Realtime respects RLS: users only receive their own rows)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;
