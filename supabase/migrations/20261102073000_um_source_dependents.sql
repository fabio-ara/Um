-- A source may be reused by another authorized author. RLS must not hide the
-- dependent project from this narrowly scoped invalidation.
create function um.source_revision_dependents() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.revision<>old.revision then
  update um.projects set base_state='correcting',revision=revision+1
  where id in(select project_id from um.project_sources where source_id=new.id);
 end if;
 return null;
end $$;
revoke all on function um.source_revision_dependents() from public,anon,authenticated;
create trigger source_revision_dependents after update of revision on um.sources for each row execute function um.source_revision_dependents();
