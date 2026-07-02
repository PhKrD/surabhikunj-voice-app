-- =====================================================================
-- 15. UPDATE JAPA SCORING TO BE TIME-BASED ONLY
-- =====================================================================
-- Changes Japa scoring from rounds-based to completion-time-based
-- Everyone gets scored based on when they complete their committed rounds
-- =====================================================================

-- Update the default config for japa_rounds to be inactive or change to time-based
UPDATE sadhana_default_configs
SET 
  rule_type = 'time_before',
  default_config = jsonb_build_object(
    'cutoffs', jsonb_build_array(
      jsonb_build_object('time', '06:00', 'points', 15),
      jsonb_build_object('time', '06:30', 'points', 13),
      jsonb_build_object('time', '07:00', 'points', 11),
      jsonb_build_object('time', '07:30', 'points', 9),
      jsonb_build_object('time', '08:00', 'points', 7),
      jsonb_build_object('time', '08:30', 'points', 5),
      jsonb_build_object('time', '09:00', 'points', 3),
      jsonb_build_object('time', '10:00', 'points', 1)
    )
  ),
  description = 'Japa completion time scoring (when all committed rounds are completed)'
WHERE parameter = 'japa_rounds';

-- Remove the separate japa_time config as we're merging it into japa_rounds
DELETE FROM sadhana_default_configs
WHERE parameter = 'japa_time';

-- Update existing scoring rules for all voices
UPDATE sadhana_scoring_rules
SET 
  rule_type = 'time_before',
  config = jsonb_build_object(
    'cutoffs', jsonb_build_array(
      jsonb_build_object('time', '06:00', 'points', 15),
      jsonb_build_object('time', '06:30', 'points', 13),
      jsonb_build_object('time', '07:00', 'points', 11),
      jsonb_build_object('time', '07:30', 'points', 9),
      jsonb_build_object('time', '08:00', 'points', 7),
      jsonb_build_object('time', '08:30', 'points', 5),
      jsonb_build_object('time', '09:00', 'points', 3),
      jsonb_build_object('time', '10:00', 'points', 1)
    )
  ),
  description = 'Japa completion time scoring (when all committed rounds are completed)',
  updated_at = NOW()
WHERE parameter = 'japa_rounds';

-- Delete the separate japa_time rules
DELETE FROM sadhana_scoring_rules
WHERE parameter = 'japa_time';

-- Add a comment explaining the change
COMMENT ON TABLE sadhana_scoring_rules IS 
'Stores configurable scoring rules for sadhana parameters. 
Japa is now scored based on completion time of committed rounds, not the number of rounds.';
