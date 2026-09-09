-- =====================================================================
-- 68. CHILD <-> ORG MEMBER LINKING + TAMPER-DETECTION ALERT TYPE
-- =====================================================================
-- Two independent, additive changes:
--
-- 1. pc_children.linked_profile_id — lets a parent optionally link a
--    supervised child profile to a REAL VOICE org member account
--    (existing resident/devotee, or one created for this purpose). When
--    set, pairing (see supabase/functions/pc-generate-pairing-code,
--    pc-redeem-pairing-code) signs the device in AS that real member
--    instead of minting a throwaway device-only auth user. This lets the
--    child use Sadhana/cleanliness/etc. normally on the same device that
--    is under parental-control supervision — see src/App.jsx and
--    src/components/child-device/ChildDeviceShell.jsx for how the JS
--    layer branches on this. Nullable/optional: a child with no org
--    account (e.g. too young to have duties) keeps today's fully
--    isolated device-only experience unchanged.
--
-- 2. pc_alert_type gains 'tamper_detected', raised by the native layer
--    (android/.../dpc/TamperGuard.kt) the moment Accessibility or Device
--    Admin gets turned off on a supervised device — see
--    PLATFORM_LIMITATIONS.md "Tamper detection" section.
--
-- Idempotent, additive only.
-- =====================================================================

-- ── 1. Child <-> org member link ────────────────────────────────────

ALTER TABLE public.pc_children
  ADD COLUMN IF NOT EXISTS linked_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.pc_children.linked_profile_id IS
  'Optional: a real profiles.id this child profile is the SAME PERSON as. When set, pc-generate-pairing-code/pc-redeem-pairing-code sign the paired device in as this member''s own account (not a throwaway device-only auth user), so org features (Sadhana, cleanliness, etc.) work on the same device that is under parental-control supervision. NULL = today''s device-only behavior, unchanged.';

CREATE INDEX IF NOT EXISTS idx_pc_children_linked_profile
  ON public.pc_children (linked_profile_id);

-- pc_children RLS is already "FOR ALL USING/WITH CHECK (parent_id = auth.uid())"
-- (see 52_parental_control_schema.sql) which covers writes to this new
-- column with no policy change needed. Cross-org linking is prevented by
-- the edge function re-checking linked_profile_id's org_id server-side
-- (service-role, so RLS on profiles doesn't apply there) before using it
-- — see pc-generate-pairing-code/index.ts.

-- ── 2. Tamper-detection alert type ───────────────────────────────────

ALTER TYPE public.pc_alert_type ADD VALUE IF NOT EXISTS 'tamper_detected';

NOTIFY pgrst, 'reload schema';
