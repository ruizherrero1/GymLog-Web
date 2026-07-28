-- Keep the legacy full-state normalizer compatible with the ordinal primary key.
-- The dedicated HR trigger remains the canonical writer and safely replaces these rows afterward.
do $migration$
declare
  function_sql text;
begin
  select pg_get_functiondef(p.oid)
    into function_sql
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'gymlog_normalize_state_row'
     and pg_get_function_identity_arguments(p.oid) = '';

  if function_sql is null then
    raise exception 'gymlog_normalize_state_row_not_found';
  end if;

  function_sql := replace(function_sql,
    E'  set_ordinal bigint;\n',
    E'  set_ordinal bigint;\n  sample_ordinal bigint;\n');
  function_sql := replace(function_sql,
    E'        for sample_json in\n          select item from jsonb_array_elements(session_json #> ''{health,metrics,heartRateSamples}'') item\n',
    E'        for sample_json, sample_ordinal in\n          select item, ordinality\n          from jsonb_array_elements(session_json #> ''{health,metrics,heartRateSamples}'')\n               with ordinality as samples(item, ordinality)\n');
  function_sql := replace(function_sql,
    E'                user_id, session_local_id, sample_time, bpm\n',
    E'                user_id, session_local_id, sample_index, sample_time, bpm\n');
  function_sql := replace(function_sql,
    E'                new.user_id, session_id, (sample_json->>''time'')::timestamptz,\n',
    E'                new.user_id, session_id, sample_ordinal::integer - 1,\n                (sample_json->>''time'')::timestamptz,\n');
  function_sql := replace(function_sql,
    E'              ) on conflict (user_id, session_local_id, sample_time)\n                do update set bpm = excluded.bpm;\n',
    E'              ) on conflict (user_id, session_local_id, sample_index)\n                do update set sample_time = excluded.sample_time, bpm = excluded.bpm;\n');

  if position('for sample_json, sample_ordinal in' in function_sql) = 0
     or position('user_id, session_local_id, sample_index, sample_time, bpm' in function_sql) = 0 then
    raise exception 'gymlog_normalizer_patch_not_applied';
  end if;

  execute function_sql;
end
$migration$;