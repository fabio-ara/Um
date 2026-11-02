create function um.preserve_published_source_link() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 -- A whole-project deletion is authorized by its existing RLS and cascades
 -- published bundles too; removing an individual live link must preserve them.
 if exists(select 1 from um.projects where id=old.project_id) and exists(
  select 1 from um.bundle_sources s join um.bundles b on b.id=s.bundle_id where b.project_id=old.project_id and s.source_id=old.source_id
 ) then raise exception 'SOURCE_IN_USE'; end if;
 return old;
end $$;
revoke all on function um.preserve_published_source_link() from public,anon,authenticated;
create trigger preserve_published_source_link before delete on um.project_sources for each row execute function um.preserve_published_source_link();
create or replace function um.record_bundle_sources() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 insert into um.bundle_sources(bundle_id,source_id)
 select new.id,s.id::uuid from jsonb_object_keys(new.manifest->'sourceRevisions') s(id) on conflict do nothing;
 return null;
end $$;
create trigger record_updated_bundle_sources after update of manifest on um.bundles for each row execute function um.record_bundle_sources();
