-- ALREADY LIVE ON PROD: Supabase installed this itself (the project's "automatic RLS on new
-- tables" setting), so it was never in a migration. Recorded here so preview branches, which are
-- built from migrations, behave like prod: any table created in public gets RLS switched on at
-- once, so a migration that forgets `enable row level security` fails closed on previews too.
-- Creates the function and the `ensure_rls` event trigger only when missing, so on prod (where
-- Supabase owns both) this is a no-op. If the role running migrations may not create event
-- triggers, it warns instead of failing the whole migration run.
do $do$
begin
  if to_regprocedure('public.rls_auto_enable()') is null then
    create function public.rls_auto_enable()
      returns event_trigger
      language plpgsql
      security definer
      set search_path to 'pg_catalog'
    as $function$
    declare
      cmd record;
    begin
      for cmd in
        select *
        from pg_event_trigger_ddl_commands()
        where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
          and object_type in ('table', 'partitioned table')
      loop
        if cmd.schema_name is not null and cmd.schema_name in ('public') then
          begin
            execute format('alter table if exists %s enable row level security', cmd.object_identity);
            raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
          exception
            when others then
              raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
          end;
        else
          raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
            cmd.object_identity, cmd.schema_name;
        end if;
      end loop;
    end;
    $function$;

    grant execute on function public.rls_auto_enable() to public, anon, authenticated, service_role;
  end if;

  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    begin
      create event trigger ensure_rls on ddl_command_end
        when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
        execute function public.rls_auto_enable();
    exception
      when insufficient_privilege then
        raise warning 'ensure_rls event trigger not created (insufficient privilege); new tables will not get RLS automatically here';
    end;
  end if;
end;
$do$;
