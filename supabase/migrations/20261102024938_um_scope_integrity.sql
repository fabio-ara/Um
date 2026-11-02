-- Scope pointers cannot refer to another participant, even through direct SQL.
alter table um.forms add unique(id,project_id,profile_id);
alter table um.submissions add unique(id,project_id,profile_id,form_id);
alter table um.submissions add unique(id,project_id,profile_id);
alter table um.participations add foreign key(form_id,project_id,profile_id)
 references um.forms(id,project_id,profile_id) deferrable initially deferred;
alter table um.participations add foreign key(submission_id,project_id,profile_id,form_id)
 references um.submissions(id,project_id,profile_id,form_id) deferrable initially deferred;
alter table um.participations add check(submission_id is null or form_id is not null);
alter table um.personalization_reasons add foreign key(submission_id,project_id,profile_id)
 references um.submissions(id,project_id,profile_id) on delete cascade;
-- NOT VALID preserves any pre-existing orphan for explicit reconciliation; new rows are checked.
alter table um.catalog add constraint catalog_account_fk foreign key(account_id) references auth.users(id) on delete cascade not valid;

-- A committed attempt or receipt is immutable. Personal deletion still follows existing RLS.
create function um.immutable_reader_attempt() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if OLD.kind='attempt' and NEW is distinct from OLD then raise exception 'IMMUTABLE_ATTEMPT'; end if;
 if NEW.kind<>OLD.kind or NEW.account_id<>OLD.account_id or NEW.profile_id<>OLD.profile_id or NEW.project_id<>OLD.project_id then raise exception 'IMMUTABLE_RECORD_SCOPE'; end if;
 return NEW;
end $$;
create trigger reader_attempt_immutable before update on um.reader_records for each row execute function um.immutable_reader_attempt();
revoke all on function um.immutable_reader_attempt() from public,anon,authenticated;
revoke update on um.operations from authenticated;

-- Private-use means the importing account. Offline permission is distinct from online reading.
create or replace function um.source_access(target uuid) returns boolean language sql stable security definer
set search_path=pg_catalog as $$
 select um.session_valid() and exists(select 1 from um.sources s where s.id=target and
 (s.owner_id=auth.uid() or s.metadata->'rights'->>'status'<>'private-use' and
 exists(select 1 from um.project_sources p where p.source_id=s.id and um.project_access(p.project_id))))
$$;
create policy file_source_rights on um.files as restrictive for select to authenticated using(
 source_id is null or owner_id=auth.uid() or
 exists(select 1 from um.sources s where s.id=source_id and um.source_access(s.id)
 and (s.original_file is distinct from path or offline_allowed))
);
