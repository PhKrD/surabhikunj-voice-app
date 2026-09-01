-- =====================================================================
-- 58_command_lifecycle.sql — Phase 1: reliable command lifecycle
--
-- Additive only. Does NOT change how any command executes on the device.
-- Purpose:
--   1. Give pc_device_commands an authoritative updated_at (for realtime
--      ordering + "last changed" display in the parent UI).
--   2. Add expires_at so the parent UI can distinguish a command that is
--      genuinely still in flight from one that has timed out (device
--      offline / crashed mid-execution).
--   3. Add an index that lets the child re-pick commands stuck in
--      'delivered' (child ACKed receipt but crashed before confirming
--      execution) so they get retried instead of hanging forever.
--
-- Existing migrations 52-57 are untouched.
-- =====================================================================

-- ── 1. updated_at + trigger (reuse the app-wide update_updated_at()) ──
ALTER TABLE public.pc_device_commands
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing rows so ordering is sane immediately.
UPDATE public.pc_device_commands
  SET updated_at = COALESCE(executed_at, delivered_at, created_at)
  WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS trg_pc_commands_updated_at ON public.pc_device_commands;
CREATE TRIGGER trg_pc_commands_updated_at
  BEFORE UPDATE ON public.pc_device_commands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── 2. expires_at (client-side timeout marker) ───────────────────────
-- The parent app sets this at insert time (created_at + timeout window).
-- A NULL value means "no timeout" (legacy rows / commands that shouldn't
-- expire); the UI falls back to created_at + a default window in that case.
ALTER TABLE public.pc_device_commands
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- ── 3. Requeue index for stuck 'delivered' commands ──────────────────
-- The child pollers re-pick rows where status='delivered' AND executed_at
-- IS NULL AND delivered_at is older than a threshold. This index keeps
-- that lookup cheap.
CREATE INDEX IF NOT EXISTS idx_pc_commands_device_delivered
  ON public.pc_device_commands (device_id, status, delivered_at)
  WHERE executed_at IS NULL;

-- Note: no RLS changes required.
--   • Parent already has INSERT/SELECT (expires_at is just another column
--     the parent is allowed to write on insert).
--   • Device already has UPDATE on its own commands (status transitions)
--     and UPDATE on its own pc_devices row (heartbeat / last_seen_at).
