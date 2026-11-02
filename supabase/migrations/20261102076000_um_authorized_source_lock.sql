-- SELECT FOR SHARE also invokes update RLS. Authors may publish an authorized
-- reused source without becoming its owner; lock only after the read ACL check.
create function um.lock_source(target uuid) returns integer language plpgsql security definer set search_path=pg_catalog as $$
declare version integer;
begin
 if not um.source_access(target) then return null; end if;
 select revision into version from um.sources where id=target for share;
 return version;
end $$;
revoke all on function um.lock_source(uuid) from public,anon;
grant execute on function um.lock_source(uuid) to authenticated;
