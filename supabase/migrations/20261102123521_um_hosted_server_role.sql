-- Supabase's built-in SUPABASE_DB_URL connects as postgres. The broker always
-- switches to this narrow, non-login role; public/user roles must not receive it.
-- The local um_app membership is already provisioned by the broker migration.
do $$ begin
 if exists(select 1 from pg_roles where rolname='postgres') then
  grant um_oauth_server to postgres;
 end if;
end $$;
