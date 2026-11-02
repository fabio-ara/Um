revoke select(id,user_id,not_after) on auth.sessions from um_oauth_server;
revoke usage on schema auth from um_oauth_server;
create function um.oauth_session_active(account uuid, session uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from auth.sessions s where s.user_id=account and s.id=session and (s.not_after is null or s.not_after>now()))
$$;
revoke all on function um.oauth_session_active(uuid,uuid) from public,anon,authenticated;
grant execute on function um.oauth_session_active(uuid,uuid) to um_oauth_server;
