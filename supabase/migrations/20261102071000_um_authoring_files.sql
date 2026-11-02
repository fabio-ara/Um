-- This follows the local stabilization migration before any hosted promotion.
-- Refuse to discard an existing draft; no silent JSON-to-file data loss.
do $$ begin
 if exists(select 1 from um.authoring_items) then raise exception 'AUTHORING_FILE_MIGRATION_REQUIRES_EMPTY_ITEMS'; end if;
end $$;
alter table um.authoring_items drop column body;
alter table um.authoring_items add column file_path text not null unique references um.files(path) on delete cascade;
create policy authoring_file_holder on um.files for select to authenticated using(
 profile_id is not null and um.profile_holder(profile_id) and exists(
  select 1 from um.authoring_items i join um.authoring_drafts d on d.id=i.draft_id
  where i.file_path=path and d.profile_id=files.profile_id
 )
);
create function um.authoring_file_retire() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' or old.file_path<>new.file_path then
  -- Published files remain referenced by immutable manifests.
  delete from um.files where path=old.file_path and state='prepared';
 end if;
 return null;
end $$;
revoke all on function um.authoring_file_retire() from public,anon,authenticated;
create trigger authoring_file_retire after delete or update of file_path on um.authoring_items for each row execute function um.authoring_file_retire();
