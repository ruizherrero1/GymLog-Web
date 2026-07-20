-- GymLog reliability layer. The existing JSON state remains the source of truth
-- while normalized tables are populated additively for safer incremental reads.

alter table public.gymlog_user_state
  add column if not exists revision bigint not null default 1,
  add column if not exists last_client_id text;

create table if not exists public.gymlog_state_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null,
  reason text not null check (char_length(reason) between 1 and 80),
  checksum text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists gymlog_state_snapshots_user_created_idx
  on public.gymlog_state_snapshots (user_id, created_at desc);

create table if not exists public.gymlog_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null,
  session_date date,
  routine_id text,
  routine_name text,
  duration_seconds integer,
  health_sync_status text,
  health_metrics_status text,
  health_summary jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  checksum text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, local_id)
);

create index if not exists gymlog_sessions_user_date_idx
  on public.gymlog_sessions (user_id, session_date desc)
  where deleted_at is null;

create table if not exists public.gymlog_session_exercises (
  user_id uuid not null,
  session_local_id text not null,
  exercise_index integer not null,
  exercise_id text,
  exercise_name text,
  exercise_type text,
  payload jsonb not null,
  primary key (user_id, session_local_id, exercise_index),
  foreign key (user_id, session_local_id)
    references public.gymlog_sessions(user_id, local_id) on delete cascade
);

create table if not exists public.gymlog_session_sets (
  user_id uuid not null,
  session_local_id text not null,
  exercise_index integer not null,
  set_index integer not null,
  reps numeric,
  weight numeric,
  duration_seconds numeric,
  completed boolean,
  payload jsonb not null,
  primary key (user_id, session_local_id, exercise_index, set_index),
  foreign key (user_id, session_local_id, exercise_index)
    references public.gymlog_session_exercises(user_id, session_local_id, exercise_index)
    on delete cascade
);

create table if not exists public.gymlog_heart_rate_samples (
  user_id uuid not null,
  session_local_id text not null,
  sample_time timestamptz not null,
  bpm smallint not null check (bpm between 30 and 250),
  source text not null default 'fitbit',
  created_at timestamptz not null default now(),
  primary key (user_id, session_local_id, sample_time),
  foreign key (user_id, session_local_id)
    references public.gymlog_sessions(user_id, local_id) on delete cascade
);

create index if not exists gymlog_hr_user_time_idx
  on public.gymlog_heart_rate_samples (user_id, sample_time desc);

create table if not exists public.gymlog_weights (
  user_id uuid not null references auth.users(id) on delete cascade,
  weight_date date not null,
  weight_kg numeric not null check (weight_kg > 0 and weight_kg < 500),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, weight_date)
);

create table if not exists public.gymlog_health_recovery_queue (
  user_id uuid not null,
  session_local_id text not null,
  attempt smallint not null check (attempt between 1 and 3),
  due_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, session_local_id, attempt),
  foreign key (user_id, session_local_id)
    references public.gymlog_sessions(user_id, local_id) on delete cascade
);

create index if not exists gymlog_health_recovery_due_idx
  on public.gymlog_health_recovery_queue (due_at)
  where status = 'pending';

create table if not exists public.gymlog_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  max_heart_rate smallint check (max_heart_rate between 100 and 240),
  resting_heart_rate smallint check (resting_heart_rate between 30 and 120),
  heart_rate_zones jsonb,
  timezone text not null default 'Europe/Madrid',
  updated_at timestamptz not null default now()
);

create table if not exists public.gymlog_sync_events (
  event_id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  level text not null check (level in ('info', 'warning', 'error')),
  code text not null,
  message text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gymlog_sync_events_user_created_idx
  on public.gymlog_sync_events (user_id, created_at desc);

alter table public.gymlog_state_snapshots enable row level security;
alter table public.gymlog_sessions enable row level security;
alter table public.gymlog_session_exercises enable row level security;
alter table public.gymlog_session_sets enable row level security;
alter table public.gymlog_heart_rate_samples enable row level security;
alter table public.gymlog_weights enable row level security;
alter table public.gymlog_health_recovery_queue enable row level security;
alter table public.gymlog_user_preferences enable row level security;
alter table public.gymlog_sync_events enable row level security;

do $policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'gymlog_state_snapshots', 'gymlog_sessions', 'gymlog_session_exercises',
    'gymlog_session_sets', 'gymlog_heart_rate_samples', 'gymlog_weights',
    'gymlog_health_recovery_queue', 'gymlog_user_preferences', 'gymlog_sync_events'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select_own', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name || '_select_own', table_name
    );
  end loop;
end
$policies$;

do $policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'gymlog_sessions', 'gymlog_session_exercises', 'gymlog_session_sets',
    'gymlog_heart_rate_samples', 'gymlog_weights', 'gymlog_health_recovery_queue',
    'gymlog_user_preferences'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_insert_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete_own', table_name);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      table_name || '_insert_own', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name || '_update_own', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      table_name || '_delete_own', table_name
    );
  end loop;
end
$policies$;

drop policy if exists gymlog_state_snapshots_insert_own on public.gymlog_state_snapshots;
create policy gymlog_state_snapshots_insert_own
  on public.gymlog_state_snapshots for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists gymlog_sync_events_insert_own on public.gymlog_sync_events;
create policy gymlog_sync_events_insert_own
  on public.gymlog_sync_events for insert to authenticated
  with check ((select auth.uid()) = user_id);

revoke all on public.gymlog_state_snapshots, public.gymlog_sessions,
  public.gymlog_session_exercises, public.gymlog_session_sets,
  public.gymlog_heart_rate_samples, public.gymlog_weights,
  public.gymlog_health_recovery_queue, public.gymlog_user_preferences,
  public.gymlog_sync_events from anon;

grant select, insert on public.gymlog_state_snapshots to authenticated;
grant select, insert, update, delete on public.gymlog_sessions,
  public.gymlog_session_exercises, public.gymlog_session_sets,
  public.gymlog_heart_rate_samples, public.gymlog_weights,
  public.gymlog_health_recovery_queue, public.gymlog_user_preferences to authenticated;
grant select, insert on public.gymlog_sync_events to authenticated;
grant usage, select on sequence public.gymlog_sync_events_event_id_seq to authenticated;

create or replace function public.gymlog_normalize_state_row()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $function$
declare
  session_json jsonb;
  exercise_json jsonb;
  set_json jsonb;
  sample_json jsonb;
  session_id text;
  session_checksum text;
  previous_checksum text;
  exercise_ordinal bigint;
  set_ordinal bigint;
begin
  update public.gymlog_sessions
     set deleted_at = now(), updated_at = now()
   where user_id = new.user_id
     and deleted_at is null
     and not exists (
       select 1 from jsonb_array_elements(coalesce(new.data->'workoutLog', '[]'::jsonb)) item
       where item->>'id' = gymlog_sessions.local_id
     );

  for session_json in
    select item from jsonb_array_elements(coalesce(new.data->'workoutLog', '[]'::jsonb)) item
  loop
    session_id := session_json->>'id';
    if session_id is null or session_id = '' then
      continue;
    end if;
    session_checksum := encode(digest(session_json::text, 'sha256'), 'hex');
    select checksum into previous_checksum
      from public.gymlog_sessions
     where user_id = new.user_id and local_id = session_id;

    insert into public.gymlog_sessions (
      user_id, local_id, session_date, routine_id, routine_name, duration_seconds,
      health_sync_status, health_metrics_status, health_summary, payload, checksum,
      deleted_at, updated_at
    ) values (
      new.user_id,
      session_id,
      case when session_json->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (session_json->>'date')::date end,
      session_json->>'routineId',
      session_json->>'routineName',
      case when session_json->>'duration' ~ '^[0-9]+([.][0-9]+)?$' then round((session_json->>'duration')::numeric)::integer end,
      session_json #>> '{health,syncStatus}',
      session_json #>> '{health,metricsStatus}',
      coalesce(session_json->'health', '{}'::jsonb) #- '{metrics,heartRateSamples}',
      session_json,
      session_checksum,
      null,
      now()
    )
    on conflict (user_id, local_id) do update set
      session_date = excluded.session_date,
      routine_id = excluded.routine_id,
      routine_name = excluded.routine_name,
      duration_seconds = excluded.duration_seconds,
      health_sync_status = excluded.health_sync_status,
      health_metrics_status = excluded.health_metrics_status,
      health_summary = excluded.health_summary,
      payload = excluded.payload,
      checksum = excluded.checksum,
      deleted_at = null,
      updated_at = now();

    if previous_checksum is distinct from session_checksum then
      delete from public.gymlog_session_exercises
       where user_id = new.user_id and session_local_id = session_id;
      delete from public.gymlog_heart_rate_samples
       where user_id = new.user_id and session_local_id = session_id;

      for exercise_json, exercise_ordinal in
        select item, ordinality
          from jsonb_array_elements(coalesce(session_json->'exercises', '[]'::jsonb)) with ordinality as e(item, ordinality)
      loop
        insert into public.gymlog_session_exercises (
          user_id, session_local_id, exercise_index, exercise_id, exercise_name, exercise_type, payload
        ) values (
          new.user_id, session_id, exercise_ordinal::integer - 1,
          exercise_json->>'id', exercise_json->>'name', exercise_json->>'type', exercise_json
        );

        for set_json, set_ordinal in
          select item, ordinality
            from jsonb_array_elements(coalesce(exercise_json->'series', '[]'::jsonb)) with ordinality as s(item, ordinality)
        loop
          insert into public.gymlog_session_sets (
            user_id, session_local_id, exercise_index, set_index,
            reps, weight, duration_seconds, completed, payload
          ) values (
            new.user_id, session_id, exercise_ordinal::integer - 1, set_ordinal::integer - 1,
            case when set_json->>'reps' ~ '^-?[0-9]+([.][0-9]+)?$' then (set_json->>'reps')::numeric end,
            case when set_json->>'weight' ~ '^-?[0-9]+([.][0-9]+)?$' then (set_json->>'weight')::numeric end,
            case when set_json->>'duration' ~ '^-?[0-9]+([.][0-9]+)?$' then (set_json->>'duration')::numeric end,
            case when jsonb_typeof(set_json->'done') = 'boolean' then (set_json->>'done')::boolean end,
            set_json
          );
        end loop;
      end loop;

      if jsonb_typeof(session_json #> '{health,metrics,heartRateSamples}') = 'array' then
        for sample_json in
          select item from jsonb_array_elements(session_json #> '{health,metrics,heartRateSamples}') item
        loop
          if sample_json->>'time' is not null
             and sample_json->>'bpm' ~ '^[0-9]+$'
             and (sample_json->>'bpm')::integer between 30 and 250 then
            begin
              insert into public.gymlog_heart_rate_samples (
                user_id, session_local_id, sample_time, bpm
              ) values (
                new.user_id, session_id, (sample_json->>'time')::timestamptz,
                (sample_json->>'bpm')::smallint
              ) on conflict (user_id, session_local_id, sample_time)
                do update set bpm = excluded.bpm;
            exception when invalid_datetime_format or datetime_field_overflow then
              null;
            end;
          end if;
        end loop;
      end if;
    end if;
  end loop;

  for sample_json in
    select item from jsonb_array_elements(coalesce(new.data->'weightLog', '[]'::jsonb)) item
  loop
    if sample_json->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       and sample_json->>'weight' ~ '^[0-9]+([.][0-9]+)?$'
       and (sample_json->>'weight')::numeric between 1 and 499 then
      insert into public.gymlog_weights (user_id, weight_date, weight_kg, payload, updated_at)
      values (new.user_id, (sample_json->>'date')::date, (sample_json->>'weight')::numeric, sample_json, now())
      on conflict (user_id, weight_date) do update set
        weight_kg = excluded.weight_kg, payload = excluded.payload, updated_at = now();
    end if;
  end loop;

  return new;
end
$function$;

drop trigger if exists gymlog_user_state_normalize on public.gymlog_user_state;
create trigger gymlog_user_state_normalize
after insert or update of data on public.gymlog_user_state
for each row execute function public.gymlog_normalize_state_row();

revoke all on function public.gymlog_normalize_state_row() from public, anon, authenticated;

create or replace function public.gymlog_create_state_snapshot(p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $function$
declare
  current_state public.gymlog_user_state%rowtype;
  snapshot_uuid uuid;
  state_checksum text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 80 then
    raise exception 'invalid_snapshot_reason';
  end if;
  select * into current_state from public.gymlog_user_state
   where user_id = auth.uid();
  if not found then raise exception 'state_not_found'; end if;
  state_checksum := encode(digest(current_state.data::text, 'sha256'), 'hex');
  insert into public.gymlog_state_snapshots(user_id, revision, reason, checksum, data)
  values (auth.uid(), current_state.revision, trim(p_reason), state_checksum, current_state.data)
  returning snapshot_id into snapshot_uuid;
  return jsonb_build_object('snapshotId', snapshot_uuid, 'revision', current_state.revision,
    'checksum', state_checksum, 'createdAt', now());
end
$function$;

create or replace function public.gymlog_save_user_state(
  p_data jsonb,
  p_expected_revision bigint,
  p_client_id text default null,
  p_snapshot_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $function$
declare
  current_state public.gymlog_user_state%rowtype;
  next_revision bigint;
  state_checksum text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_state'; end if;

  select * into current_state from public.gymlog_user_state
   where user_id = auth.uid() for update;

  if not found then
    if coalesce(p_expected_revision, 0) <> 0 then
      return jsonb_build_object('status', 'conflict', 'revision', 0);
    end if;
    insert into public.gymlog_user_state(user_id, data, revision, last_client_id, updated_at)
    values (auth.uid(), p_data, 1, left(p_client_id, 120), now());
    return jsonb_build_object('status', 'saved', 'revision', 1, 'updatedAt', now());
  end if;

  if current_state.revision <> coalesce(p_expected_revision, 0) then
    return jsonb_build_object('status', 'conflict', 'revision', current_state.revision,
      'updatedAt', current_state.updated_at);
  end if;

  if p_snapshot_reason is not null then
    state_checksum := encode(digest(current_state.data::text, 'sha256'), 'hex');
    insert into public.gymlog_state_snapshots(user_id, revision, reason, checksum, data)
    values (auth.uid(), current_state.revision, left(trim(p_snapshot_reason), 80), state_checksum, current_state.data);
  end if;

  next_revision := current_state.revision + 1;
  update public.gymlog_user_state
     set data = p_data, revision = next_revision,
         last_client_id = left(p_client_id, 120), updated_at = now()
   where user_id = auth.uid();

  return jsonb_build_object('status', 'saved', 'revision', next_revision, 'updatedAt', now());
end
$function$;

revoke all on function public.gymlog_create_state_snapshot(text) from public, anon;
revoke all on function public.gymlog_save_user_state(jsonb, bigint, text, text) from public, anon;
grant execute on function public.gymlog_create_state_snapshot(text) to authenticated;
grant execute on function public.gymlog_save_user_state(jsonb, bigint, text, text) to authenticated;

-- Immutable production safety snapshot before the first derived-state backfill.
insert into public.gymlog_state_snapshots(user_id, revision, reason, checksum, data)
select user_id, revision, 'pre-normalization-2026-07-20',
       encode(digest(data::text, 'sha256'), 'hex'), data
from public.gymlog_user_state
where not exists (
  select 1 from public.gymlog_state_snapshots s
  where s.user_id = gymlog_user_state.user_id
    and s.reason = 'pre-normalization-2026-07-20'
);

-- Fire the additive normalizer once without altering the JSON contents.
update public.gymlog_user_state set data = data;
