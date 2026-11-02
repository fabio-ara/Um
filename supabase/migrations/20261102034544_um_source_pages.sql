-- Canonical files remain immutable. These derived indexes locate a block and
-- retrieve only its page; no document text or private profile enters the index.
create table um.source_pages (
 source_id uuid not null,
 revision integer not null,
 page_number integer not null check(page_number>=0),
 first_position integer not null check(first_position>=0),
 block_count integer not null check(block_count between 1 and 100),
 file_path text not null references um.files(path),
 primary key(source_id,revision,page_number),
 foreign key(source_id,revision) references um.source_revisions(source_id,revision) on delete cascade
);
create table um.source_block_index (
 source_id uuid not null,
 revision integer not null,
 block_id text not null,
 position integer not null check(position>=0),
 page_number integer not null,
 locator text,
 primary key(source_id,revision,block_id),
 unique(source_id,revision,position),
 foreign key(source_id,revision,page_number) references um.source_pages(source_id,revision,page_number) on delete cascade
);
alter table um.source_pages enable row level security;
alter table um.source_block_index enable row level security;
create policy source_pages_read on um.source_pages for select to authenticated using(um.session_valid() and um.source_access(source_id));
create policy source_blocks_read on um.source_block_index for select to authenticated using(um.session_valid() and um.source_access(source_id));
create policy source_pages_insert on um.source_pages for insert to authenticated with check(um.session_valid() and exists(select 1 from um.sources s where s.id=source_id and s.owner_id=auth.uid()));
create policy source_blocks_insert on um.source_block_index for insert to authenticated with check(um.session_valid() and exists(select 1 from um.sources s where s.id=source_id and s.owner_id=auth.uid()));
grant select,insert on um.source_pages,um.source_block_index to authenticated;
