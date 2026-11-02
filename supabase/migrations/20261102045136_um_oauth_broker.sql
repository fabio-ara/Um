-- Server-only OAuth state. No Auth hook, other product, role or redirect change.
create table um.oauth_clients (
 id uuid primary key, name text not null, redirect_uris jsonb not null,
 auth_method text not null check(auth_method in ('none','client_secret_post','client_secret_basic')),
 secret_hash text, created_at timestamptz not null default now()
);
create table um.oauth_requests (
 id_hash text primary key, client_id uuid not null references um.oauth_clients(id) on delete cascade,
 request jsonb not null, expires_at timestamptz not null, used_at timestamptz
);
create table um.oauth_grants (
 id uuid primary key, client_id uuid not null references um.oauth_clients(id) on delete cascade,
 account_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null, permission text not null check(permission in ('read','write')),
 resource text not null, session_cipher text not null,
 expires_at timestamptz not null, revoked_at timestamptz
);
create table um.oauth_tokens (
 hash text primary key, grant_id uuid not null references um.oauth_grants(id) on delete cascade,
 kind text not null check(kind in ('code','access','refresh')), expires_at timestamptz not null,
 used_at timestamptz, binding jsonb not null default '{}'
);
create index oauth_tokens_grant_idx on um.oauth_tokens(grant_id);
create index oauth_grants_client_account_idx on um.oauth_grants(client_id,account_id);
do $$declare t text; begin
 foreach t in array array['oauth_clients','oauth_requests','oauth_grants','oauth_tokens'] loop
  execute format('alter table um.%I enable row level security',t);
  execute format('revoke all on um.%I from public,anon,authenticated',t);
 end loop;
end $$;
create function um.revoke_oauth_grants() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 update um.oauth_grants set revoked_at=now(),session_cipher='' where account_id=old.account_id and client_id=old.client_id and revoked_at is null;
 return old;
end $$;
revoke all on function um.revoke_oauth_grants() from public,anon,authenticated;
create trigger revoke_oauth_grants after delete on um.client_grants for each row execute function um.revoke_oauth_grants();
