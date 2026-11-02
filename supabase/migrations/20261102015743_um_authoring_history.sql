-- Immutable form definitions accompany submissions; later edits never rewrite history.
alter table um.submissions add column form_snapshot jsonb not null default '{}';
create table um.form_revisions (
 form_id uuid not null references um.forms(id) on delete cascade,
 revision integer not null, definition jsonb not null,
 primary key(form_id,revision)
);
alter table um.form_revisions enable row level security;
revoke all on um.form_revisions from public,anon;
grant select on um.form_revisions to authenticated;
create policy form_history_read on um.form_revisions for select to authenticated
 using(exists(select 1 from um.forms f where f.id=form_id));
create function um.save_form_history() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if TG_OP='UPDATE' and NEW.definition<>OLD.definition and NEW.revision<=OLD.revision then raise exception 'FORM_REVISION_REQUIRED'; end if;
 insert into um.form_revisions(form_id,revision,definition) values(NEW.id,NEW.revision,NEW.definition) on conflict do nothing;
 return NEW;
end $$;
create trigger form_history after insert or update on um.forms for each row execute function um.save_form_history();
create function um.record_submission() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare current_form um.forms;
begin
 select * into current_form from um.forms where id=NEW.form_id and published for update;
 if not um.profile_holder(NEW.profile_id) or NEW.respondent_id<>auth.uid() or current_form.id is null
 or current_form.profile_id<>NEW.profile_id or current_form.project_id<>NEW.project_id or current_form.revision<>NEW.form_revision then raise exception 'INVALID_SUBMISSION'; end if;
 NEW.form_snapshot=current_form.definition;
 update um.participations set state='submitted',submission_id=NEW.id where project_id=NEW.project_id and profile_id=NEW.profile_id;
 return NEW;
end $$;
create trigger submission_capture before insert on um.submissions for each row execute function um.record_submission();
revoke all on function um.save_form_history(),um.record_submission() from public,anon,authenticated;
drop policy form_read on um.forms;
create policy form_read on um.forms for select to authenticated using(published and um.profile_holder(profile_id) or um.project_owner(project_id) and um.profile_access(profile_id));
