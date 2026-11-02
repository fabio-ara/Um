-- A permission must name a registered Um OAuth client. Existing rows are
-- validated; deployment must stop instead of silently deleting unknown grants.
alter table um.client_grants add constraint client_grants_client_id_fkey
 foreign key(client_id) references um.oauth_clients(id) on delete cascade;
