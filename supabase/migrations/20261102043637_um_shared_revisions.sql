alter table um.comments add column revision integer not null default 1 check(revision>0);
alter table um.comments add unique(id,project_id);
alter table um.comments add foreign key(reply_to,project_id) references um.comments(id,project_id) deferrable initially deferred;
revoke update on um.comments from authenticated;
grant update(text,deleted_at,revision) on um.comments to authenticated;
create function um.guard_comment_revision() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if new.revision<>old.revision+1 then raise exception 'COMMENT_REVISION_REQUIRED'; end if;
 return new;
end $$;
revoke all on function um.guard_comment_revision() from public,anon,authenticated;
create trigger guard_comment_revision before update on um.comments for each row execute function um.guard_comment_revision();
create or replace function um.erase_profile_contributions() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 update um.comments set deleted_at=now(),revision=revision+1 where origin_profile_id=old.id and deleted_at is null;
 return old;
end $$;
