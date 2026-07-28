-- The legacy state normalizer still targets sample_time during its transition to ordinal samples.
create unique index if not exists gymlog_hr_user_session_sample_time_uidx
  on public.gymlog_heart_rate_samples (user_id, session_local_id, sample_time);