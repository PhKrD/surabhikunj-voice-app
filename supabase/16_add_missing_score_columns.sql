-- =====================================================================
-- 16. ADD MISSING SCORE COLUMNS TO SADHANA_REPORTS
-- =====================================================================
-- Adds score_dr and other missing score columns that are being calculated
-- but not stored in the database
-- =====================================================================

-- Add missing score columns to sadhana_reports table
ALTER TABLE sadhana_reports
  ADD COLUMN IF NOT EXISTS score_dr INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_studies INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_cleanliness INTEGER DEFAULT 0;

-- Update the comment to reflect new columns
COMMENT ON COLUMN sadhana_reports.score_dr IS 'Day rest penalty score (negative points)';
COMMENT ON COLUMN sadhana_reports.score_studies IS 'Studies duration score';
COMMENT ON COLUMN sadhana_reports.score_cleanliness IS 'Cleanliness task completion score';

-- Ensure all score columns have proper defaults
ALTER TABLE sadhana_reports
  ALTER COLUMN score_japa SET DEFAULT 0,
  ALTER COLUMN score_sleep SET DEFAULT 0,
  ALTER COLUMN score_reading SET DEFAULT 0,
  ALTER COLUMN score_hearing SET DEFAULT 0,
  ALTER COLUMN score_seva SET DEFAULT 0,
  ALTER COLUMN score_attendance SET DEFAULT 0,
  ALTER COLUMN score SET DEFAULT 0;
