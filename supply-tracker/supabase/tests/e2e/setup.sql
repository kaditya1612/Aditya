-- TEST-ONLY: credentials store for the emulator + three portal accounts.
create schema if not exists e2e;
create table e2e.passwords (user_id uuid primary key references auth.users(id) on delete cascade, hash text not null, banned boolean not null default false);
create table e2e.refresh_tokens (token text primary key, user_id uuid not null);
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant select on auth.users to service_role;

-- First account becomes the administrator (bootstrap rule); the others are created like the admin API does.
insert into auth.users(email, raw_app_meta_data, raw_user_meta_data) values ('admin@supply.test', '{}', '{"full_name":"Asha Admin"}');
insert into auth.users(email, raw_app_meta_data) values ('manager@supply.test', '{"role":"manager","full_name":"Priya Manager"}');
insert into auth.users(email, raw_app_meta_data)
  select 'leader@supply.test', jsonb_build_object('role','leader','full_name','Leo Leader','team_id', id) from public.teams where name = 'Supply Team';
insert into public.teams(name) values ('Destinations Team');
insert into auth.users(email, raw_app_meta_data)
  select 'leader2@supply.test', jsonb_build_object('role','leader','full_name','Lia Leader','team_id', id) from public.teams where name = 'Destinations Team';
-- password for all: Passw0rd!123  (sha256 of 'salt:' || password, emulator scheme)
insert into e2e.passwords(user_id, hash)
  select id, encode(sha256(convert_to('salt:Passw0rd!123', 'UTF8')), 'hex') from auth.users;
