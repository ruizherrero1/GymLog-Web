alter table public.gymlog_user_preferences
  add column if not exists age smallint check (age between 12 and 100);

alter table public.gymlog_synced_sessions
  add column if not exists orphaned_at timestamptz;

update public.gymlog_synced_sessions synced
set orphaned_at = now()
where orphaned_at is null
  and not exists (
    select 1
    from public.gymlog_user_state state
    cross join lateral jsonb_array_elements(coalesce(state.data->'workoutLog', '[]'::jsonb)) session(item)
    where state.user_id = synced.user_id
      and session.item->>'id' = synced.local_id
  );

update public.gymlog_synced_sessions synced
set orphaned_at = null
where orphaned_at is not null
  and exists (
    select 1
    from public.gymlog_user_state state
    cross join lateral jsonb_array_elements(coalesce(state.data->'workoutLog', '[]'::jsonb)) session(item)
    where state.user_id = synced.user_id
      and session.item->>'id' = synced.local_id
  );

create index if not exists gymlog_synced_sessions_orphan_idx
  on public.gymlog_synced_sessions (user_id, orphaned_at)
  where orphaned_at is not null;
