-- =====================================================================
-- 53. DEVICE PAIRING CODES — secure enrollment handshake
-- =====================================================================
-- Replaces the earlier plaintext-password-in-JSONB pairing idea with a
-- short-lived, single-use, hashed code:
--
--   1. Parent app calls edge fn "pc-generate-pairing-code" with
--      { child_id, device_name }.
--      → creates a pc_devices row + a device-only auth.users row with a
--        random (never-exposed) password, generates a 6-char code,
--        stores SHA-256(code) here with a 10-minute expiry, and shows
--        the plaintext code to the parent (or renders it as a QR).
--
--   2. Child app calls edge fn "pc-redeem-pairing-code" with
--      { pairing_code }.
--      → hashes the code, looks up this table, checks expiry/used_at,
--        mints a real Supabase session for the device auth user via
--        generateLink + verifyOtp (service role never returns a
--        password), marks the code used, and returns the session.
--
-- Only the edge functions (service_role) touch this table directly —
-- RLS still restricts any accidental anon/authenticated access.
-- =====================================================================

CREATE TABLE pc_pairing_codes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id    UUID NOT NULL REFERENCES pc_devices(id) ON DELETE CASCADE,
  code_hash    TEXT NOT NULL,             -- SHA-256 hex digest of the plaintext code
  issued_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pc_pairing_codes_hash ON pc_pairing_codes (code_hash) WHERE used_at IS NULL;
CREATE INDEX idx_pc_pairing_codes_device ON pc_pairing_codes (device_id);

ALTER TABLE pc_pairing_codes ENABLE ROW LEVEL SECURITY;

-- No direct client policies — this table is service-role only (edge functions).
-- Parents view enrollment status via pc_devices.enrolled_at instead.

ALTER PUBLICATION supabase_realtime ADD TABLE pc_pairing_codes;

-- Housekeeping: periodically purge expired/used codes (call from a cron
-- edge function or pg_cron if enabled; safe to run manually too).
CREATE OR REPLACE FUNCTION pc_purge_expired_pairing_codes()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM pc_pairing_codes
  WHERE expires_at < NOW() - INTERVAL '1 day';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
