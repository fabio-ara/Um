-- Disposable compose database only; hosted Storage already installs these grants.
do $$begin if current_database()<>'um' then raise exception 'LOCAL_UM_ONLY'; end if;end$$;
grant usage on schema storage to authenticated;
grant select,insert,update,delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
grant usage on schema storage to service_role;
grant all on all tables in schema storage to service_role;
grant all on all sequences in schema storage to service_role;
alter role service_role bypassrls;
