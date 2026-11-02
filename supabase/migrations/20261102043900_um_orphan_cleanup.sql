alter table um.file_deletions add column reason text not null default 'deleted' check(reason in ('deleted','abandoned_upload'));
-- Serialization prevents registration racing a cleanup ticket. An existing
-- registered object is protected even when RLS hides it from its former owner.
create function um.guard_file_registration() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('um-file:'||new.path,0));
 if exists(select 1 from um.file_deletions where path=new.path) then raise exception 'FILE_REMOVAL_PENDING'; end if;
 return new;
end $$;
revoke all on function um.guard_file_registration() from public,anon,authenticated;
create trigger guard_file_registration before insert on um.files for each row execute function um.guard_file_registration();
revoke update on um.files from authenticated;
grant update(state,offline_allowed) on um.files to authenticated;

create function um.enqueue_orphan_file(object_path text) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not um.session_valid() or split_part(object_path,'/',1)<>auth.uid()::text or object_path !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}$' then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended('um-file:'||object_path,0));
 if exists(select 1 from um.files where path=object_path) then return false; end if;
 -- Empty digest explicitly means unregistered bytes, not a fabricated hash.
 insert into um.file_deletions(path,requested_by,owner_id,sha256,reason) values(object_path,auth.uid(),auth.uid(),'','abandoned_upload') on conflict do nothing;
 return found;
end $$;
revoke all on function um.enqueue_orphan_file(text) from public,anon;
grant execute on function um.enqueue_orphan_file(text) to authenticated;

-- Hosted metadata is read only; actual object removal always uses Storage API.
-- The local file backend enumerates its own directory instead.
create function um.orphan_candidates(after_path text, batch_size integer) returns table(path text) language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not um.session_valid() then raise exception 'FORBIDDEN'; end if;
 if batch_size<1 or batch_size>100 then raise exception 'INVALID_LIMIT'; end if;
 return query execute 'select o.name from storage.objects o where o.bucket_id=''um-private'' and split_part(o.name,''/'',1)=$1 and o.name>$2 and o.updated_at<now()-interval ''24 hours'' and not exists(select 1 from um.files f where f.path=o.name) and not exists(select 1 from um.file_deletions d where d.path=o.name) order by o.name limit $3' using auth.uid()::text,after_path,batch_size;
end $$;
revoke all on function um.orphan_candidates(text,integer) from public,anon;
grant execute on function um.orphan_candidates(text,integer) to authenticated;
