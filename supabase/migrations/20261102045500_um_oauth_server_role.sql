create role um_oauth_server nologin nosuperuser nobypassrls noinherit;
grant usage on schema um,auth to um_oauth_server;
grant select(id,user_id,not_after) on auth.sessions to um_oauth_server;
grant select,insert,update,delete on um.oauth_clients,um.oauth_requests,um.oauth_grants,um.oauth_tokens to um_oauth_server;
grant select,insert,update on um.client_grants to um_oauth_server;
do $$declare t text; begin
 foreach t in array array['oauth_clients','oauth_requests','oauth_grants','oauth_tokens','client_grants'] loop
  execute format('create policy oauth_server on um.%I to um_oauth_server using(true) with check(true)',t);
 end loop;
 -- Only the dedicated local server login exists here. Hosted runtime uses its
 -- configured server connection and SET LOCAL ROLE, never a public API role.
 if exists(select 1 from pg_roles where rolname='um_app') then grant um_oauth_server to um_app; end if;
end $$;
