-- Fitbit currently returns ordered BPM samples without timestamps for this data set.
-- Preserve every sample by ordinal and keep sample_time nullable instead of inventing time.

alter table public.gymlog_heart_rate_samples
  drop constraint if exists gymlog_heart_rate_samples_pkey;

alter table public.gymlog_heart_rate_samples
  add column if not exists sample_index integer not null default 0,
  alter column sample_time drop not null;

alter table public.gymlog_heart_rate_samples
  add primary key (user_id, session_local_id, sample_index);

create index if not exists gymlog_hr_user_sample_time_idx
  on public.gymlog_heart_rate_samples (user_id, sample_time desc)
  where sample_time is not null;

create or replace function public.gymlog_normalize_hr_samples_row()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $function$
declare
  session_json jsonb;
  previous_session jsonb;
  sample_json jsonb;
  session_id text;
  sample_ordinal bigint;
  parsed_time timestamptz;
begin
  for session_json in
    select item from jsonb_array_elements(coalesce(new.data->'workoutLog', '[]'::jsonb)) item
  loop
    session_id := session_json->>'id';
    if session_id is null or session_id = '' then continue; end if;

    previous_session := null;
    if tg_op = 'UPDATE' then
      select item into previous_session
      from jsonb_array_elements(coalesce(old.data->'workoutLog', '[]'::jsonb)) item
      where item->>'id' = session_id
      limit 1;
    end if;

    if tg_op = 'INSERT'
       or (previous_session #> '{health,metrics,heartRateSamples}')
          is distinct from (session_json #> '{health,metrics,heartRateSamples}') then
      delete from public.gymlog_heart_rate_samples
       where user_id = new.user_id and session_local_id = session_id;

      if jsonb_typeof(session_json #> '{health,metrics,heartRateSamples}') = 'array' then
        for sample_json, sample_ordinal in
          select item, ordinality
          from jsonb_array_elements(session_json #> '{health,metrics,heartRateSamples}')
               with ordinality as samples(item, ordinality)
        loop
          if sample_json->>'bpm' ~ '^[0-9]+$'
             and (sample_json->>'bpm')::integer between 30 and 250 then
            parsed_time := null;
            if nullif(sample_json->>'time', '') is not null then
              begin
                parsed_time := (sample_json->>'time')::timestamptz;
              exception when invalid_datetime_format or datetime_field_overflow then
                parsed_time := null;
              end;
            end if;
            insert into public.gymlog_heart_rate_samples (
              user_id, session_local_id, sample_index, sample_time, bpm
            ) values (
              new.user_id, session_id, sample_ordinal::integer - 1,
              parsed_time, (sample_json->>'bpm')::smallint
            ) on conflict (user_id, session_local_id, sample_index)
              do update set sample_time = excluded.sample_time, bpm = excluded.bpm;
          end if;
        end loop;
      end if;
    end if;
  end loop;
  return new;
end
$function$;

drop trigger if exists gymlog_user_state_normalize_hr on public.gymlog_user_state;
create trigger gymlog_user_state_normalize_hr
after insert or update of data on public.gymlog_user_state
for each row execute function public.gymlog_normalize_hr_samples_row();

revoke all on function public.gymlog_normalize_hr_samples_row() from public, anon, authenticated;

insert into public.gymlog_heart_rate_samples (
  user_id, session_local_id, sample_index, sample_time, bpm
)
select state.user_id,
       session.item->>'id',
       sample.ordinality::integer - 1,
       case
         when nullif(sample.item->>'time', '') is not null
              and sample.item->>'time' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
           then (sample.item->>'time')::timestamptz
         else null
       end,
       (sample.item->>'bpm')::smallint
from public.gymlog_user_state state
cross join lateral jsonb_array_elements(coalesce(state.data->'workoutLog', '[]'::jsonb)) session(item)
cross join lateral jsonb_array_elements(coalesce(session.item #> '{health,metrics,heartRateSamples}', '[]'::jsonb))
  with ordinality sample(item, ordinality)
where session.item->>'id' is not null
  and sample.item->>'bpm' ~ '^[0-9]+$'
  and (sample.item->>'bpm')::integer between 30 and 250
on conflict (user_id, session_local_id, sample_index)
do update set sample_time = excluded.sample_time, bpm = excluded.bpm;
