create table if not exists public.gymlog_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gymlog_user_state enable row level security;

drop policy if exists "Users can read their own GymLog state" on public.gymlog_user_state;
drop policy if exists "Users can insert their own GymLog state" on public.gymlog_user_state;
drop policy if exists "Users can update their own GymLog state" on public.gymlog_user_state;

create policy "Users can read their own GymLog state"
on public.gymlog_user_state
for select
to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy "Users can insert their own GymLog state"
on public.gymlog_user_state
for insert
to authenticated
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy "Users can update their own GymLog state"
on public.gymlog_user_state
for update
to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()))
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

create or replace function public.set_gymlog_user_state_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_gymlog_user_state_updated_at on public.gymlog_user_state;

create trigger set_gymlog_user_state_updated_at
before update on public.gymlog_user_state
for each row
execute function public.set_gymlog_user_state_updated_at();
