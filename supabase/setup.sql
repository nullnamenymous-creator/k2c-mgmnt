create table if not exists public.k2c_state (
  id smallint primary key check (id = 1),
  revision bigint not null default 0,
  body jsonb not null
);
insert into public.k2c_state (id, body)
values (1, '{"products":[],"sales":[],"purchases":[],"movements":[]}')
on conflict do nothing;

create table if not exists public.k2c_submissions (
  session_id uuid not null,
  token uuid not null,
  primary key (session_id, token)
);

alter table public.k2c_state enable row level security;
alter table public.k2c_submissions enable row level security;
revoke all on public.k2c_state, public.k2c_submissions from public, anon, authenticated;
grant select, update on public.k2c_state to service_role;
grant select, insert, delete on public.k2c_submissions to service_role;

create or replace function public.k2c_commit(
  expected_revision bigint, next_body jsonb, client_session uuid, client_token uuid
) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  current_revision bigint;
begin
  select revision into current_revision from public.k2c_state where id = 1 for update;
  if exists (select 1 from public.k2c_submissions where session_id = client_session and token = client_token) then
    return 'duplicate';
  end if;
  if current_revision is distinct from expected_revision then
    return 'conflict';
  end if;
  update public.k2c_state set revision = revision + 1, body = next_body where id = 1;
  insert into public.k2c_submissions values (client_session, client_token);
  return 'saved';
end;
$$;
revoke execute on function public.k2c_commit(bigint, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.k2c_commit(bigint, jsonb, uuid, uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('k2c-evidence', 'k2c-evidence', false, 47185920,
  array['video/mp4','image/jpeg','image/png','image/webp','image/heic','image/heif','image/avif'])
on conflict (id) do nothing;
