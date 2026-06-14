-- Optional demo data: personal daily-loop content for EXISTING residents.
-- Prerequisites: run 01, 02, 04, 05, 07, 08 and 03_seed_demo.sql first, and have
-- one or more residents signed up (profiles must already exist). Safe to re-run.
--
-- For every profile in the default VOICE this creates:
--   * today's service allocation (first seeded service)
--   * a cleaning assignment + today's "done" log (first seeded area)
--   * the last 7 days of sadhana reports (varied scores for a nice trend/streak)

do $$
declare
  v_voice   uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  v_service uuid;
  v_area    uuid;
  r         record;
  d         int;
begin
  select id into v_service from public.services
    where voice_id = v_voice order by created_at limit 1;
  select id into v_area from public.cleaning_areas
    where voice_id = v_voice order by created_at limit 1;

  for r in select id from public.profiles where voice_id = v_voice loop
    -- Today's service allocation (no unique constraint -> guard with NOT EXISTS)
    if v_service is not null and not exists (
      select 1 from public.service_allocations
      where profile_id = r.id and service_id = v_service and service_date = current_date
    ) then
      insert into public.service_allocations
        (voice_id, service_id, profile_id, service_date, service_time, status)
      values (v_voice, v_service, r.id, current_date, '06:30:00', 'pending');
    end if;

    -- Cleaning assignment + today's log
    if v_area is not null then
      insert into public.cleaning_assignments (area_id, profile_id, assigned_from)
      values (v_area, r.id, current_date)
      on conflict (area_id, profile_id) do nothing;

      insert into public.cleaning_logs (voice_id, area_id, profile_id, log_date, status)
      values (v_voice, v_area, r.id, current_date, 'done')
      on conflict (area_id, profile_id, log_date) do nothing;
    end if;

    -- Last 7 days of sadhana reports
    for d in 0..6 loop
      insert into public.sadhana_reports (
        voice_id, profile_id, report_date,
        to_bed_time, wake_up_time, day_rest_min, japa_time, japa_rounds,
        reading_min, hearing_min, mangal_arti, morning_class, seva_hours,
        score, score_japa, score_sleep, score_reading, score_hearing, score_seva, score_attendance
      )
      values (
        v_voice, r.id, current_date - d,
        '22:00:00', '04:45:00', 0, '07:30:00', 16,
        45, 30, true, true, 2.0,
        70 + ((d * 7) % 25), 22 + (d % 6), 18, 10 + (d % 5), 9, 6, 10
      )
      on conflict (profile_id, report_date) do nothing;
    end loop;
  end loop;
end $$;
