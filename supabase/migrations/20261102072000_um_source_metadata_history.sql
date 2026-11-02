alter table um.source_revisions add column metadata jsonb;
alter table um.source_revisions add column change_reason text;
update um.source_revisions r set metadata=s.metadata from um.sources s where s.id=r.source_id;
alter table um.source_revisions alter column metadata set not null;
