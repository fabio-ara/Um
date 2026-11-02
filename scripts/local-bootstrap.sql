-- SOMENTE a instância descartável Um do compose.yaml; nunca o host compartilhado.
create role supabase_auth_admin login password 'um-local-auth-only' noinherit createrole;
create schema auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path to auth,public;
grant create on database um to supabase_auth_admin;
create role authenticated nologin;
create role anon nologin;
create role service_role nologin;
create role um_app login password 'um-local-only' noinherit;
grant authenticated to um_app;
grant usage on schema auth to authenticated;
