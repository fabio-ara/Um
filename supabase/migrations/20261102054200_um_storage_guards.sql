-- Metadata authorization also governs Storage. Upload paths cannot be recycled
-- after deletion, including when a former owner cannot see the old profile.
create function um.file_upload_access(object_path text) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not um.session_valid() or split_part(object_path,'/',1)<>auth.uid()::text or object_path !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}$' then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('um-file:'||object_path,0));
 return not exists(select 1 from um.files where path=object_path) and not exists(select 1 from um.file_deletions where path=object_path);
end $$;
revoke all on function um.file_upload_access(text) from public,anon;
grant execute on function um.file_upload_access(text) to authenticated;

-- A successful API response is insufficient if Storage silently omitted a path.
-- Refuse completion until the actual Storage metadata row is gone. The local
-- filesystem adapter has no storage.objects and confirms its own unlink first.
create function um.confirm_file_absence() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare present boolean;
begin
 if new.completed_at is null or old.completed_at is not null then raise exception 'INVALID_COMPLETION'; end if;
 if to_regclass('storage.objects') is not null then
  execute 'select exists(select 1 from storage.objects where bucket_id=''um-private'' and name=$1)' into present using old.path;
  if present then raise exception 'FILE_REMOVAL_PENDING'; end if;
 end if;
 return new;
end $$;
revoke all on function um.confirm_file_absence() from public,anon,authenticated;
create trigger confirm_file_absence before update on um.file_deletions for each row execute function um.confirm_file_absence();
