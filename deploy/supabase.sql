-- Run once in the intended Supabase project's SQL Editor.
-- No existing application tables are changed. Browser access is prohibited.
begin;

create table if not exists public.cantobridge_snapshots (
  id text primary key,
  revision bigint not null check (revision > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.cantobridge_snapshots enable row level security;
revoke all on public.cantobridge_snapshots from public, anon, authenticated;
grant select, insert, update on public.cantobridge_snapshots to service_role;

create or replace function public.cantobridge_save_snapshot(
  snapshot_id text, expected_revision bigint, snapshot_data jsonb
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare next_revision bigint;
begin
  if expected_revision = 0 then
    insert into public.cantobridge_snapshots (id, revision, data)
      values (snapshot_id, 1, snapshot_data)
      on conflict (id) do nothing
      returning revision into next_revision;
  else
    update public.cantobridge_snapshots
      set data = snapshot_data, revision = revision + 1, updated_at = now()
      where id = snapshot_id and revision = expected_revision
      returning revision into next_revision;
  end if;
  if next_revision is null then
    raise exception 'snapshot revision conflict' using errcode = '40001';
  end if;
  return next_revision;
end;
$$;
revoke all on function public.cantobridge_save_snapshot(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.cantobridge_save_snapshot(text, bigint, jsonb) to service_role;

commit;
