-- A shared copy records its profile of origin. Deleting a profile removes its
-- contribution, not another reader's replies. No historical origin is guessed.
alter table um.comments add column origin_profile_id uuid references um.profiles(id) on delete set null;
alter table um.comments add column deleted_at timestamptz;
alter table um.comments alter column account_id drop not null;
alter table um.observations add column origin_profile_id uuid references um.profiles(id) on delete cascade;
create index comments_origin_profile_idx on um.comments(origin_profile_id);
create index observations_origin_profile_idx on um.observations(origin_profile_id);

create function um.guard_shared_origin() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='INSERT' then
  if new.origin_profile_id is null then
   if not um.project_owner(new.project_id) then raise exception 'PROFILE_REQUIRED'; end if;
  elsif not um.profile_holder(new.origin_profile_id) or not exists(select 1 from um.participations where project_id=new.project_id and profile_id=new.origin_profile_id) then
   raise exception 'INVALID_ORIGIN_PROFILE';
  end if;
 elsif new.account_id is distinct from old.account_id or new.project_id is distinct from old.project_id or new.origin_profile_id is distinct from old.origin_profile_id then
  raise exception 'IMMUTABLE_SHARED_ORIGIN';
 end if;
 if tg_table_name='comments' then
  if tg_op='UPDATE' and old.deleted_at is not null then raise exception 'REMOVED_COMMENT'; end if;
  if new.deleted_at is not null then
   new.account_id=null; new.origin_profile_id=null; new.text=''; new.target='{}'::jsonb;
  end if;
 end if;
 return new;
end $$;
revoke all on function um.guard_shared_origin() from public,anon,authenticated;
create trigger guard_shared_origin before insert or update on um.comments for each row execute function um.guard_shared_origin();
create trigger guard_shared_origin before insert or update on um.observations for each row execute function um.guard_shared_origin();

drop policy comments_write on um.comments;
create policy comments_insert on um.comments for insert to authenticated with check(account_id=auth.uid() and um.project_access(project_id) and deleted_at is null);
create policy comments_update on um.comments for update to authenticated using(account_id=auth.uid() and um.project_access(project_id) and deleted_at is null)
 with check(um.project_access(project_id) and (account_id=auth.uid() or (account_id is null and deleted_at is not null)));
revoke delete on um.comments from authenticated;

create function um.erase_profile_contributions() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 update um.comments set deleted_at=now() where origin_profile_id=old.id and deleted_at is null;
 return old;
end $$;
revoke all on function um.erase_profile_contributions() from public,anon,authenticated;
create trigger erase_profile_contributions before delete on um.profiles for each row execute function um.erase_profile_contributions();
