-- Removing SQL metadata alone does not remove a Storage object. A transactional
-- deletion queue survives the cascade; the authorized caller removes bytes via
-- the Storage API and acknowledges the job only after that call succeeds.
alter table um.files add constraint files_owner_path check(split_part(path,'/',1)=owner_id::text and path ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}$') not valid;
create table um.file_deletions (
 path text primary key,
 requested_by uuid not null,
 owner_id uuid not null,
 profile_id uuid,
 sha256 text not null,
 requested_at timestamptz not null default now(),
 completed_at timestamptz
);
alter table um.file_deletions enable row level security;
create policy file_deletions_read on um.file_deletions for select to authenticated using(um.session_valid() and requested_by=auth.uid());
create policy file_deletions_complete on um.file_deletions for update to authenticated using(um.session_valid() and requested_by=auth.uid()) with check(requested_by=auth.uid());
grant select on um.file_deletions to authenticated;
grant update(completed_at) on um.file_deletions to authenticated;
create index file_deletions_pending on um.file_deletions(requested_by,requested_at) where completed_at is null;
create function um.enqueue_file_deletion() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 insert into um.file_deletions(path,requested_by,owner_id,profile_id,sha256)
 values(old.path,coalesce(auth.uid(),old.owner_id),old.owner_id,old.profile_id,old.sha256) on conflict(path) do nothing;
 return old;
end $$;
revoke all on function um.enqueue_file_deletion() from public,anon,authenticated;
create trigger enqueue_file_deletion before delete on um.files for each row execute function um.enqueue_file_deletion();

-- A deletion ticket is not permission to read former private content. Storage
-- policies must restrict this predicate to the remove operation (including its
-- internal SELECT), never to object downloads or signed URLs.
create function um.file_deletion_access(object_path text) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select um.session_valid() and exists(select 1 from um.file_deletions d where d.path=object_path and d.requested_by=auth.uid() and d.completed_at is null)
$$;
revoke all on function um.file_deletion_access(text) from public,anon;
grant execute on function um.file_deletion_access(text) to authenticated;

-- An unclaimed profile is controlled by its creator; association transfers
-- privacy controls to the authenticated holder, never to an entered name.
create or replace function um.profile_control(target uuid, action text) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not um.profile_holder(target) and not (um.session_valid() and exists(select 1 from um.profiles where id=target and holder_id is null and creator_id=auth.uid())) then raise exception 'FORBIDDEN'; end if;
 if action='revoke_creator' then
  if not um.profile_holder(target) then raise exception 'FORBIDDEN'; end if;
  update um.profiles set creator_access=false,revision=revision+1 where id=target;
  update um.invites set revoked=true where profile_id=target;
 elsif action='publish' then update um.profiles set visibility='public',revision=revision+1 where id=target;
 elsif action='private' then update um.profiles set visibility='private',revision=revision+1 where id=target;
 elsif action='delete' then delete from um.profiles where id=target;
 else raise exception 'INVALID_ACTION'; end if;
end $$;
