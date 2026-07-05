-- =====================================================================
-- 18. FIX SADHANA SCORING COLUMNS
-- =====================================================================
-- The new config scoring system generates score_japa_rounds and score_japa_time
-- but the database only has score_japa. This migration adds the missing columns
-- and ensures all scoring columns exist.
-- =====================================================================

-- Add missing individual score columns that the new scoring system generates
ALTER TABLE sadhana_reports
  ADD COLUMN IF NOT EXISTS score_japa_rounds NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_japa_time NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_tb NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_wu NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_ma NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_mc NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_dr NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_reading NUMERIC(5,2),  -- Ensure this exists
  ADD COLUMN IF NOT EXISTS score_hearing NUMERIC(5,2),  -- Ensure this exists
  ADD COLUMN IF NOT EXISTS score_studies NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_cleanliness NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_seva_hours NUMERIC(5,2),  -- seva_hours parameter generates this
  ADD COLUMN IF NOT EXISTS hearing_source_id UUID REFERENCES hearing_sources(id),
  ADD COLUMN IF NOT EXISTS reading_type_id UUID REFERENCES reading_types(id);

-- Add comments for clarity
COMMENT ON COLUMN sadhana_reports.score_japa_rounds IS 'Japa rounds completion score';
COMMENT ON COLUMN sadhana_reports.score_japa_time IS 'Japa time completion score';
COMMENT ON COLUMN sadhana_reports.score_tb IS 'To bed time score';
COMMENT ON COLUMN sadhana_reports.score_wu IS 'Wake up time score';
COMMENT ON COLUMN sadhana_reports.score_ma IS 'Mangal arti attendance score';
COMMENT ON COLUMN sadhana_reports.score_mc IS 'Morning class attendance score';
COMMENT ON COLUMN sadhana_reports.score_dr IS 'Day rest penalty (negative)';
COMMENT ON COLUMN sadhana_reports.score_studies IS 'Studies duration score';
COMMENT ON COLUMN sadhana_reports.score_cleanliness IS 'Cleanliness task score';
COMMENT ON COLUMN sadhana_reports.score_seva_hours IS 'Seva hours score';
COMMENT ON COLUMN sadhana_reports.hearing_source_id IS 'Selected hearing source';
COMMENT ON COLUMN sadhana_reports.reading_type_id IS 'Selected reading type';

-- Create or replace function to update weekly report when daily is saved
CREATE OR REPLACE FUNCTION update_weekly_report_on_daily_save()
RETURNS TRIGGER AS $$
DECLARE
  v_week_start DATE;
  v_day_key TEXT;
BEGIN
  -- Calculate the Monday of the week for this report
  v_week_start := date_trunc('week', NEW.report_date)::date;
  
  -- Get the day key (sun, mon, tue, etc.)
  v_day_key := CASE EXTRACT(DOW FROM NEW.report_date)
    WHEN 0 THEN 'sun'
    WHEN 1 THEN 'mon'
    WHEN 2 THEN 'tue'
    WHEN 3 THEN 'wed'
    WHEN 4 THEN 'thu'
    WHEN 5 THEN 'fri'
    WHEN 6 THEN 'sat'
  END;
  
  -- Insert or update the weekly report with this day's data
  INSERT INTO sadhana_weekly_reports (
    voice_id,
    profile_id,
    week_start,
    daily_data,
    updated_at
  )
  VALUES (
    NEW.voice_id,
    NEW.profile_id,
    v_week_start,
    jsonb_build_object(
      v_day_key, jsonb_build_object(
        'to_bed_time', NEW.to_bed_time,
        'wake_up_time', NEW.wake_up_time,
        'day_rest_min', NEW.day_rest_min,
        'japa_time', NEW.japa_time,
        'japa_rounds', NEW.japa_rounds,
        'reading_min', NEW.reading_min,
        'hearing_min', NEW.hearing_min,
        'mangal_arti', NEW.mangal_arti,
        'morning_class', NEW.morning_class,
        'studies_min', NEW.studies_min,
        'cleanliness_done', NEW.cleanliness_done
      )
    ),
    NOW()
  )
  ON CONFLICT (profile_id, week_start)
  DO UPDATE SET
    daily_data = COALESCE(sadhana_weekly_reports.daily_data, '{}'::jsonb) || 
                 jsonb_build_object(
                   v_day_key, jsonb_build_object(
                     'to_bed_time', NEW.to_bed_time,
                     'wake_up_time', NEW.wake_up_time,
                     'day_rest_min', NEW.day_rest_min,
                     'japa_time', NEW.japa_time,
                     'japa_rounds', NEW.japa_rounds,
                     'reading_min', NEW.reading_min,
                     'hearing_min', NEW.hearing_min,
                     'mangal_arti', NEW.mangal_arti,
                     'morning_class', NEW.morning_class,
                     'studies_min', NEW.studies_min,
                     'cleanliness_done', NEW.cleanliness_done
                   )
                 ),
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update weekly report on daily save
DROP TRIGGER IF EXISTS trg_update_weekly_on_daily ON sadhana_reports;
CREATE TRIGGER trg_update_weekly_on_daily
  AFTER INSERT OR UPDATE ON sadhana_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_weekly_report_on_daily_save();

-- Ensure weekly reports table has all needed columns
ALTER TABLE sadhana_weekly_reports
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add index for faster weekly report lookups
CREATE INDEX IF NOT EXISTS idx_sadhana_reports_profile_date 
  ON sadhana_reports(profile_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_sadhana_weekly_profile_week 
  ON sadhana_weekly_reports(profile_id, week_start DESC);
