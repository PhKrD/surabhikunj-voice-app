-- =====================================================================
-- 14. CONFIGURABLE SADHANA SCORING & SOURCES
-- =====================================================================
-- Allows admins/sadhana in-charges to configure custom scoring rules
-- for each sadhana parameter, and adds hearing/reading source tracking
-- =====================================================================

-- =====================================================================
-- HEARING AND READING SOURCES
-- =====================================================================

-- Master list of hearing sources
CREATE TABLE IF NOT EXISTS hearing_sources (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id        UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,  -- e.g., "HH RNSM", "HDG SP", "HG RSP"
  abbreviation    TEXT,           -- Short form for display
  is_active       BOOLEAN DEFAULT TRUE,
  display_order   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(voice_id, name)
);

-- Master list of reading types
CREATE TABLE IF NOT EXISTS reading_types (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id        UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,  -- e.g., "Shrila Prabhupada Books", "Others"
  is_active       BOOLEAN DEFAULT TRUE,
  display_order   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(voice_id, name)
);

-- Add hearing/reading source columns to daily reports
ALTER TABLE sadhana_reports
  ADD COLUMN IF NOT EXISTS hearing_source_id UUID REFERENCES hearing_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reading_type_id   UUID REFERENCES reading_types(id) ON DELETE SET NULL;

-- =====================================================================
-- CONFIGURABLE SCORING RULES
-- =====================================================================

-- Scoring rule types
CREATE TYPE IF NOT EXISTS scoring_rule_type AS ENUM (
  'time_before',     -- Points for completing before a certain time (WU, Japa)
  'time_after',      -- Points for going to bed after a certain time (TB)
  'duration_min',    -- Points based on duration in minutes (Reading, Hearing, Studies, DR)
  'rounds',          -- Points based on number of rounds (Japa)
  'seva_hours',      -- Points based on seva hours
  'boolean',         -- Points for yes/no (MA, MC, Cleanliness)
  'custom'           -- Custom scoring logic
);

-- Configurable scoring rules per voice
CREATE TABLE IF NOT EXISTS sadhana_scoring_rules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id        UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  parameter       TEXT NOT NULL,  -- 'tb', 'wu', 'japa_time', 'japa_rounds', 'reading', 'hearing', etc.
  rule_type       scoring_rule_type NOT NULL,
  
  -- Rule configuration (JSONB for flexibility)
  -- Examples:
  -- For time_before: {"cutoffs": [{"time": "03:45", "points": 25}, {"time": "04:00", "points": 20}]}
  -- For duration_min: {"tiers": [{"min": 60, "points": 15}, {"min": 45, "points": 12}]}
  -- For rounds: {"max_rounds": 16, "points_per_round": 1.5625}
  -- For boolean: {"points_if_true": 5}
  config          JSONB NOT NULL DEFAULT '{}',
  
  -- Max points for this parameter
  max_points      NUMERIC(5,2) NOT NULL DEFAULT 10,
  
  -- Whether this rule is active
  is_active       BOOLEAN DEFAULT TRUE,
  
  -- Display order in UI
  display_order   INTEGER DEFAULT 0,
  
  -- Metadata
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by      UUID REFERENCES profiles(id),
  
  UNIQUE(voice_id, parameter)
);

-- Default scoring configurations per parameter
CREATE TABLE IF NOT EXISTS sadhana_default_configs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parameter       TEXT UNIQUE NOT NULL,
  rule_type       scoring_rule_type NOT NULL,
  default_config  JSONB NOT NULL,
  max_points      NUMERIC(5,2) NOT NULL,
  description     TEXT
);

-- Insert default configurations (can be copied when creating voice-specific rules)
INSERT INTO sadhana_default_configs (parameter, rule_type, default_config, max_points, description) VALUES
  ('tb', 'time_after', 
   '{"cutoffs": [
      {"time": "21:30", "points": 25}, 
      {"time": "21:45", "points": 20},
      {"time": "22:00", "points": 15},
      {"time": "22:30", "points": 10},
      {"time": "22:45", "points": 5},
      {"time": "23:00", "points": 0}
    ], "penalty_after": -5}', 
   25, 'To Bed Time scoring'),
   
  ('wu', 'time_before',
   '{"cutoffs": [
      {"time": "03:45", "points": 25},
      {"time": "04:00", "points": 20},
      {"time": "04:15", "points": 15},
      {"time": "04:30", "points": 10},
      {"time": "04:45", "points": 5},
      {"time": "05:00", "points": 0}
    ], "penalty_after": -5}',
   25, 'Wake Up Time scoring'),
   
  ('japa_rounds', 'rounds',
   '{"tiers": [
      {"rounds": 16, "points": 15},
      {"rounds": 12, "points": 11},
      {"rounds": 8, "points": 7},
      {"rounds": 4, "points": 4}
    ]}',
   15, 'Japa rounds scoring'),
   
  ('japa_time', 'time_before',
   '{"cutoffs": [
      {"time": "07:00", "points": 10},
      {"time": "08:00", "points": 7},
      {"time": "09:00", "points": 5},
      {"time": "10:00", "points": 3}
    ]}',
   10, 'Japa completion time scoring'),
   
  ('reading', 'duration_min',
   '{"tiers": [
      {"minutes": 70, "points": 15},
      {"minutes": 60, "points": 13},
      {"minutes": 45, "points": 10},
      {"minutes": 30, "points": 7},
      {"minutes": 15, "points": 4}
    ]}',
   15, 'Reading duration scoring'),
   
  ('hearing', 'duration_min',
   '{"tiers": [
      {"minutes": 60, "points": 15},
      {"minutes": 45, "points": 12},
      {"minutes": 30, "points": 9},
      {"minutes": 15, "points": 5}
    ]}',
   15, 'Hearing duration scoring'),
   
  ('studies', 'duration_min',
   '{"tiers": [
      {"minutes": 90, "points": 10},
      {"minutes": 60, "points": 8},
      {"minutes": 45, "points": 6},
      {"minutes": 30, "points": 4},
      {"minutes": 15, "points": 2}
    ]}',
   10, 'Studies duration scoring'),
   
  ('seva_hours', 'seva_hours',
   '{"tiers": [
      {"hours": 4, "points": 10},
      {"hours": 3, "points": 8},
      {"hours": 2, "points": 6},
      {"hours": 1, "points": 3}
    ]}',
   10, 'Seva hours scoring'),
   
  ('ma', 'boolean', '{"points_if_true": 5}', 5, 'Mangal Arti attendance'),
  ('mc', 'boolean', '{"points_if_true": 5}', 5, 'Morning Class attendance'),
  ('cleanliness', 'boolean', '{"points_if_true": 5}', 5, 'Cleanliness task completed'),
  
  ('dr', 'duration_min',
   '{"penalty_tiers": [
      {"minutes": 90, "points": -5},
      {"minutes": 60, "points": -3},
      {"minutes": 45, "points": -2},
      {"minutes": 30, "points": -1},
      {"minutes": 0, "points": 0}
    ]}',
   0, 'Day Rest penalty')
ON CONFLICT (parameter) DO NOTHING;

-- =====================================================================
-- DEFAULT DATA FOR HEARING SOURCES AND READING TYPES
-- =====================================================================

-- Function to initialize default sources for a voice
CREATE OR REPLACE FUNCTION initialize_sadhana_sources(p_voice_id UUID)
RETURNS void AS $$
BEGIN
  -- Insert default hearing sources
  INSERT INTO hearing_sources (voice_id, name, abbreviation, display_order) VALUES
    (p_voice_id, 'HH Radhanath Swami Maharaj', 'HH RNSM', 1),
    (p_voice_id, 'HDG Srila Prabhupada', 'HDG SP', 2),
    (p_voice_id, 'HG Radha Shyamsundar Prabhu', 'HG RSP', 3),
    (p_voice_id, 'HH Gopal Krishna Goswami Maharaj', 'HH GKGM', 4),
    (p_voice_id, 'HH Bhakti Charu Swami Maharaj', 'HH BCSM', 5),
    (p_voice_id, 'Other Senior Devotees', 'Others', 6)
  ON CONFLICT (voice_id, name) DO NOTHING;
  
  -- Insert default reading types
  INSERT INTO reading_types (voice_id, name, display_order) VALUES
    (p_voice_id, 'Srila Prabhupada Books', 1),
    (p_voice_id, 'Bhagavad Gita', 2),
    (p_voice_id, 'Srimad Bhagavatam', 3),
    (p_voice_id, 'Caitanya Caritamrita', 4),
    (p_voice_id, 'Nectar of Devotion', 5),
    (p_voice_id, 'Nectar of Instruction', 6),
    (p_voice_id, 'Other Vaishnava Literature', 7),
    (p_voice_id, 'Study Materials', 8)
  ON CONFLICT (voice_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Function to initialize default scoring rules for a voice
CREATE OR REPLACE FUNCTION initialize_sadhana_scoring_rules(p_voice_id UUID, p_created_by UUID)
RETURNS void AS $$
BEGIN
  -- Copy from default configs
  INSERT INTO sadhana_scoring_rules (
    voice_id, parameter, rule_type, config, max_points, description, created_by
  )
  SELECT 
    p_voice_id, parameter, rule_type, default_config, max_points, description, p_created_by
  FROM sadhana_default_configs
  ON CONFLICT (voice_id, parameter) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================

-- Hearing sources RLS
ALTER TABLE hearing_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hearing_sources_select ON hearing_sources;
CREATE POLICY hearing_sources_select ON hearing_sources
  FOR SELECT USING (
    voice_id IN (SELECT voice_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS hearing_sources_modify ON hearing_sources;
CREATE POLICY hearing_sources_modify ON hearing_sources
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND voice_id = hearing_sources.voice_id
      AND role IN ('admin', 'coordinator')
    )
  );

-- Reading types RLS
ALTER TABLE reading_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reading_types_select ON reading_types;
CREATE POLICY reading_types_select ON reading_types
  FOR SELECT USING (
    voice_id IN (SELECT voice_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS reading_types_modify ON reading_types;
CREATE POLICY reading_types_modify ON reading_types
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND voice_id = reading_types.voice_id
      AND role IN ('admin', 'coordinator')
    )
  );

-- Scoring rules RLS
ALTER TABLE sadhana_scoring_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scoring_rules_select ON sadhana_scoring_rules;
CREATE POLICY scoring_rules_select ON sadhana_scoring_rules
  FOR SELECT USING (
    voice_id IN (SELECT voice_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS scoring_rules_modify ON sadhana_scoring_rules;
CREATE POLICY scoring_rules_modify ON sadhana_scoring_rules
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND voice_id = sadhana_scoring_rules.voice_id
      AND role IN ('admin', 'coordinator')
    )
  );

-- =====================================================================
-- TRIGGERS
-- =====================================================================

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_sadhana_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hearing_sources_timestamp ON hearing_sources;
CREATE TRIGGER hearing_sources_timestamp
  BEFORE UPDATE ON hearing_sources
  FOR EACH ROW EXECUTE FUNCTION update_sadhana_config_timestamp();

DROP TRIGGER IF EXISTS reading_types_timestamp ON reading_types;
CREATE TRIGGER reading_types_timestamp
  BEFORE UPDATE ON reading_types
  FOR EACH ROW EXECUTE FUNCTION update_sadhana_config_timestamp();

DROP TRIGGER IF EXISTS scoring_rules_timestamp ON sadhana_scoring_rules;
CREATE TRIGGER scoring_rules_timestamp
  BEFORE UPDATE ON sadhana_scoring_rules
  FOR EACH ROW EXECUTE FUNCTION update_sadhana_config_timestamp();

-- =====================================================================
-- INITIALIZE FOR EXISTING VOICES
-- =====================================================================

-- Initialize sources and rules for all existing voices
DO $$
DECLARE
  v RECORD;
  admin_id UUID;
BEGIN
  FOR v IN SELECT id FROM voices LOOP
    -- Get the first admin for this voice
    SELECT id INTO admin_id FROM profiles 
    WHERE voice_id = v.id AND role = 'admin' 
    LIMIT 1;
    
    -- Initialize sources
    PERFORM initialize_sadhana_sources(v.id);
    
    -- Initialize scoring rules if admin exists
    IF admin_id IS NOT NULL THEN
      PERFORM initialize_sadhana_scoring_rules(v.id, admin_id);
    END IF;
  END LOOP;
END $$;
