-- Parameter edits affect the next preparation; published bytes stay immutable.
create function um.invalidate_parameter_inspection() returns trigger
language plpgsql security definer set search_path='' as $$
declare target_owner uuid; target_project uuid;
begin
 if tg_table_name='projects' then
  if (old.metadata->'configuration',old.metadata->'requirements',old.metadata->'parameterIntention') is not distinct from
     (new.metadata->'configuration',new.metadata->'requirements',new.metadata->'parameterIntention') then return new; end if;
  target_project:=new.id;
 elsif tg_table_name='account_parameters' then target_owner:=new.account_id;
 else target_project:=new.project_id;
 end if;
 update um.authoring_drafts d set revision=d.revision+1,
  inspection=jsonb_build_object('kind','ai','references',jsonb_build_array('Parâmetros alterados; reinspeção necessária.'),'findings','[]'::jsonb,'completed',false),
  next_step='Revisar parâmetros vigentes e inspecionar novamente.',updated_at=now()
 from um.projects p where p.id=d.project_id and d.status='draft' and
  (p.id=target_project or p.owner_id=target_owner);
 return new;
end;
$$;
revoke all on function um.invalidate_parameter_inspection() from public;
create trigger parameters_account_changed after insert or update on um.account_parameters for each row execute function um.invalidate_parameter_inspection();
create trigger parameters_unit_changed after insert or update on um.unit_parameters for each row execute function um.invalidate_parameter_inspection();
create trigger parameters_project_changed after update of metadata on um.projects for each row execute function um.invalidate_parameter_inspection();
