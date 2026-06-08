-- Run this in the Supabase SQL editor for project: qserywqzvluqfrnyeggz
-- (the one used by gym.ramonruizherrero.com)

create table if not exists public.gymlog_user_state (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  data     jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Row-level security: each user can only read/write their own row
alter table public.gymlog_user_state enable row level security;

create policy "Users can read own state"
  on public.gymlog_user_state for select
  using (auth.uid() = user_id);

create policy "Users can upsert own state"
  on public.gymlog_user_state for insert
  with check (auth.uid() = user_id);

create policy "Users can update own state"
  on public.gymlog_user_state for update
  using (auth.uid() = user_id);
