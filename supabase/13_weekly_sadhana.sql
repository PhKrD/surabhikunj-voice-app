-- =====================================================================
-- 13. WEEKLY SADHANA REPORTS + STUDIES & CLEANLINESS
-- =====================================================================
-- Adds studies_min and cleanliness_done columns to daily sadhana_reports.
-- Adds a sadhana_weekly_reports table so devotees can compile 7 days of
-- data into one report and submit it to the sadhana in-charge.
-- =====================================================================

-- Daily report additions
ALTER TABLE sadhana_reports
  ADD COLUMN IF NOT EXISTS studies_min      INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleanliness_done BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS score_studies    NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_cleanliness NUMERIC(5,2);

COMMENT ON COLUMN sadhana_reports.studies_min       IS 'Daily studies time in minutes';
COMMENT ON COLUMN sadhana_reports.cleanliness_done  IS 'Did devotee complete daily cleanliness task';

-- Weekly rollup / manual weekly report
CREATE TABLE IF NOT EXISTS sadhana_weekly_reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id        UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start      DATE NOT NULL, -- Monday (ISO week start)

  -- 7-day payload. Keys: sun, mon, tue, wed, thu, fri, sat.
  -- Each day: { to_bed_time, wake_up_time, day_rest_min, japa_time,
  --            japa_rounds, reading_min, hearing_min, mangal_arti,
  --            morning_class, studies_min, cleanliness_done, notes }
  daily_data      JSONB NOT NULL DEFAULT '{}',

  -- Per-column weekly totals & max (mirrors the reference spreadsheet)
  total_tb          NUMERIC(6,2) DEFAULT 0,
  total_wu          NUMERIC(6,2) DEFAULT 0,
  total_dr          NUMERIC(6,2) DEFAULT 0,
  total_japa        NUMERIC(6,2) DEFAULT 0,
  total_reading     NUMERIC(6,2) DEFAULT 0,
  total_hearing     NUMERIC(6,2) DEFAULT 0,
  total_mc          NUMERIC(6,2) DEFAULT 0,
  total_ma          NUMERIC(6,2) DEFAULT 0,
  total_studies     NUMERIC(6,2) DEFAULT 0,
  total_cleanliness NUMERIC(6,2) DEFAULT 0,

  total_score       NUMERIC(6,2) DEFAULT 0,   -- sum of the above, out of 980
  percent           NUMERIC(5,2) DEFAULT 0,   -- total_score / 980 * 100

  notes           TEXT,
  submitted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(profile_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_swr_voice_week
  ON sadhana_weekly_reports(voice_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_swr_profile_week
  ON sadhana_weekly_reports(profile_id, week_start DESC);

-- Simple RLS: same voice can read; devotee can only write their own.
ALTER TABLE sadhana_weekly_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS swr_select_same_voice ON sadhana_weekly_reports;
CREATE POLICY swr_select_same_voice ON sadhana_weekly_reports
  FOR SELECT USING (
    voice_id IN (SELECT voice_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS swr_insert_own ON sadhana_weekly_reports;
CREATE POLICY swr_insert_own ON sadhana_weekly_reports
  FOR INSERT WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS swr_update_own ON sadhana_weekly_reports;
CREATE POLICY swr_update_own ON sadhana_weekly_reports
  FOR UPDATE USING (profile_id = auth.uid());

DROP POLICY IF EXISTS swr_delete_own ON sadhana_weekly_reports;
CREATE POLICY swr_delete_own ON sadhana_weekly_reports
  FOR DELETE USING (profile_id = auth.uid());

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION touch_sadhana_weekly_reports()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_swr ON sadhana_weekly_reports;
CREATE TRIGGER trg_touch_swr
  BEFORE UPDATE ON sadhana_weekly_reports
  FOR EACH ROW EXECUTE FUNCTION touch_sadhana_weekly_reports();
