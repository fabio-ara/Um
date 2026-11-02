-- Published references remain authoritative even when a personal bundle is
-- hidden from its former author by RLS.
create table um.bundle_sources (
 bundle_id uuid not null references um.bundles(id) on delete cascade,
 source_id uuid not null references um.sources(id),
 primary key(bundle_id,source_id)
);
alter table um.bundle_sources enable row level security;
insert into um.bundle_sources(bundle_id,source_id)
select b.id,s.id::uuid from um.bundles b cross join lateral jsonb_object_keys(b.manifest->'sourceRevisions') s(id);
create function um.record_bundle_sources() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 insert into um.bundle_sources(bundle_id,source_id)
 select new.id,s.id::uuid from jsonb_object_keys(new.manifest->'sourceRevisions') s(id);
 return null;
end $$;
revoke all on function um.record_bundle_sources() from public,anon,authenticated;
create trigger record_bundle_sources after insert on um.bundles for each row execute function um.record_bundle_sources();
create function um.source_link_published(project uuid,source uuid) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select um.project_owner(project) and exists(select 1 from um.bundle_sources s join um.bundles b on b.id=s.bundle_id where b.project_id=project and s.source_id=source)
$$;
revoke all on function um.source_link_published(uuid,uuid) from public,anon;
grant execute on function um.source_link_published(uuid,uuid) to authenticated;

create or replace function um.source_revision_dependents() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare target uuid;
begin
 if new.revision<>old.revision then
  -- Source rows precede project rows in the application lock order. Lock
  -- multiple dependent projects in a stable order for concurrent revisions.
  for target in select p.id from um.projects p join um.project_sources ps on ps.project_id=p.id where ps.source_id=new.id order by p.id for update of p loop
   update um.projects set base_state=case when active_revision is null then base_state else 'correcting' end,revision=revision+1 where id=target;
  end loop;
 end if;
 if new.metadata->'rights' is distinct from old.metadata->'rights' then
  update um.files set offline_allowed=coalesce((new.metadata->'rights'->>'offlineAllowed')::boolean,false) where source_id=new.id;
  update um.files f set offline_allowed=coalesce((
   select bool_and((s.metadata->'rights'->>'offlineAllowed')::boolean) from um.project_sources ps join um.sources s on s.id=ps.source_id where ps.project_id=f.project_id
  ),false) where f.project_id in(select project_id from um.project_sources where source_id=new.id);
 end if;
 return null;
end $$;
